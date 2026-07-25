import type { RawHit, ClassifiedHit } from "./classify.server";

export type CandidateDecision = "accepted" | "triage" | "rejected";

export interface FilteredCandidate extends RawHit {
  content_match_score: number;
  candidate_decision: CandidateDecision;
  rejection_reason?: string;
}

const LISTING_PATTERNS = [
  /\/search(?:\/|\?|$)/i,
  /[?&](?:q|query|search|keyword)=/i,
  /\/tag(?:s)?(?:\/|\?|$)/i,
  /\/category(?:\/|\?|$)/i,
  /\/browse(?:\/|\?|$)/i,
  /\/explore(?:\/|\?|$)/i,
  /\/discover(?:\/|\?|$)/i,
];

const GENERIC_TITLES = [
  /^search$/i,
  /^search results?$/i,
  /^videos?$/i,
  /^images?$/i,
  /^browse$/i,
  /^explore$/i,
  /^discover$/i,
  /^no information is available/i,
];

export function normalizeDeepfakeText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function targetNames(target: {
  name: string;
  aliases?: string[];
  handles?: string[];
}): string[] {
  return [
    target.name,
    ...(target.aliases ?? []),
    ...(target.handles ?? []),
  ]
    .map(normalizeDeepfakeText)
    .filter((value) => value.length >= 3);
}

function containsTarget(text: string, names: string[]): boolean {
  const normalized = normalizeDeepfakeText(text);

  return names.some((name) => {
    if (!name) return false;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(normalized);
  });
}

function isListingUrl(url: string): boolean {
  return LISTING_PATTERNS.some((pattern) => pattern.test(url));
}

function isGenericTitle(title: string): boolean {
  const clean = title.trim();
  return !clean || GENERIC_TITLES.some((pattern) => pattern.test(clean));
}

export function scoreDeepfakeCandidate(
  hit: RawHit,
  target: {
    name: string;
    aliases?: string[];
    handles?: string[];
  },
): number {
  const names = targetNames(target);

  const title = hit.title ?? "";
  const description = hit.description ?? "";

  const titleMatch = containsTarget(title, names);
  const descriptionMatch = containsTarget(description, names);
  const visibleMatch = titleMatch || descriptionMatch;

  let decodedUrl = hit.url;

  try {
    decodedUrl = decodeURIComponent(hit.url);
  } catch {
    // Keep original URL when malformed encoding is present.
  }

  const urlMatch = containsTarget(decodedUrl, names);
  const listing = isListingUrl(hit.url);
  const genericTitle = isGenericTitle(title);
  const weakDescription = description.trim().length < 40;

  let score = 0;

  if (titleMatch) score += 45;
  if (descriptionMatch) score += 35;
  if (title.trim().length >= 8) score += 5;
  if (description.trim().length >= 80) score += 10;

  if (listing) score -= 30;
  if (genericTitle) score -= 15;
  if (!title.trim()) score -= 15;
  if (!description.trim()) score -= 15;

  // The target exists only inside the URL/search query.
  if (urlMatch && !visibleMatch) score -= 45;

  // Bare listing/search page with no visible target evidence.
  if (listing && !visibleMatch && (genericTitle || weakDescription)) {
    score -= 30;
  }

  return Math.max(0, Math.min(100, score));
}

export function filterDeepfakeCandidates(
  hits: RawHit[],
  target: {
    name: string;
    aliases?: string[];
    handles?: string[];
  },
): {
  accepted: FilteredCandidate[];
  triage: FilteredCandidate[];
  rejected: FilteredCandidate[];
} {
  const accepted: FilteredCandidate[] = [];
  const triage: FilteredCandidate[] = [];
  const rejected: FilteredCandidate[] = [];

  for (const hit of hits) {
    const contentMatchScore = scoreDeepfakeCandidate(hit, target);
    const listing = isListingUrl(hit.url);

    const names = targetNames(target);
    const visibleText = `${hit.title ?? ""} ${hit.description ?? ""}`;
    const visibleTargetMatch = containsTarget(visibleText, names);

    let decision: CandidateDecision;
    let rejectionReason: string | undefined;

    if (listing && !visibleTargetMatch && contentMatchScore < 35) {
      decision = "rejected";
      rejectionReason = "Bare search/listing page without visible target match";
    } else if (contentMatchScore >= 50) {
      decision = "accepted";
    } else if (contentMatchScore >= 25) {
      decision = "triage";
      rejectionReason = "Weak or incomplete target-content match";
    } else {
      decision = "rejected";
      rejectionReason = "Insufficient evidence that the page references the target";
    }

    const candidate: FilteredCandidate = {
      ...hit,
      content_match_score: contentMatchScore,
      candidate_decision: decision,
      rejection_reason: rejectionReason,
    };

    if (decision === "accepted") accepted.push(candidate);
    else if (decision === "triage") triage.push(candidate);
    else rejected.push(candidate);
  }

  return { accepted, triage, rejected };
}

export function shouldShowPrimaryFinding(
  finding: ClassifiedHit & {
    content_match_score?: number;
  },
): boolean {
  const score = finding.content_match_score ?? 0;

  return (
    score >= 50 &&
    finding.confidence >= 10 &&
    finding.content_category !== "unclassified"
  );
}
