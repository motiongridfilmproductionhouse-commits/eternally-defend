import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/* Small hit shape used both server-side and client-side. Mirrors ScanHit from
   /api/scan but decoupled so the persistence layer can evolve independently. */
const HitInput = z.object({
  source: z.string(),
  sourceType: z.string().optional(),
  externalId: z.string().optional().nullable(),
  canonicalUrl: z.string().optional().nullable(),
  permalink: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  author: z.string().optional().nullable(),
  authorHandle: z.string().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
  language: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  publishedAt: z.string().optional().nullable(),
  reach: z.number().optional().nullable(),
  engagement: z.number().optional().nullable(),
  velocity: z.string().optional().nullable(),
  riskScore: z.number().optional().nullable(),
  threatScore: z.number().optional().nullable(),
  severity: z.string().optional().nullable(),
  growthPct: z.number().optional().nullable(),
  narrativeClaim: z.string().optional().nullable(),
  riskType: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).optional(),
  evidenceRefs: z.array(z.record(z.string(), z.unknown())).optional(),
});


export type ScanHitInput = z.infer<typeof HitInput>;

const PersistInput = z.object({
  scanId: z.string().uuid().optional(),
  name: z.string().optional(),
  query: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  sources: z.array(z.string()).optional(),
  period: z.string().optional(),
  hits: z.array(HitInput),
  totals: z.object({
    total: z.number(),
    unique: z.number(),
    duplicatesRemoved: z.number(),
  }).optional(),
  status: z.enum(["queued","running","completed","failed"]).optional(),
});

/** Persist a full scan + hits. Batch-upserts to keep DB cost bounded. */
export const persistScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PersistInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Look up the previous most recent scan for this user+query to compute "new since last"
    const { data: prevRows } = await supabase
      .from("scans")
      .select("id")
      .eq("user_id", userId)
      .eq("query", data.query)
      .order("created_at", { ascending: false })
      .limit(1);
    const previousScanId = prevRows?.[0]?.id ?? null;

    // 2) Insert the scan row
    const { data: scan, error: scanErr } = await supabase
      .from("scans")
      .insert({
        user_id: userId,
        name: data.name ?? data.query,
        query: data.query,
        params: data.params ?? {},
        sources: data.sources ?? [],
        period: data.period,
        status: data.status ?? "completed",
        total_hits: data.totals?.total ?? data.hits.length,
        unique_hits: data.totals?.unique ?? data.hits.length,
        duplicate_hits_removed: data.totals?.duplicatesRemoved ?? 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (scanErr || !scan) throw new Error(scanErr?.message ?? "Failed to create scan");

    // 3) Build unique rows (dedupe within this scan batch by source+external_id||canonical_url)
    const seen = new Set<string>();
    type Row = {
      scan_id: string; user_id: string; source: string; source_type: string | null;
      external_id: string | null; canonical_url: string | null; permalink: string | null;
      title: string | null; description: string | null; author: string | null; author_handle: string | null;
      thumbnail_url: string | null; language: string | null; country: string | null;
      published_at: string | null; reach: number | null; engagement: number | null; velocity: string | null;
      risk_score: number | null; threat_score: number | null; severity: string | null; growth_pct: number | null;
      narrative_claim: string | null; risk_type: string | null; tags: string[];
      metrics: Record<string, unknown>; source_metadata: Record<string, unknown>; evidence_refs: unknown[];
      previous_scan_id: string | null; times_detected: number;
    };
    const rows: Row[] = [];
    let dupsInBatch = 0;
    for (const h of data.hits) {
      const key = `${h.source}::${h.externalId || h.canonicalUrl || h.permalink || ""}`;
      if (!key.endsWith("::")) {
        if (seen.has(key)) { dupsInBatch++; continue; }
        seen.add(key);
      }
      rows.push({
        scan_id: scan.id,
        user_id: userId,
        source: h.source,
        source_type: h.sourceType ?? null,
        external_id: h.externalId ?? null,
        canonical_url: h.canonicalUrl ?? h.permalink ?? null,
        permalink: h.permalink ?? h.canonicalUrl ?? null,
        title: h.title ?? null,
        description: h.description?.slice(0, 2000) ?? null,
        author: h.author ?? null,
        author_handle: h.authorHandle ?? null,
        thumbnail_url: h.thumbnailUrl ?? null,
        language: h.language ?? null,
        country: h.country ?? null,
        published_at: h.publishedAt ?? null,
        reach: h.reach ?? null,
        engagement: h.engagement ?? null,
        velocity: h.velocity ?? null,
        risk_score: h.riskScore ?? h.threatScore ?? null,
        threat_score: h.threatScore ?? null,
        severity: h.severity ?? null,
        growth_pct: h.growthPct ?? null,
        narrative_claim: h.narrativeClaim ?? null,
        risk_type: h.riskType ?? null,
        tags: h.tags ?? [],
        metrics: h.metrics ?? {},
        source_metadata: h.sourceMetadata ?? {},
        evidence_refs: h.evidenceRefs ?? [],
        previous_scan_id: previousScanId,
        times_detected: 1,
      });
    }

    // 4) Batch upsert in chunks of 500 to keep round-trips bounded
    let newCount = 0;
    let updatedCount = 0;
    const CHUNK = 500;

    // Prefer external_id path; fall back to canonical_url when external_id is null.
    const withExt = rows.filter(r => r.external_id);
    const withoutExt = rows.filter(r => !r.external_id && r.canonical_url);

    async function upsert(batch: Row[], onConflict: string) {
      for (let i = 0; i < batch.length; i += CHUNK) {
        const slice = batch.slice(i, i + CHUNK);
        // Fetch existing to compute new-vs-updated cheaply
        const ids = slice.map(r => (onConflict.includes("external_id") ? r.external_id : r.canonical_url)).filter(Boolean) as string[];
        const col = onConflict.includes("external_id") ? "external_id" : "canonical_url";
        const { data: existing } = await supabase
          .from("scan_hits")
          .select(`id, source, ${col}, times_detected`)
          .eq("user_id", userId)
          .in(col, ids);
        const existingKey = new Set(((existing ?? []) as Array<Record<string, unknown>>).map(e => `${String(e.source)}::${String(e[col])}`));

        // Increment times_detected on matches; mark as not-new
        const now = new Date().toISOString();
        const upsertRows = slice.map(r => {
          const key = `${r.source}::${col === "external_id" ? r.external_id : r.canonical_url}`;
          const isExisting = existingKey.has(key);
          if (isExisting) updatedCount++; else newCount++;
          return {
            ...r,
            last_seen_at: now,
            previous_scan_seen: isExisting,
            is_new_since_last_scan: !isExisting,
            times_detected: isExisting ? 2 : 1, // conservative bump; a trigger could do +1 precisely
          };
        });
        const { error } = await supabase
          .from("scan_hits")
          .upsert(upsertRows as never, { onConflict: `user_id,source,${col}`, ignoreDuplicates: false });
        if (error) throw new Error(`scan_hits upsert failed: ${error.message}`);

      }
    }

    if (withExt.length) await upsert(withExt, "user_id,source,external_id");
    if (withoutExt.length) await upsert(withoutExt, "user_id,source,canonical_url");

    // 5) Finalize counters on the scan row
    await supabase
      .from("scans")
      .update({
        new_hits: newCount,
        updated_hits: updatedCount,
        duplicate_hits_removed: (data.totals?.duplicatesRemoved ?? 0) + dupsInBatch,
        unique_hits: newCount + updatedCount,
      })
      .eq("id", scan.id);

    return {
      scanId: scan.id,
      newHits: newCount,
      updatedHits: updatedCount,
      duplicatesRemoved: (data.totals?.duplicatesRemoved ?? 0) + dupsInBatch,
      uniqueHits: newCount + updatedCount,
    };
  });

const ListInput = z.object({
  scanId: z.string().uuid().optional(),
  source: z.string().optional(),
  severity: z.string().optional(),
  onlyNew: z.boolean().optional(),
  limit: z.number().min(1).max(100).default(24),
  // Cursor is a compound key: publishedAt|threatScore|id from the last row of the previous page.
  cursor: z.object({
    publishedAt: z.string().nullable(),
    threatScore: z.number().nullable(),
    id: z.string(),
  }).optional(),
});

/** Cursor-paginated list of scan hits for the current user. Default sort: newest published, then threat score, then id. */
export const listScanHits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("scan_hits")
      .select("id, scan_id, source, source_type, external_id, canonical_url, permalink, title, description, author, thumbnail_url, published_at, detected_at, reach, engagement, velocity, risk_score, threat_score, severity, growth_pct, narrative_claim, risk_type, tags, is_new_since_last_scan, times_detected, first_seen_at, last_seen_at")
      .eq("user_id", userId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("threat_score", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(data.limit + 1);

    if (data.scanId) q = q.eq("scan_id", data.scanId);
    if (data.source) q = q.eq("source", data.source);
    if (data.severity) q = q.eq("severity", data.severity);
    if (data.onlyNew) q = q.eq("is_new_since_last_scan", true);

    // Keyset pagination: (published_at, threat_score, id) < cursor
    if (data.cursor) {
      // Emulate compound keyset with an OR filter
      const { publishedAt, threatScore, id } = data.cursor;
      const parts: string[] = [];
      if (publishedAt) parts.push(`published_at.lt.${publishedAt}`);
      // Same published_at, lower threat_score
      if (publishedAt !== null && threatScore !== null) parts.push(`and(published_at.eq.${publishedAt},threat_score.lt.${threatScore})`);
      // Same published_at + same threat_score, lower id
      if (publishedAt !== null && threatScore !== null) parts.push(`and(published_at.eq.${publishedAt},threat_score.eq.${threatScore},id.lt.${id})`);
      if (parts.length) q = q.or(parts.join(","));
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const items = rows ?? [];
    const hasMore = items.length > data.limit;
    const page = hasMore ? items.slice(0, data.limit) : items;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? { publishedAt: last.published_at, threatScore: last.threat_score, id: last.id }
      : null;
    return { items: page, nextCursor };
  });

/** Aggregate summary counts for the current user's most recent scan, or a given scan. */
export const getScanSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ scanId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let query = supabase.from("scans").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    if (data.scanId) query = supabase.from("scans").select("*").eq("user_id", userId).eq("id", data.scanId).limit(1);
    const { data: scans, error } = await query;
    if (error) throw new Error(error.message);
    return scans?.[0] ?? null;
  });
