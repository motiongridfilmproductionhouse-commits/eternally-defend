/**
 * Candidate normalization for public-web asset discovery.
 *
 * Reverse-image / search providers return noisy leads. This module turns them
 * into a stable candidate identity BEFORE anything is written to the database:
 *
 *  - `page_url`  — the exact public page displaying the media. This is the only
 *                  actionable enforcement surface.
 *  - `media_url` — the direct media asset used for perceptual comparison. CDN
 *                  media URLs rotate, so they are evidence, never identity.
 *
 * Candidate identity is (user_id, protected_asset_id, canonical_page_url).
 *
 * Nothing here decides infringement. A normalized candidate is a lead only.
 */
import { classifyPlatform, type PlatformClassification } from "@/lib/media/platform-classifier";

/** Query params that never change which page a URL points at. */
const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^ga_/i,
  /^_ga$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^fbclid$/i,
  /^msclkid$/i,
  /^igshid$/i,
  /^igsh$/i,
  /^si$/i,
  /^spm$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^ref_url$/i,
  /^refsrc$/i,
  /^source$/i,
  /^share_id$/i,
  /^shared$/i,
  /^feature$/i,
  /^yclid$/i,
  /^campaign$/i,
];

function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((re) => re.test(key));
}

/**
 * Canonical form of a candidate page URL. Deterministic and idempotent:
 * `canonicalizePageUrl(canonicalizePageUrl(x)) === canonicalizePageUrl(x)`.
 */
export function canonicalizePageUrl(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";

  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingParam(key)) parsed.searchParams.delete(key);
  }
  // stable param order so ?b=2&a=1 and ?a=1&b=2 dedupe together
  const entries = [...parsed.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = new URLSearchParams();
  for (const [k, v] of entries) search.append(k, v);
  parsed.search = search.toString() ? `?${search.toString()}` : "";

  return parsed.toString();
}

export function hostOfUrl(input: string): string | null {
  try {
    return new URL(input).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export interface RawProviderCandidate {
  pageUrl: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  title?: string | null;
  provider: string;
  matchType?: string | null;
  platform?: PlatformClassification | null;
}

export interface NormalizedCandidate {
  pageUrl: string;
  canonicalPageUrl: string;
  mediaUrl: string | null;
  host: string;
  platform: string | null;
  pageTitle: string | null;
  provider: string;
  matchType: string;
  /** why the candidate was dropped is reported separately; this is always kept */
  hasExactPageUrl: boolean;
}

export type RejectionReason =
  | "missing_page_url"
  | "unparseable_page_url"
  | "search_surface"
  | "infrastructure_host";

export interface NormalizationResult {
  candidates: NormalizedCandidate[];
  rejected: Array<{ pageUrl: string | null; reason: RejectionReason; provider: string }>;
}

/** Normalize one provider lead. Returns the rejection reason instead of throwing. */
export function normalizeProviderCandidate(
  raw: RawProviderCandidate,
): { ok: true; candidate: NormalizedCandidate } | { ok: false; reason: RejectionReason } {
  if (!raw.pageUrl || !raw.pageUrl.trim()) return { ok: false, reason: "missing_page_url" };
  const canonical = canonicalizePageUrl(raw.pageUrl);
  if (!canonical) return { ok: false, reason: "unparseable_page_url" };

  const platform = raw.platform ?? classifyPlatform(canonical);
  // A search-results page or a CDN/proxy host is never a removal target.
  if (platform?.isSearchSurface) return { ok: false, reason: "search_surface" };
  if (platform?.isInfrastructure) return { ok: false, reason: "infrastructure_host" };

  const media = raw.imageUrl?.trim() || raw.thumbnailUrl?.trim() || null;

  return {
    ok: true,
    candidate: {
      pageUrl: raw.pageUrl.trim(),
      canonicalPageUrl: canonical,
      mediaUrl: media,
      host: hostOfUrl(canonical) ?? "",
      platform: platform?.kind ?? null,
      pageTitle: raw.title?.trim() || null,
      provider: raw.provider,
      matchType: raw.matchType || "visual",
      hasExactPageUrl: Boolean(platform?.hasExactUrl ?? true),
    },
  };
}

const MATCH_TYPE_RANK: Record<string, number> = { exact: 3, visual: 2, page: 1 };

/**
 * Collapse candidates sharing a canonical page URL.
 *
 * Media URLs rotate, so the surviving row keeps the first media URL we saw and
 * back-fills one when the winning lead had none.
 */
export function dedupeNormalizedCandidates(
  candidates: NormalizedCandidate[],
): NormalizedCandidate[] {
  const byKey = new Map<string, NormalizedCandidate>();
  for (const candidate of candidates) {
    const existing = byKey.get(candidate.canonicalPageUrl);
    if (!existing) {
      byKey.set(candidate.canonicalPageUrl, candidate);
      continue;
    }
    const better =
      (MATCH_TYPE_RANK[candidate.matchType] ?? 0) > (MATCH_TYPE_RANK[existing.matchType] ?? 0);
    const winner = better ? { ...candidate } : { ...existing };
    winner.mediaUrl = winner.mediaUrl ?? existing.mediaUrl ?? candidate.mediaUrl ?? null;
    winner.pageTitle = winner.pageTitle ?? existing.pageTitle ?? candidate.pageTitle ?? null;
    byKey.set(candidate.canonicalPageUrl, winner);
  }
  return [...byKey.values()];
}

/** Normalize + dedupe a provider batch in one call. */
export function normalizeCandidateBatch(raws: RawProviderCandidate[]): NormalizationResult {
  const kept: NormalizedCandidate[] = [];
  const rejected: NormalizationResult["rejected"] = [];
  for (const raw of raws) {
    const result = normalizeProviderCandidate(raw);
    if (result.ok) kept.push(result.candidate);
    else rejected.push({ pageUrl: raw.pageUrl, reason: result.reason, provider: raw.provider });
  }
  return { candidates: dedupeNormalizedCandidates(kept), rejected };
}

/** Database identity of a candidate — mirrors the unique index exactly. */
export function candidateIdentityKey(
  userId: string,
  protectedAssetId: string,
  canonicalPageUrl: string,
): string {
  return `${userId}|${protectedAssetId}|${canonicalPageUrl}`;
}
