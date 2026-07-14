import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  handleFromUrl, hostOf, PLATFORM_HOST, platformOfUrl, scoreCandidate,
  type Platform,
} from "./discovery/scoring";
import type { Database } from "@/integrations/supabase/types";

type DiscoveredRow = Database["public"]["Tables"]["discovered_accounts"]["Row"];
type SubjectRow = Database["public"]["Tables"]["discovery_subjects"]["Row"];

const ALL_PLATFORMS: Platform[] = [
  "youtube", "instagram", "facebook", "tiktok", "x", "linkedin", "reddit",
];

/* ------------------------------------------------------------------ */
/* createSubject                                                       */
/* ------------------------------------------------------------------ */
export const createSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    subject_kind: z.enum(["person", "brand", "company", "domain", "handle", "website"]),
    query: z.string().trim().min(1).max(200),
    website_domain: z.string().trim().max(255).optional().nullable(),
    country: z.string().trim().max(120).optional().nullable(),
    org: z.string().trim().max(200).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const domain = data.website_domain ? hostOf(
      data.website_domain.startsWith("http") ? data.website_domain : `https://${data.website_domain}`,
    ) || data.website_domain.trim().toLowerCase() : null;
    const { data: row, error } = await context.supabase
      .from("discovery_subjects")
      .insert({
        user_id: context.userId,
        subject_kind: data.subject_kind,
        query: data.query,
        normalized_name: data.query.toLowerCase(),
        website_domain: domain,
        country: data.country ?? null,
        org: data.org ?? null,
        notes: data.notes ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as SubjectRow;
  });

/* ------------------------------------------------------------------ */
/* listSubjects                                                        */
/* ------------------------------------------------------------------ */
export const listSubjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("discovery_subjects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as SubjectRow[];
  });

/* ------------------------------------------------------------------ */
/* listAccounts                                                        */
/* ------------------------------------------------------------------ */
export const listAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    subjectId: z.string().uuid(),
    includeRejected: z.boolean().optional().default(false),
  }).parse(input))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("discovered_accounts")
      .select("*")
      .eq("subject_id", data.subjectId)
      .order("confidence", { ascending: false });
    if (!data.includeRejected) q = q.neq("status", "rejected");
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as DiscoveredRow[];
  });

/* ------------------------------------------------------------------ */
/* discoverAccounts — Firecrawl-driven search + scoring                */
/* ------------------------------------------------------------------ */
export const discoverAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    subjectId: z.string().uuid(),
    platforms: z.array(z.enum(ALL_PLATFORMS as [Platform, ...Platform[]])).optional(),
    limitPerPlatform: z.number().int().min(1).max(10).optional().default(5),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: subject, error: sErr } = await context.supabase
      .from("discovery_subjects")
      .select("*")
      .eq("id", data.subjectId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!subject) throw new Error("Subject not found");

    // Dynamic import keeps Firecrawl calls out of client bundles.
    const { searchPlatform, scrapeOfficialSite, scrapeProfile } = await import("./discovery/firecrawl.server");

    // 1) Optional website scrape — gives us outbound social links.
    let outboundHosts: string[] = [];
    let outboundLinks: string[] = [];
    if (subject.website_domain) {
      const site = await scrapeOfficialSite(
        subject.website_domain.startsWith("http") ? subject.website_domain : `https://${subject.website_domain}`,
      );
      outboundHosts = site.outboundHosts;
      outboundLinks = site.outboundLinks;
    }

    // 2) Search each platform.
    const platforms = data.platforms ?? ALL_PLATFORMS;
    const seedsByPlatform = await Promise.all(platforms.map(async (p) => {
      try {
        const seeds = await searchPlatform(subject.query, p, data.limitPerPlatform);
        return { platform: p, seeds };
      } catch (e) {
        console.warn(`[discovery] ${p} search failed:`, (e as Error).message);
        return { platform: p, seeds: [] };
      }
    }));

    // 3) Fold in candidates discovered via the official site's outbound links.
    const linkSeedsByPlatform = new Map<Platform, { platform: Platform; url: string; source: "website_links" }[]>();
    for (const l of outboundLinks) {
      const p = platformOfUrl(l);
      if (!p) continue;
      const bucket = linkSeedsByPlatform.get(p) ?? [];
      bucket.push({ platform: p, url: l, source: "website_links" });
      linkSeedsByPlatform.set(p, bucket);
    }

    // 4) Merge, dedupe by (platform,url).
    type Seed = { platform: Platform; url: string; title?: string; description?: string; source: "firecrawl_search" | "website_links" };
    const seen = new Set<string>();
    const merged: Seed[] = [];
    for (const g of seedsByPlatform) for (const s of g.seeds) {
      const k = `${s.platform}|${s.url}`;
      if (seen.has(k)) continue; seen.add(k); merged.push(s);
    }
    for (const bucket of linkSeedsByPlatform.values()) for (const s of bucket) {
      const k = `${s.platform}|${s.url}`;
      if (seen.has(k)) continue; seen.add(k); merged.push(s);
    }

    // 5) Enrich the top-N candidates per platform via profile scrape (cost control).
    const enrichCap = 3;
    const perPlatformCount = new Map<Platform, number>();
    const enriched = await Promise.all(merged.map(async (s) => {
      const c = perPlatformCount.get(s.platform) ?? 0;
      perPlatformCount.set(s.platform, c + 1);
      if (c >= enrichCap) {
        return { seed: s, profile: null };
      }
      const profile = await scrapeProfile(s.url);
      return { seed: s, profile };
    }));

    // 6) Score & upsert.
    const rowsToInsert = enriched.map(({ seed, profile }) => {
      const handle = handleFromUrl(seed.url);
      const displayName = profile?.displayName ?? seed.title ?? handle ?? null;
      const bio = profile?.bio ?? seed.description ?? null;

      const score = scoreCandidate({
        subjectName: subject.query,
        subjectDomain: subject.website_domain,
        candidateName: displayName,
        candidateHandle: handle,
        candidateBio: bio,
        candidateWebsiteLinks: profile?.websiteLinks ?? [],
        inboundFromSiteHosts: outboundHosts,
        candidateProfileUrl: seed.url,
        platformVerified: profile?.platformVerified,
        countryOrgMatch: false,
      });

      const status = score.confidence >= 75 ? "likely_official" : "discovered";
      return {
        user_id: context.userId,
        subject_id: subject.id,
        platform: seed.platform,
        display_name: displayName,
        handle,
        profile_url: seed.url,
        profile_image_url: profile?.profileImageUrl ?? null,
        bio,
        follower_count: profile?.followerCount ?? null,
        platform_verified: !!profile?.platformVerified,
        website_links: profile?.websiteLinks ?? [],
        cross_links: [],
        confidence: score.confidence,
        match_signals: score.signals as unknown as Database["public"]["Tables"]["discovered_accounts"]["Insert"]["match_signals"],
        match_reasons: score.reasons,
        discovery_source: seed.source,
        status,
      };
    });

    // Upsert on the unique dedupe index; ignore duplicates silently.
    if (rowsToInsert.length) {
      const { error: insErr } = await context.supabase
        .from("discovered_accounts")
        .upsert(rowsToInsert, {
          onConflict: "subject_id,platform,handle,profile_url",
          ignoreDuplicates: false,
        });
      if (insErr) {
        // Fall back to per-row insert-ignore if the composite conflict target isn't recognised.
        console.warn("[discovery] bulk upsert failed, retrying per row:", insErr.message);
        for (const r of rowsToInsert) {
          await context.supabase.from("discovered_accounts").insert(r).select("id").then(({ error }) => {
            if (error && !/duplicate/i.test(error.message)) {
              console.warn("[discovery] insert failed:", error.message);
            }
          });
        }
      }
    }

    // Return the current set for this subject.
    const { data: rows } = await context.supabase
      .from("discovered_accounts")
      .select("*")
      .eq("subject_id", subject.id)
      .order("confidence", { ascending: false });

    return { subject, accounts: (rows ?? []) as DiscoveredRow[] };
  });

/* ------------------------------------------------------------------ */
/* decideAccount — user confirms / rejects / marks unsure              */
/* ------------------------------------------------------------------ */
export const decideAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    accountId: z.string().uuid(),
    decision: z.enum(["confirmed", "not_mine", "unsure"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const nextStatus =
      data.decision === "confirmed" ? "user_confirmed" :
      data.decision === "not_mine" ? "rejected" :
      "discovered";

    const { data: before, error: bErr } = await context.supabase
      .from("discovered_accounts")
      .select("id, status")
      .eq("id", data.accountId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!before) throw new Error("Account not found");

    const { data: after, error } = await context.supabase
      .from("discovered_accounts")
      .update({
        user_decision: data.decision,
        decided_at: new Date().toISOString(),
        status: nextStatus,
      })
      .eq("id", data.accountId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await context.supabase.from("account_audit_log").insert({
      account_id: data.accountId,
      actor_id: context.userId,
      action: `user_decision:${data.decision}`,
      from_status: before.status,
      to_status: nextStatus,
      meta: {},
    });

    return after as DiscoveredRow;
  });

/* ------------------------------------------------------------------ */
/* addManualAccount                                                    */
/* ------------------------------------------------------------------ */
export const addManualAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    subjectId: z.string().uuid(),
    profile_url: z.string().trim().url(),
    platform: z.enum([...ALL_PLATFORMS, "website"] as [Platform, ...Platform[]]).optional(),
    display_name: z.string().trim().max(200).optional(),
    handle: z.string().trim().max(200).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const platform: Platform = data.platform ?? (platformOfUrl(data.profile_url) ?? "website");
    const handle = data.handle ?? handleFromUrl(data.profile_url) ?? null;
    const { data: row, error } = await context.supabase
      .from("discovered_accounts")
      .insert({
        user_id: context.userId,
        subject_id: data.subjectId,
        platform,
        profile_url: data.profile_url,
        display_name: data.display_name ?? handle ?? null,
        handle,
        discovery_source: "manual",
        status: "user_confirmed",
        user_decision: "confirmed",
        decided_at: new Date().toISOString(),
        confidence: 100,
        match_reasons: ["Added manually by owner"],
        match_signals: { manual: true },
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as DiscoveredRow;
  });

/* ------------------------------------------------------------------ */
/* deleteSubject                                                       */
/* ------------------------------------------------------------------ */
export const deleteSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ subjectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("discovery_subjects").delete().eq("id", data.subjectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// re-export platform lists for UI convenience
export { ALL_PLATFORMS };
export { PLATFORM_HOST };
