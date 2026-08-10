/**
 * Client-safe presentation gate for the Verified Explicit Synthetic Threats feed.
 *
 * The strict server gate (`filter.server.ts`) expects `url`/`title` and a populated
 * `face_similarity`, while persisted client findings expose `page_title`,
 * `final_url`/`canonical_url` and often only `identity_confidence`. Mapping those
 * fields here is what makes verified threats visible again in the UI.
 */
import type { ClientFinding } from "./results-dashboard";

export type ThreatTier = "VERIFIED" | "PROBABLE";

const NEVER_DISPLAY = [
  "wikipedia.org",
  "imdb.com",
  "rottentomatoes.com",
  ".edu",
  ".gov",
  "apps.apple.com",
  "play.google.com",
  "amazon.",
  "asianetnews.",
  "filmibeat.",
  "pinterest.com",
];

export function threatFeedUrl(f: ClientFinding): string {
  return (
    f.final_url?.trim() ||
    f.canonical_url?.trim() ||
    f.url?.trim() ||
    f.discovered_url?.trim() ||
    ""
  );
}

function faceScore(f: ClientFinding): number {
  return Math.max(
    Number(f.face_similarity ?? 0) || 0,
    Number(f.identity_confidence ?? 0) || 0,
    f.face_referenced ? 80 : 0,
  );
}

/**
 * Grade a finding for the client threat feed.
 * VERIFIED — face ≥85 plus confirmed explicit + synthetic signals.
 * PROBABLE — face ≥70 with at least one explicit/synthetic confirmation.
 */
export function gradeThreatFinding(f: ClientFinding | null | undefined): ThreatTier | null {
  if (!f) return null;
  const url = threatFeedUrl(f).toLowerCase();
  const title = (f.page_title || "").toLowerCase();
  const cls = (f.finding_classification || "").toUpperCase();
  const category = (f.content_category || "").toUpperCase();

  if (url && NEVER_DISPLAY.some((host) => url.includes(host))) return null;
  if ((f.review_status || "").toLowerCase() === "dismissed") return null;

  const face = faceScore(f);

  const explicit =
    f.explicit_media_confirmed === true ||
    cls.includes("EXPLICIT") ||
    cls.includes("NUDITY") ||
    cls.includes("INTIMATE") ||
    category.includes("EXPLICIT") ||
    category.includes("NUDITY") ||
    category.includes("INTIMATE") ||
    category.includes("SEXUAL");

  const synthetic =
    f.synthetic_media_confirmed === true ||
    f.is_synthetic === true ||
    Number(f.synthetic_media_confidence ?? 0) >= 70 ||
    cls.includes("SYNTHETIC") ||
    cls.includes("DEEPFAKE") ||
    cls.includes("FACE_SWAP") ||
    category.includes("DEEPFAKE") ||
    category.includes("FACE_SWAP");

  const hosting =
    f.hosting_or_distribution_confirmed === true ||
    f.takedown_recommended === true ||
    /t\.me|terabox|mega\.nz|pixeldrain|mrdeepfakes|sexcelebrity|coomer|nifty/.test(url) ||
    /\/video|\/image|\.jpg|\.jpeg|\.png|\.webp|\.mp4/.test(url) ||
    title.includes("gallery") ||
    title.includes("download");

  if (face >= 85 && explicit && synthetic && hosting) return "VERIFIED";
  if (face >= 70 && (explicit || synthetic)) return "PROBABLE";
  if (cls.includes("VERIFIED") && (explicit || synthetic)) return "VERIFIED";
  return null;
}

export type GradedThreat = { finding: ClientFinding; tier: ThreatTier };

/** Deduplicated, verified-first threat feed for the results list. */
export function selectThreatFeed(findings: ClientFinding[] | null | undefined): GradedThreat[] {
  const seen = new Set<string>();
  const rows: GradedThreat[] = [];
  for (const finding of findings ?? []) {
    const tier = gradeThreatFinding(finding);
    if (!tier) continue;
    const key = threatFeedUrl(finding).toLowerCase() || `id:${finding.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ finding, tier });
  }
  rows.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "VERIFIED" ? -1 : 1));
  return rows;
}

export function countVerified(rows: GradedThreat[]): number {
  return rows.filter((r) => r.tier === "VERIFIED").length;
}
