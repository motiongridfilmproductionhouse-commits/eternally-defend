/**
 * Deduplicated batch persistence helpers for deepfake scan progress.
 */

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
  const fresh = input.rows.filter((row) => {
    const key = String(row.canonical_url ?? row.page_url ?? "");
    if (!key || input.alreadyPersisted.has(key) || seenInBatch.has(key)) {
      return false;
    }
    seenInBatch.add(key);
    return true;
  });

  if (!fresh.length) return 0;

  const discoveryRows = fresh.map((hit) => ({
    user_id: input.userId,
    scan_id: input.scanId,
    source: (hit as any).source ?? "firecrawl",
    search_query:
      String((hit as any).query ?? "").trim() || input.targetName,
    page_url: (hit as any).final_url ?? (hit as any).page_url,
    canonical_url: (hit as any).canonical_url,
    source_host:
      (hit as any).verified_domain ??
      input.hostOf(String((hit as any).final_url ?? (hit as any).page_url ?? "")),
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

  for (const hit of fresh) {
    const key = String(hit.canonical_url ?? hit.page_url ?? "");
    if (key) input.alreadyPersisted.add(key);
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
