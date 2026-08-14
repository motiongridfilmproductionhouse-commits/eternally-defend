/**
 * Presentation-only mapping for discovery candidates.
 *
 * Discovery produces *candidates* and, at best, *verified visual matches*.
 * Nothing here may call an unreviewed match "copyright infringement" — that
 * wording is reserved for reviewed cases handled by the enforcement path.
 */

export type CandidateStateId = "candidate" | "verifying" | "verified_match" | "no_match" | "fetch_failed";

export interface CandidateStateView {
  id: CandidateStateId;
  label: string;
  /** Tailwind classes for the badge — semantic tokens only. */
  className: string;
  hint: string;
}

const STATES: Record<CandidateStateId, CandidateStateView> = {
  candidate: {
    id: "candidate",
    label: "Candidate",
    className: "border-border text-muted-foreground",
    hint: "Discovered lead — not yet retrieved or compared.",
  },
  verifying: {
    id: "verifying",
    label: "Verifying",
    className: "border-primary/50 text-primary",
    hint: "Media is being retrieved and perceptually compared.",
  },
  verified_match: {
    id: "verified_match",
    label: "Verified visual match",
    className: "border-amber-500/50 text-amber-500",
    hint: "Visual match confirmed by perceptual comparison. Pending human review — not a legal determination.",
  },
  no_match: {
    id: "no_match",
    label: "No match",
    className: "border-emerald-500/40 text-emerald-500",
    hint: "Compared against the protected asset and rejected.",
  },
  fetch_failed: {
    id: "fetch_failed",
    label: "Fetch failed",
    className: "border-destructive/50 text-destructive",
    hint: "Media could not be retrieved, so no comparison was possible.",
  },
};

export function candidateState(input: {
  verification_status: string | null;
  crawl_status?: string | null;
}): CandidateStateView {
  const verification = (input.verification_status ?? "").toUpperCase();
  if (verification === "FETCH_FAILED") return STATES.fetch_failed;
  if (verification === "VERIFIED_MATCH") return STATES.verified_match;
  if (verification === "REJECTED") return STATES.no_match;
  const crawl = (input.crawl_status ?? "").toLowerCase();
  if (crawl === "pending" || crawl === "fetching" || crawl === "queued") return STATES.verifying;
  if (crawl === "failed") return STATES.fetch_failed;
  return STATES.candidate;
}

export function similarityLabel(similarity: number | null, distance: number | null): string | null {
  if (similarity == null && distance == null) return null;
  const parts: string[] = [];
  if (similarity != null) parts.push(`${Math.round(Number(similarity) * (Number(similarity) <= 1 ? 100 : 1))}% similar`);
  if (distance != null) parts.push(`hamming ${distance}`);
  return parts.join(" · ");
}

export const JOB_STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  seeding: "Discovering",
  fetching: "Fetching media",
  comparing: "Comparing",
  verifying: "Verifying",
  completed: "Completed",
  failed: "Failed",
};
