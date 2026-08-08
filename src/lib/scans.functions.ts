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
  totals: z
    .object({
      total: z.number(),
      unique: z.number(),
      duplicatesRemoved: z.number(),
    })
    .optional(),
  status: z.enum(["queued", "running", "completed", "failed"]).optional(),
});

/** Persist a full scan + hits. Batch-upserts to keep DB cost bounded. */
export const persistScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PersistInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const startTime = Date.now();

    const youtubeCount = data.hits.filter(
      (h) => h.source === "YouTube" || (h.sourceType ?? "").toLowerCase().includes("youtube"),
    ).length;
    const socialWebCount = data.hits.length - youtubeCount;

    console.log(
      `[web-scan:persist:start] scanId=${data.scanId ?? "new"} query="${data.query}" discoveredCount=${data.hits.length} youtubeCount=${youtubeCount} socialWebCount=${socialWebCount}`,
    );

    // 1) Look up the previous most recent scan for this user+query to compute "new since last"
    const { data: prevRows } = await supabase
      .from("scans")
      .select("id")
      .eq("user_id", userId)
      .eq("query", data.query)
      .order("created_at", { ascending: false })
      .limit(1);
    const previousScanId = prevRows?.[0]?.id ?? null;

    // 2) Insert the scan row initially as "running" or requested status
    const initialStatus = data.status ?? "running";
    const { data: scan, error: scanErr } = await supabase
      .from("scans")
      .insert({
        user_id: userId,
        name: data.name ?? data.query,
        query: data.query,
        params: (data.params ?? {}) as never,
        sources: data.sources ?? [],
        period: data.period,
        status: initialStatus,
        total_hits: data.totals?.total ?? data.hits.length,
        unique_hits: data.totals?.unique ?? data.hits.length,
        duplicate_hits_removed: data.totals?.duplicatesRemoved ?? 0,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (scanErr || !scan) {
      console.error("[web-scan:persist:error]", {
        scanId: null,
        table: "scans",
        operation: "insert",
        findingCount: data.hits.length,
        code: scanErr?.code ?? "UNKNOWN",
        message: scanErr?.message ?? "Failed to create scan row",
        details: scanErr?.details ?? null,
        hint: scanErr?.hint ?? null,
      });
      throw new Error(`Failed to create scan: ${scanErr?.message ?? "Database error"}`);
    }
    const scanId = scan.id;

    // 3) Build unique rows (dedupe within this scan batch by source+external_id||canonical_url)
    const seen = new Set<string>();
    type Row = {
      scan_id: string;
      user_id: string;
      source: string;
      source_type: string | null;
      external_id: string | null;
      canonical_url: string | null;
      permalink: string | null;
      title: string | null;
      description: string | null;
      author: string | null;
      author_handle: string | null;
      thumbnail_url: string | null;
      language: string | null;
      country: string | null;
      published_at: string | null;
      reach: number | null;
      engagement: number | null;
      velocity: string | null;
      risk_score: number | null;
      threat_score: number | null;
      severity: string | null;
      growth_pct: number | null;
      narrative_claim: string | null;
      risk_type: string | null;
      tags: string[];
      metrics: Record<string, unknown>;
      source_metadata: Record<string, unknown>;
      evidence_refs: unknown[];
      previous_scan_id: string | null;
      times_detected: number;
    };
    const rows: Row[] = [];
    let dupsInBatch = 0;
    for (const h of data.hits) {
      const key = `${h.source}::${h.externalId || h.canonicalUrl || h.permalink || ""}`;
      if (!key.endsWith("::")) {
        if (seen.has(key)) {
          dupsInBatch++;
          continue;
        }
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

    // 4) Batch upsert in chunks of 500 with exact conflict key deduplication
    let newCount = 0;
    let updatedCount = 0;
    let persistenceMode: "upsert" | "insert-fallback" = "upsert";
    const CHUNK = 500;

    // Deduplicate withExt specifically by (user_id, source, external_id)
    const withExtMap = new Map<string, Row>();
    for (const r of rows.filter((x) => x.external_id)) {
      const k = `${r.user_id}::${r.source}::${r.external_id}`;
      if (!withExtMap.has(k)) withExtMap.set(k, r);
      else dupsInBatch++;
    }
    const withExt = Array.from(withExtMap.values());

    // Deduplicate withoutExt specifically by (user_id, source, canonical_url)
    const withoutExtMap = new Map<string, Row>();
    for (const r of rows.filter((x) => !x.external_id && x.canonical_url)) {
      const k = `${r.user_id}::${r.source}::${r.canonical_url}`;
      if (!withoutExtMap.has(k)) withoutExtMap.set(k, r);
      else dupsInBatch++;
    }
    const withoutExt = Array.from(withoutExtMap.values());

    async function upsertBatch(batch: Row[], onConflict: string) {
      for (let i = 0; i < batch.length; i += CHUNK) {
        const slice = batch.slice(i, i + CHUNK);
        const col = onConflict.includes("external_id") ? "external_id" : "canonical_url";
        const ids = slice
          .map((r) => (col === "external_id" ? r.external_id : r.canonical_url))
          .filter(Boolean) as string[];

        const { data: existing } = await supabase
          .from("scan_hits")
          .select(`id, source, ${col}, times_detected`)
          .eq("user_id", userId)
          .in(col, ids);

        const existingKey = new Set(
          ((existing ?? []) as Array<Record<string, unknown>>).map(
            (e) => `${String(e.source)}::${String(e[col])}`,
          ),
        );

        const now = new Date().toISOString();
        const upsertRows = slice.map((r) => {
          const key = `${r.source}::${col === "external_id" ? r.external_id : r.canonical_url}`;
          const isExisting = existingKey.has(key);
          if (isExisting) updatedCount++;
          else newCount++;
          return {
            ...r,
            last_seen_at: now,
            previous_scan_seen: isExisting,
            is_new_since_last_scan: !isExisting,
            times_detected: isExisting ? 2 : 1,
          };
        });

        // Attempt upsert with conflict target
        const { error } = await supabase
          .from("scan_hits")
          .upsert(upsertRows as never, {
            onConflict: `user_id,source,${col}`,
            ignoreDuplicates: false,
          });

        if (error) {
          persistenceMode = "insert-fallback";
          console.warn(
            `[web-scan:persist:warn] scan_hits upsert with onConflict (${onConflict}) returned error: ${error.message}. Retrying plain insert fallback.`,
          );
          // Fallback plain insert if ON CONFLICT clause failed
          const { error: insertErr } = await supabase
            .from("scan_hits")
            .insert(upsertRows as never);

          if (insertErr) {
            console.error("[web-scan:persist:error]", {
              scanId,
              table: "scan_hits",
              operation: "upsert_fallback_insert",
              findingCount: slice.length,
              code: insertErr.code,
              message: insertErr.message,
              details: insertErr.details,
              hint: insertErr.hint,
            });

            // Mark scan as failed before throwing
            await supabase.from("scans").update({ status: "failed" }).eq("id", scanId);
            console.log(
              `[web-scan:finalize] scanId=${scanId} previousStatus=${initialStatus} newStatus=failed`,
            );
            throw new Error(`scan_hits insert failed: ${insertErr.message}`);
          }
        }
      }
    }

    try {
      if (withExt.length) await upsertBatch(withExt, "user_id,source,external_id");
      if (withoutExt.length) await upsertBatch(withoutExt, "user_id,source,canonical_url");
    } catch (err) {
      await supabase.from("scans").update({ status: "failed" }).eq("id", scanId);
      console.log(
        `[web-scan:finalize] scanId=${scanId} previousStatus=${initialStatus} newStatus=failed`,
      );
      throw err;
    }

    // 5) Finalize status & counters on the scan row
    const finalStatus = "completed";
    const durationMs = Date.now() - startTime;
    await supabase
      .from("scans")
      .update({
        status: finalStatus,
        new_hits: newCount,
        updated_hits: updatedCount,
        duplicate_hits_removed: (data.totals?.duplicatesRemoved ?? 0) + dupsInBatch,
        unique_hits: newCount + updatedCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", scanId);

    console.log(
      `[web-scan:persist:success] scanId=${scanId} insertedCount=${newCount + updatedCount} persistenceMode=${persistenceMode} durationMs=${durationMs}`,
    );
    console.log(
      `[web-scan:finalize] scanId=${scanId} previousStatus=${initialStatus} newStatus=${finalStatus}`,
    );

    // 6) Non-blocking AWS Rekognition face analysis for hits with images.
    void (async () => {
      try {
        const { data: recent } = await supabase
          .from("scan_hits")
          .select("id,thumbnail_url,permalink,canonical_url,source")
          .eq("scan_id", scanId)
          .limit(20);
        if (recent && recent.length > 0) {
          const { analyzeHitForFaces, pickScanImageUrl } = await import("./face-scan.server");
          for (const h of recent) {
            const pick = pickScanImageUrl(h);
            if (!pick) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await analyzeHitForFaces({
              supabase: supabase as any,
              userId,
              scanHitId: h.id,
              imageUrl: pick.url,
              sourceType: pick.type,
            }).catch(() => null);
          }
        }
      } catch (e) {
        console.warn("[scans] face analysis skipped", (e as Error).message);
      }
    })();

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
  hiddenFilter: z.enum(["active", "hidden", "all"]).optional().default("active"),
  limit: z.number().min(1).max(100).default(24),
  // Cursor is a compound key: publishedAt|threatScore|id from the last row of the previous page.
  cursor: z
    .object({
      publishedAt: z.string().nullable(),
      threatScore: z.number().nullable(),
      id: z.string(),
    })
    .optional(),
});

/** Cursor-paginated list of scan hits for the current user. Default sort: newest published, then threat score, then id. */
export const listScanHits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("scan_hits")
      .select(
        "id, scan_id, source, source_type, external_id, canonical_url, permalink, title, description, author, thumbnail_url, published_at, detected_at, reach, engagement, velocity, risk_score, threat_score, severity, growth_pct, narrative_claim, risk_type, tags, is_new_since_last_scan, times_detected, first_seen_at, last_seen_at, hidden_at, hidden_reason",
      )
      .eq("user_id", userId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("threat_score", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(data.limit + 1);

    if (data.scanId) q = q.eq("scan_id", data.scanId);
    if (data.source) q = q.eq("source", data.source);
    if (data.severity) q = q.eq("severity", data.severity);
    if (data.onlyNew) q = q.eq("is_new_since_last_scan", true);
    if (data.hiddenFilter === "active") q = q.is("hidden_at", null);
    else if (data.hiddenFilter === "hidden") q = q.not("hidden_at", "is", null);

    // Keyset pagination: (published_at, threat_score, id) < cursor
    if (data.cursor) {
      // Emulate compound keyset with an OR filter
      const { publishedAt, threatScore, id } = data.cursor;
      const parts: string[] = [];
      if (publishedAt) parts.push(`published_at.lt.${publishedAt}`);
      // Same published_at, lower threat_score
      if (publishedAt !== null && threatScore !== null)
        parts.push(`and(published_at.eq.${publishedAt},threat_score.lt.${threatScore})`);
      // Same published_at + same threat_score, lower id
      if (publishedAt !== null && threatScore !== null)
        parts.push(
          `and(published_at.eq.${publishedAt},threat_score.eq.${threatScore},id.lt.${id})`,
        );
      if (parts.length) q = q.or(parts.join(","));
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const items = rows ?? [];
    const hasMore = items.length > data.limit;
    const page = hasMore ? items.slice(0, data.limit) : items;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
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
    let query = supabase
      .from("scans")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data.scanId)
      query = supabase
        .from("scans")
        .select("*")
        .eq("user_id", userId)
        .eq("id", data.scanId)
        .limit(1);
    const { data: scans, error } = await query;
    if (error) throw new Error(error.message);
    return scans?.[0] ?? null;
  });

/** 14-day threat trends grouped by day and risk_type for the current user. */
export const getThreatTrends = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ days: z.number().min(1).max(90).default(14) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await supabase
      .from("scan_hits")
      .select("detected_at, risk_type")
      .eq("user_id", userId)
      .gte("detected_at", since);
    if (error) throw new Error(error.message);

    // Bucket by yyyy-mm-dd + risk_type
    const buckets = new Map<string, Record<string, number>>();
    for (let i = data.days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      buckets.set(d, {});
    }
    const typeSet = new Set<string>();
    for (const r of rows ?? []) {
      if (!r.detected_at) continue;
      const key = r.detected_at.slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      const t = (r.risk_type ?? "Other").trim() || "Other";
      typeSet.add(t);
      b[t] = (b[t] ?? 0) + 1;
    }
    const types = Array.from(typeSet);
    const series = Array.from(buckets.entries()).map(([day, counts], i) => {
      const row: Record<string, string | number> = { day: `D${i + 1}`, date: day };
      for (const t of types) row[t] = counts[t] ?? 0;
      return row;
    });
    return { series, types, totalHits: rows?.length ?? 0 };
  });
