/**
 * Automated Protection Inbox — pure classification core.
 *
 * PRESENTATION / TRIAGE ONLY. This module decides how automatically
 * discovered YouTube items are grouped and ordered for the customer's
 * protection inbox. It does NOT:
 *  - create, modify or approve enforcement cases,
 *  - evaluate eligibility (see AutoEnforcementOrchestrator.evaluateEligibility),
 *  - verify routes (see evaluateVerification / effectiveRouteState),
 *  - influence pre-send gates, the enforcement worker, kill switch,
 *    allowlist, production approval or Resend transport.
 *
 * Discovery ≠ removal. A POSSIBLE_REMOVAL bucket only means "this is the
 * strongest evidence we have and a case exists / can be prepared"; whether
 * anything is ever sent is decided exclusively by the existing gates.
 */

export type InboxBucket = "POSSIBLE_REMOVAL" | "NEEDS_REVIEW" | "MONITORING";

export const INBOX_LABELS: Record<InboxBucket, string> = {
  POSSIBLE_REMOVAL: "POSSIBLE REMOVAL ACTION",
  NEEDS_REVIEW: "NEEDS REVIEW",
  MONITORING: "LEGITIMATE / MONITORING",
};

export interface InboxCaseSignals {
  status: string | null;
  eligibilityStatus: string | null;
  basis: string | null;
}

export interface InboxFindingInput {
  id: string;
  url: string;
  title: string | null;
  channelTitle: string | null;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  subjectStatus: string | null;
  subjectConfidence: number | null;
  channelClass: string | null;
  riskLevel: string | null;
  removalPotential: string | null;
  recommendedAction: string | null;
  potentialViolation: string | null;
  assessmentReason: string | null;
  evidenceVerified: boolean | null;
  transcriptState: string | null;
  priorityScore: number | null;
  enforcementCase?: InboxCaseSignals | null;
}

export interface InboxItem extends InboxFindingInput {
  bucket: InboxBucket;
  label: string;
  /** Human-readable justification for the classification. Never invented. */
  reasons: string[];
  /** What (if anything) the customer is being asked to do. */
  userAction: "NONE" | "REVIEW" | "AUTHORIZATION_REQUIRED";
  /** Case-derived status text, or null when no case exists yet. */
  caseStatusText: string | null;
}

const HIGH_RISK = new Set(["high", "critical"]);
const INCONCLUSIVE_SUBJECT = new Set(["", "unknown", "inconclusive", "error", "pending", "failed"]);
const FAILED_TRANSCRIPT = new Set(["error", "failed", "provider_error", "unavailable"]);

/** Case statuses that mean the automated pipeline has accepted the case. */
const CASE_IN_PIPELINE = new Set([
  "QUEUED",
  "PROCESSING",
  "PREPARED",
  "READY_TO_SEND",
  "SENT",
  "DELIVERED",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "RESOLVED",
]);

/** Case statuses that explicitly require a human before anything can move. */
const CASE_NEEDS_HUMAN: Record<string, string> = {
  UNDER_REVIEW: "Held for operator review by existing policy.",
  HUMAN_ACTION_REQUIRED: "No verified auto-sendable route — human action required.",
  PRODUCTION_APPROVAL_REQUIRED: "Production approval required before any send.",
  ROUTE_DISCOVERY_REQUIRED: "Removal route is discovered but not operator-verified.",
  QUEUE_FAILED: "Queueing failed — needs operator attention.",
};

function isInconclusive(f: InboxFindingInput): boolean {
  const subject = (f.subjectStatus ?? "").toLowerCase();
  const transcript = (f.transcriptState ?? "").toLowerCase();
  if (INCONCLUSIVE_SUBJECT.has(subject)) return true;
  if (FAILED_TRANSCRIPT.has(transcript)) return true;
  if (!f.riskLevel) return true;
  return false;
}

function isLegitimateAppearance(f: InboxFindingInput): boolean {
  const subject = (f.subjectStatus ?? "").toLowerCase();
  if (subject === "not_subject") return true;
  if ((f.channelClass ?? "") === "official_news") return true;
  return false;
}

/**
 * Existing enforcement threat categories. A finding only qualifies as
 * POSSIBLE_REMOVAL when the pipeline's own signals (potential violation,
 * recommended action, or the enforcement case basis) name one of these.
 * This is not a keyword filter over titles — titles are never inspected.
 */
export type ActionableCategory =
  | "IMPERSONATION"
  | "DEEPFAKE"
  | "IDENTITY_MISUSE"
  | "UNAUTHORIZED_CONTENT"
  | "PRIVACY_SENSITIVE"
  | "COPYRIGHT_INFRINGEMENT";

const CATEGORY_TOKENS: [ActionableCategory, RegExp][] = [
  ["IMPERSONATION", /(IMPERSONAT|FAKE_ACCOUNT|FAKE_PROFILE|CATFISH)/],
  ["DEEPFAKE", /(DEEPFAKE|SYNTHETIC|MANIPULAT|AI_GENERATED|FACE_SWAP)/],
  ["IDENTITY_MISUSE", /(IDENTITY_MISUSE|IDENTITY_THEFT|NAME_MISUSE|ENDORSEMENT_FRAUD|SCAM|FRAUD)/],
  [
    "UNAUTHORIZED_CONTENT",
    /(UNAUTHORIZED|UNLICENSED|PROTECTED_ASSET|ASSET_MISUSE|LEAKED_CONTENT|PIRAC|PIRATED)/,
  ],
  ["PRIVACY_SENSITIVE", /(PRIVACY|NCII|INTIMATE|SEXUAL|EXPLICIT|LEAK|DOXX)/],
  ["COPYRIGHT_INFRINGEMENT", /(COPYRIGHT_INFRINGEMENT|DMCA|COPYRIGHT_TAKEDOWN)/],
];

/** Signals that explicitly ask for a human decision rather than assert a violation. */
const REVIEW_ONLY = /(REVIEW|MONITOR|NO_ACTION|INSUFFICIENT|PENDING|UNKNOWN|POLICY_NOT_IDENTIFIED)/;

function normalizeSignal(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Reads the actionable enforcement category out of existing pipeline signals.
 * Returns null when the pipeline only produced a review/monitor recommendation,
 * an identity/face match, or a generic high risk score — a face match or the
 * mere presence of the subject is never actionable on its own.
 */
export function actionableCategoryOf(f: InboxFindingInput): ActionableCategory | null {
  const signals = [
    normalizeSignal(f.potentialViolation),
    normalizeSignal(f.recommendedAction),
    normalizeSignal(f.enforcementCase?.basis ?? null),
  ].filter(Boolean);

  for (const signal of signals) {
    if (REVIEW_ONLY.test(signal)) continue;
    for (const [category, pattern] of CATEGORY_TOKENS) {
      if (pattern.test(signal)) return category;
    }
  }
  return null;
}

/** True when the pipeline signals only ask for human review, not a removal. */
export function isReviewOnlySignal(f: InboxFindingInput): boolean {
  return [f.potentialViolation, f.recommendedAction]
    .map(normalizeSignal)
    .filter(Boolean)
    .some((s) => REVIEW_ONLY.test(s));
}

/**
 * Same actionability semantics already used by the automated dispatch
 * (selectActionableYoutubeFindings) — kept in sync deliberately so the inbox
 * never claims more than the pipeline itself considers actionable.
 */
export function isActionableFinding(f: InboxFindingInput): boolean {
  return (
    (f.subjectStatus ?? "") !== "not_subject" &&
    (f.channelClass ?? "") !== "official_news" &&
    HIGH_RISK.has((f.riskLevel ?? "").toLowerCase()) &&
    Boolean(f.recommendedAction)
  );
}

export function classifyInboxFinding(f: InboxFindingInput): InboxItem {
  const reasons: string[] = [];
  const c = f.enforcementCase ?? null;
  const caseStatus = (c?.status ?? "").toUpperCase();
  const caseStatusText = c?.status ?? null;

  // 1. Provider errors / inconclusive analysis are NEVER auto-marked safe.
  if (isInconclusive(f)) {
    reasons.push("Automated analysis was inconclusive or a provider step failed.");
    reasons.push("Inconclusive results are never automatically marked safe.");
    return {
      ...f,
      bucket: "NEEDS_REVIEW",
      label: INBOX_LABELS.NEEDS_REVIEW,
      reasons,
      userAction: "REVIEW",
      caseStatusText,
    };
  }

  // 2. Legitimate appearances are not treated as threats.
  if (isLegitimateAppearance(f)) {
    reasons.push(
      (f.subjectStatus ?? "").toLowerCase() === "not_subject"
        ? "Identity pipeline did not confirm you as the subject of this video."
        : "Published by an official news channel — treated as legitimate coverage.",
    );
    if (f.assessmentReason) reasons.push(f.assessmentReason);
    return {
      ...f,
      bucket: "MONITORING",
      label: INBOX_LABELS.MONITORING,
      reasons,
      userAction: "NONE",
      caseStatusText,
    };
  }

  const actionable = isActionableFinding(f);

  if (actionable) {
    reasons.push(`Automated risk assessment: ${String(f.riskLevel).toUpperCase()}.`);
    if (f.potentialViolation) reasons.push(`Potential violation: ${f.potentialViolation}.`);
    if (f.recommendedAction) reasons.push(`Recommended action: ${f.recommendedAction}.`);

    const humanReason = CASE_NEEDS_HUMAN[caseStatus];
    if (humanReason) {
      reasons.push(humanReason);
      return {
        ...f,
        bucket: "NEEDS_REVIEW",
        label: INBOX_LABELS.NEEDS_REVIEW,
        reasons,
        userAction:
          caseStatus === "PRODUCTION_APPROVAL_REQUIRED" || caseStatus === "UNDER_REVIEW"
            ? "AUTHORIZATION_REQUIRED"
            : "REVIEW",
        caseStatusText,
      };
    }

    if (caseStatus === "NOT_ELIGIBLE" || caseStatus === "CANCELLED_BY_POLICY") {
      reasons.push("Existing eligibility policy does not permit automated enforcement.");
      return {
        ...f,
        bucket: "NEEDS_REVIEW",
        label: INBOX_LABELS.NEEDS_REVIEW,
        reasons,
        userAction: "REVIEW",
        caseStatusText,
      };
    }

    // Removal requires a named actionable enforcement category from the
    // existing pipeline. Identity/face matches, high risk scores and the
    // subject merely appearing in a video are NOT actionable on their own.
    const category = actionableCategoryOf(f);
    if (!category) {
      reasons.push(
        "No actionable enforcement category (impersonation, deepfake, identity misuse, unauthorized content, privacy-sensitive material or eligible copyright infringement) was identified by the analysis pipeline.",
      );
      reasons.push(
        "An identity/face match or the subject appearing in a video is never treated as removable on its own.",
      );
      if (isReviewOnlySignal(f) || CASE_IN_PIPELINE.has(caseStatus)) {
        reasons.push("The pipeline asked for a human decision — held for review.");
        return {
          ...f,
          bucket: "NEEDS_REVIEW",
          label: INBOX_LABELS.NEEDS_REVIEW,
          reasons,
          userAction: "REVIEW",
          caseStatusText,
        };
      }
      reasons.push("Treated as an ordinary appearance — monitored, not a threat.");
      return {
        ...f,
        bucket: "MONITORING",
        label: INBOX_LABELS.MONITORING,
        reasons,
        userAction: "NONE",
        caseStatusText,
      };
    }

    reasons.push(`Actionable category identified by the pipeline: ${category}.`);

    const inPipeline = CASE_IN_PIPELINE.has(caseStatus);
    const strongEvidence =
      f.evidenceVerified === true || (f.removalPotential ?? "").toLowerCase() === "high";

    if (inPipeline || strongEvidence) {
      if (inPipeline) {
        reasons.push(
          `An enforcement case already exists (${caseStatus}); it advances only if every existing gate passes.`,
        );
      } else {
        reasons.push("Evidence package is complete — eligible for automated case preparation.");
      }
      reasons.push(
        "Sending still requires the existing authorization, route-verification and pre-send gates.",
      );
      return {
        ...f,
        bucket: "POSSIBLE_REMOVAL",
        label: INBOX_LABELS.POSSIBLE_REMOVAL,
        reasons,
        userAction: "NONE",
        caseStatusText,
      };
    }

    reasons.push("Evidence package is not yet complete — review before any action.");
    return {
      ...f,
      bucket: "NEEDS_REVIEW",
      label: INBOX_LABELS.NEEDS_REVIEW,
      reasons,
      userAction: "REVIEW",
      caseStatusText,
    };
  }

  // 3. Analysed, subject confirmed, but not actionable → monitoring.
  reasons.push(
    `Analysed as ${String(f.riskLevel ?? "low").toUpperCase()} risk with no removal-eligible violation.`,
  );
  if (f.assessmentReason) reasons.push(f.assessmentReason);
  return {
    ...f,
    bucket: "MONITORING",
    label: INBOX_LABELS.MONITORING,
    reasons,
    userAction: "NONE",
    caseStatusText,
  };
}

const BUCKET_ORDER: Record<InboxBucket, number> = {
  POSSIBLE_REMOVAL: 0,
  NEEDS_REVIEW: 1,
  MONITORING: 2,
};

export interface InboxSummary {
  analyzed: number;
  possibleRemoval: number;
  needsReview: number;
  monitoring: number;
}

export function buildProtectionInbox(findings: InboxFindingInput[]): {
  items: InboxItem[];
  summary: InboxSummary;
} {
  const items = findings.map(classifyInboxFinding).sort((a, b) => {
    const bucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (bucket !== 0) return bucket;
    const score = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
    if (score !== 0) return score;
    return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
  });

  return {
    items,
    summary: {
      analyzed: items.length,
      possibleRemoval: items.filter((i) => i.bucket === "POSSIBLE_REMOVAL").length,
      needsReview: items.filter((i) => i.bucket === "NEEDS_REVIEW").length,
      monitoring: items.filter((i) => i.bucket === "MONITORING").length,
    },
  };
}
