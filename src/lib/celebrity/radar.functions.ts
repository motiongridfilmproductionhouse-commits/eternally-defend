import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildRadarFinding,
  countFindings,
  normalizeCopyright,
  normalizeDeepfake,
  normalizeFaceMatch,
  normalizeImpersonation,
  normalizeReputation,
  type Association,
  type CampaignContext,
  type RadarFinding,
} from "./radar-model";

export type CelebrityRadarState = {
  protection: "ACTIVE" | "SETUP_REQUIRED";
  radar: "SCANNING" | "IDLE";
  counters: ReturnType<typeof countFindings>;
  nodes: RadarFinding[];
  campaigns: Array<{ id: string; name: string; status: string; endsAt: string | null }>;
  updatedAt: string;
};

/**
 * Read-only, owner-scoped aggregation over the EXISTING findings tables.
 * No scanning, no writes, no biometric identifiers in the response.
 */
export const getCelebrityRadarState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CelebrityRadarState> => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [
      hitsRes,
      facesRes,
      matchRes,
      deepfakeRes,
      accountsRes,
      copyrightRes,
      campaignRes,
      linkRes,
      evidenceRes,
      scanRes,
    ] = await Promise.all([
      supabase
        .from("scan_hits")
        .select(
          "id, source, title, permalink, canonical_url, thumbnail_url, reach, severity, risk_type, tags, threat_score, risk_score, first_seen_at, published_at",
        )
        .eq("user_id", userId)
        .is("hidden_at", null)
        .gte("first_seen_at", since)
        .order("first_seen_at", { ascending: false })
        .limit(120),
      supabase
        .from("protected_faces")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "ACTIVE"),
      supabase
        .from("face_match_events")
        .select("id, source_url, source_type, similarity, threat_category, review_status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("deepfake_findings")
        .select(
          "id, url, canonical_url, page_title, source_host, confidence, risk_level, finding_classification, content_category, review_status, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("discovered_accounts")
        .select(
          "id, platform, handle, display_name, profile_url, profile_image_url, follower_count, confidence, status, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("copyright_matches")
        .select(
          "id, source_url, page_title, platform, thumbnail_url, confidence, confidence_band, detection_type, review_status, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("celebrity_campaigns")
        .select(
          "id, name, status, starts_at, ends_at, official_urls, approved_accounts, approved_media_urls, hashtags",
        )
        .eq("user_id", userId),
      supabase
        .from("celebrity_finding_links")
        .select("finding_kind, finding_id, campaign_id, association")
        .eq("user_id", userId),
      supabase
        .from("evidence_vault_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("scans")
        .select("id, status, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const campaigns: CampaignContext[] = (campaignRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      starts_at: c.starts_at ?? null,
      ends_at: c.ends_at ?? null,
      official_urls: c.official_urls ?? [],
      approved_accounts: c.approved_accounts ?? [],
      approved_media_urls: c.approved_media_urls ?? [],
      hashtags: c.hashtags ?? [],
    }));

    const overrides = new Map<string, { campaign_id: string | null; association: Association }>();
    for (const l of linkRes.data ?? []) {
      overrides.set(`${l.finding_kind}:${l.finding_id}`, {
        campaign_id: l.campaign_id ?? null,
        association: l.association as Association,
      });
    }

    const now = new Date();
    const raws = [
      ...(hitsRes.data ?? []).map(normalizeReputation),
      ...(matchRes.data ?? []).map(normalizeFaceMatch),
      ...(deepfakeRes.data ?? []).map(normalizeDeepfake),
      ...(accountsRes.data ?? []).map(normalizeImpersonation),
      ...(copyrightRes.data ?? []).map(normalizeCopyright),
    ];

    const nodes = raws
      .map((r) => buildRadarFinding(r, campaigns, now, overrides.get(`${r.kind}:${r.id}`) ?? null))
      .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1));

    const protectedFaces = facesRes.count ?? 0;
    const latestScan = scanRes.data?.[0];
    const scanning =
      latestScan?.status === "running" ||
      latestScan?.status === "queued" ||
      campaigns.some((c) => c.status === "ACTIVE");

    return {
      protection: protectedFaces > 0 || nodes.length > 0 ? "ACTIVE" : "SETUP_REQUIRED",
      radar: scanning ? "SCANNING" : "IDLE",
      counters: countFindings(nodes, {
        protectedFaces,
        evidenceItems: evidenceRes.count ?? 0,
      }),
      nodes,
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        endsAt: c.ends_at,
      })),
      updatedAt: now.toISOString(),
    };
  });
