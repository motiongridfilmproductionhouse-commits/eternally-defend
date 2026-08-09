import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isVerifiedSubject } from "@/lib/firecrawl/entity-verifier";
import { buildQueryPlan } from "./queries";
import { SourceScope } from "./news-intelligence";

export const previewQueryPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({ targetName: z.string().min(2).max(120), aliases: z.array(z.string()).max(10).optional() })
      .parse(raw),
  )
  .handler(async ({ data }) => buildQueryPlan({ targetName: data.targetName, aliases: data.aliases }));

export const listYoutubeRemovalScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("youtube_removal_scans")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getYoutubeRemovalScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        scanId: z.string().uuid(),
        sourceScope: z.enum(["NON_OFFICIAL_ONLY", "NEWS_ALLEGATIONS", "ALL_SOURCES"]).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const [scanRes, findingsRes] = await Promise.all([
      context.supabase
        .from("youtube_removal_scans")
        .select("*")
        .eq("id", data.scanId)
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("youtube_removal_findings")
        .select("*")
        .eq("scan_id", data.scanId)
        .eq("user_id", context.userId)
        .order("priority_score", { ascending: false }),
    ]);
    if (scanRes.error) throw new Error(scanRes.error.message);
    if (findingsRes.error) throw new Error(findingsRes.error.message);
    const all: any[] = findingsRes.data ?? [];
    const scope: SourceScope = data.sourceScope || (scanRes.data as any)?.source_scope || "NON_OFFICIAL_ONLY";

    const verifiedFindings = all.filter((f) => isVerifiedSubject(f.subject_status));

    let clientFindings = verifiedFindings.filter((f) => f.channel_class !== "official_news");

    if (scope === "NEWS_ALLEGATIONS") {
      const newsAllegations = verifiedFindings.filter(
        (f) => f.channel_class === "official_news" && (f.is_official_news_allegation || f.allegation_matched),
      );
      clientFindings = [...clientFindings, ...newsAllegations];
    } else if (scope === "ALL_SOURCES") {
      clientFindings = verifiedFindings;
    }

    return {
      scan: scanRes.data,
      findings: clientFindings,
      excludedNews: all.filter((f) => f.channel_class === "official_news").length,
      notSubject: all.filter((f) => !isVerifiedSubject(f.subject_status)).length,
      telemetry: {
        official_news_discovered: all.filter((f) => f.channel_class === "official_news").length,
        official_news_target_verified: all.filter((f) => f.channel_class === "official_news" && isVerifiedSubject(f.subject_status)).length,
        official_news_allegation_matched: all.filter((f) => f.channel_class === "official_news" && (f.is_official_news_allegation || f.allegation_matched)).length,
        official_news_displayed: clientFindings.filter((f) => f.channel_class === "official_news").length,
        independent_verified: clientFindings.filter((f) => f.channel_class !== "official_news").length,
        total_verified_all_sources: verifiedFindings.length,
      },
    };
  });

export const startYoutubeRemovalScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        targetName: z.string().min(2).max(120),
        aliases: z.array(z.string().min(1).max(80)).max(10).optional(),
        languageHint: z.string().max(20).optional(),
        sourceScope: z.enum(["NON_OFFICIAL_ONLY", "NEWS_ALLEGATIONS", "ALL_SOURCES"]).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const scope = data.sourceScope || "NON_OFFICIAL_ONLY";
    const queries = buildQueryPlan({ targetName: data.targetName, aliases: data.aliases });

    const { data: scan, error } = await context.supabase
      .from("youtube_removal_scans")
      .insert({
        user_id: context.userId,
        target_name: data.targetName,
        aliases: data.aliases ?? [],
        language_hint: data.languageHint ?? null,
        status: "queued",
        stage: "queued",
        queries,
        source_scope: scope,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const scanId = (scan as { id: string }).id;
    const { runYoutubeRemovalScan } = await import("./scan.server");
    try {
      await runYoutubeRemovalScan(context.supabase, context.userId, scanId, scope);
    } catch (e) {
      console.error("[yt-removal] scan failed", scanId, e);
    }
    return { scanId };
  });

export const retryYoutubeRemovalScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { runYoutubeRemovalScan } = await import("./scan.server");
    await runYoutubeRemovalScan(context.supabase, context.userId, data.scanId);
    return { scanId: data.scanId };
  });
