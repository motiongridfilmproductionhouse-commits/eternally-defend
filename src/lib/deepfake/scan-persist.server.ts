/**
 * Deduplicated batch persistence helpers for deepfake scan progress.
 */

import { requireNonEmptyDiscoveryPageUrl } from "./discovery-dedupe";

export function findingPersistKey(row: {
  canonical_url?: string | null;
  final_url?: string | null;
  url?: string | null;
}): string {
  return (
    row.canonical_url?.trim() ||
    row.final_url?.trim() ||
    row.url?.trim() ||
    ""
  );
}

export async function upsertDiscoveriesBatch(input: {
  supabase: any;
  userId: string;
  scanId: string;
  targetName: string;
  hostOf: (url: string) => string | null;
  rows: Array<Record<string, unknown>>;
  alreadyPersisted: Set<string>;
}): Promise<number> {
  const seenInBatch = new Set<string>();
  const fresh = input.rows.flatMap((row) => {
    const pageUrl = requireNonEmptyDiscoveryPageUrl({
      final_url: (row as any).final_url,
      page_url: (row as any).page_url,
    });
    if (!pageUrl) return [];

    const key = String((row as any).canonical_url ?? pageUrl);
    if (!key || input.alreadyPersisted.has(key) || seenInBatch.has(key)) {
      return [];
    }
    seenInBatch.add(key);
    return [{ row, pageUrl, key }];
  });

  if (!fresh.length) return 0;

  const discoveryRows = fresh.map(({ row: hit, pageUrl }) => ({
    user_id: input.userId,
    scan_id: input.scanId,
    source: (hit as any).source ?? "firecrawl",
    search_query:
      String((hit as any).query ?? "").trim() || input.targetName,
    page_url: pageUrl,
    canonical_url: (hit as any).canonical_url ?? pageUrl,
    source_host:
      (hit as any).verified_domain ??
      input.hostOf(pageUrl),
    page_title: (hit as any).page_title ?? null,
    snippet: (hit as any).page_description ?? null,
    image_url: (hit as any).image_url ?? null,
    thumbnail_url: (hit as any).thumbnail_url ?? null,
    media_type:
      (hit as any).image_url || (hit as any).thumbnail_url
        ? "image"
        : null,
    analysis_status: "url_verified",
    updated_at: new Date().toISOString(),
  }));

  if (discoveryRows.some((row) => !row.page_url?.trim())) {
    throw new Error(
      "URL-verified discovery upsert refused empty page_url.",
    );
  }

  const { error } = await (input.supabase as any)
    .from("deepfake_discoveries")
    .upsert(discoveryRows, { onConflict: "scan_id,page_url" });

  if (error) {
    console.warn(
      "[DEEPFAKE] Unable to store verified discoveries:",
      error.message,
    );
    return 0;
  }

  for (const item of fresh) {
    input.alreadyPersisted.add(item.key);
  }

  return discoveryRows.length;
}

export async function upsertFindingsBatch(input: {
  supabase: any;
  rows: Array<Record<string, unknown>>;
  alreadyPersisted: Set<string>;
}): Promise<number> {
  const seenInBatch = new Set<string>();
  const fresh = input.rows.filter((row) => {
    const key = findingPersistKey(row as any);
    if (!key || input.alreadyPersisted.has(key) || seenInBatch.has(key)) {
      return false;
    }
    seenInBatch.add(key);
    return true;
  });

  if (!fresh.length) return 0;

  const { error: fErr } = await input.supabase
    .from("deepfake_findings")
    .upsert(fresh as any, { onConflict: "scan_id,url" });

  if (fErr) {
    const missingColumn =
      /finding_classification|page_type|identity_confidence|synthetic_media_confidence|matched_evidence|classification_explanation|discovered_url|final_url|canonical_url|http_status|redirect_chain|crawled_at|url_verification_status|url_rejection_reason|column .* does not exist|schema cache/i.test(
        fErr.message,
      );

    if (missingColumn) {
      const legacyRows = fresh.map((row) => {
        const {
          finding_classification: _fc,
          page_type: _pt,
          identity_confidence: _ic,
          synthetic_media_confidence: _sc,
          matched_evidence: _me,
          classification_explanation: _ce,
          discovered_url: _du,
          final_url: _fu,
          canonical_url: _cu,
          http_status: _hs,
          redirect_chain: _rc,
          crawled_at: _ca,
          url_verification_status: _uv,
          url_rejection_reason: _ur,
          ...legacy
        } = row as any;
        return legacy;
      });

      const { error: legacyErr } = await input.supabase
        .from("deepfake_findings")
        .upsert(legacyRows as any, { onConflict: "scan_id,url" });

      if (legacyErr) {
        console.warn(
          "[deepfake] findings insert (legacy fallback):",
          legacyErr.message,
        );
        return 0;
      }
    } else {
      console.warn("[deepfake] findings insert:", fErr.message);
      return 0;
    }
  }

  for (const row of fresh) {
    const key = findingPersistKey(row as any);
    if (key) input.alreadyPersisted.add(key);
  }

  return fresh.length;
}
