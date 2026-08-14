/**
 * Copyright finding → case handoff (pure mapping).
 *
 * Copyright findings live in `copyright_matches`, not `scan_hits`, so they must
 * NOT be forced through the reputation detection path (which keys case evidence
 * on `scan_hit_id`). This module derives the case shape and the evidence
 * snapshot that gets frozen onto `case_findings.evidence` at handoff time.
 *
 * Deliberate safeguards preserved here:
 *  - visual similarity alone is never treated as proven infringement;
 *  - a DMCA contact discovered by crawling is recorded as UNVERIFIED and is
 *    never promoted to VERIFIED;
 *  - the derived state is an *eligibility input*, never an enforcement
 *    authorisation. Nothing in this module submits or sends anything.
 */

export type CopyrightMatchLike = {
  id: string;
  scan_id: string;
  source_url: string;
  page_title: string | null;
  platform: string | null;
  detection_type: string | null;
  confidence: number | null;
  confidence_band: string | null;
  review_status: string | null;
  reason: string | null;
  transformations?: unknown;
  ocr_text?: string | null;
  evidence?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type CopyrightCasePriority = "Critical" | "High" | "Medium" | "Low";

/**
 * Reviewer-facing eligibility state. There is no "ELIGIBLE" value on purpose —
 * eligibility is decided downstream by the existing enforcement pipeline.
 */
export type CopyrightEligibilityState =
  | "AWAITING_HUMAN_REVIEW"
  | "EVIDENCE_INCOMPLETE"
  | "READY_FOR_ELIGIBILITY_CHECK"
  | "DISMISSED";

export function domainOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function copyrightCasePriority(match: CopyrightMatchLike): CopyrightCasePriority {
  const band = (match.confidence_band ?? "").toLowerCase();
  const confidence = match.confidence ?? 0;
  if (band === "confirmed" || confidence >= 90) return "Critical";
  if (band === "probable" || confidence >= 70) return "High";
  if (confidence >= 50) return "Medium";
  return "Low";
}

export function copyrightCaseSubject(match: CopyrightMatchLike, workTitle?: string | null): string {
  const domain = domainOfUrl(match.source_url);
  const work = (workTitle ?? "").trim();
  const label = (match.page_title ?? "").trim();
  const head = work || label || "Protected work";
  const base = domain ? `${head} · ${domain}` : head;
  return base.length > 140 ? `${base.slice(0, 137)}…` : base;
}

/**
 * Contact state. A contact harvested from a page or a static directory is
 * recorded as UNVERIFIED — verification happens in the enforcement route
 * resolver, never at promotion time.
 */
export function contactState(match: CopyrightMatchLike): {
  abuseEmail: string | null;
  reportUrl: string | null;
  verification: "UNVERIFIED" | "NONE";
  source: string | null;
} {
  const contact = (match.contact ?? {}) as Record<string, unknown>;
  const abuseEmail = typeof contact.abuseEmail === "string" ? contact.abuseEmail : null;
  const reportUrl = typeof contact.reportUrl === "string" ? contact.reportUrl : null;
  const source = typeof contact.source === "string" ? contact.source : null;
  return {
    abuseEmail,
    reportUrl,
    verification: abuseEmail || reportUrl ? "UNVERIFIED" : "NONE",
    source,
  };
}

/** Does this finding carry enough corroboration to be worth reviewing at all? */
export function hasCorroboratingEvidence(match: CopyrightMatchLike): boolean {
  const ev = (match.evidence ?? {}) as Record<string, unknown>;
  const signals = [
    ev.phash_distance,
    ev.dhash_distance,
    ev.rekognition_similarity,
    ev.frame_matches,
    ev.distribution,
    ev.screenshot_path,
    ev.snapshot_path,
    match.ocr_text,
  ];
  return signals.some((s) => s !== undefined && s !== null && s !== "");
}

export function eligibilityState(match: CopyrightMatchLike): CopyrightEligibilityState {
  const review = (match.review_status ?? "pending").toLowerCase();
  if (review === "dismissed") return "DISMISSED";
  if (!hasCorroboratingEvidence(match)) return "EVIDENCE_INCOMPLETE";
  // Human review is required before anything can be enforced: high visual
  // similarity on its own does not establish infringement.
  if (review === "evidence_ready" || review === "reviewed_potential_violation") {
    return "READY_FOR_ELIGIBILITY_CHECK";
  }
  return "AWAITING_HUMAN_REVIEW";
}

/** A finding may only open a case once it is not dismissed. */
export function isPromotable(match: CopyrightMatchLike): boolean {
  return eligibilityState(match) !== "DISMISSED";
}

/**
 * Frozen evidence snapshot stored on the case_findings row. Everything the
 * enforcement pipeline needs to re-derive the finding is captured here so the
 * case stays traceable even if the scan is later archived.
 */
export function buildCaseEvidenceSnapshot(
  match: CopyrightMatchLike,
  opts: { workId?: string | null; workTitle?: string | null } = {},
): Record<string, unknown> {
  const contact = contactState(match);
  return {
    origin: "copyright_match_promotion",
    copyright_match_id: match.id,
    copyright_scan_id: match.scan_id,
    protected_work_id: opts.workId ?? match.scan_id,
    protected_work_title: opts.workTitle ?? null,
    target_url: match.source_url,
    domain: domainOfUrl(match.source_url),
    platform: match.platform ?? null,
    detection_type: match.detection_type ?? null,
    similarity: {
      confidence: match.confidence ?? null,
      confidence_band: match.confidence_band ?? null,
      reason: match.reason ?? null,
      transformations: Array.isArray(match.transformations) ? match.transformations : [],
    },
    evidence_references: match.evidence ?? {},
    ocr_text: match.ocr_text ?? null,
    contact: {
      ...contact,
      // Explicit: never present a discovered recipient as verified.
      note: "Recipient not verified at promotion time; enforcement route resolution required.",
    },
    review_status_at_promotion: match.review_status ?? "pending",
    eligibility_state: eligibilityState(match),
    similarity_is_not_infringement: true,
    promoted_at: new Date().toISOString(),
  };
}

export function caseNoteFor(match: CopyrightMatchLike): string {
  return [
    `Copyright finding ${match.id}`,
    `${match.confidence_band ?? "review"} · ${Math.round(match.confidence ?? 0)}% similarity`,
    eligibilityState(match),
  ].join(" · ");
}
