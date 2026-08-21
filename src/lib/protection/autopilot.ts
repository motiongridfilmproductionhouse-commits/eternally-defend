/**
 * Protection Autopilot — pure, testable core.
 *
 * Post-enrollment continuous protection: once a celebrity account finishes
 * onboarding with an ACTIVE rights-holder authorization, every approved
 * identity/asset is enrolled into recurring scanning. This module holds only
 * deterministic helpers (cadence, dedupe keys, gate summaries) so they can be
 * unit-tested without the database.
 *
 * Hard product rule encoded here: candidate similarity alone is NEVER
 * infringement. A finding that is not identity/ownership/route verified stays
 * in review and is reported with its exact blocking reason.
 */
import { createHash } from "node:crypto";

export const DEFAULT_CADENCE_MINUTES: Record<ProtectionTargetKind, number> = {
  identity: 720, // twice a day — synthetic media spreads fast
  asset: 1440, // daily
};

export type ProtectionTargetKind = "identity" | "asset";

export type ProtectionProfileStatus = "PENDING" | "PENDING_AUTHORIZATION" | "ACTIVE" | "PAUSED";

/** Recurring cadence with linear backoff after consecutive failures. */
export function computeNextRunAt(
  now: Date,
  cadenceMinutes: number,
  consecutiveFailures = 0,
): string {
  const base = Math.max(15, Math.floor(cadenceMinutes));
  const backoff = Math.min(consecutiveFailures, 5) * base;
  return new Date(now.getTime() + (base + backoff) * 60_000).toISOString();
}

/** Canonical URL form used for cross-run deduplication. */
export function canonicalizeUrlForDedupe(rawUrl: string): string {
  const trimmed = (rawUrl ?? "").trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|igshid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.protocol = "https:";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Stable dedupe key: same URL + same protected subject/asset never produces a
 * second case, no matter how many scheduled sweeps rediscover it.
 */
export function buildDedupeKey(input: {
  userId: string;
  url: string;
  targetKind: ProtectionTargetKind;
  targetRef?: string | null;
}): string {
  const raw = [
    input.userId,
    input.targetKind,
    input.targetRef ?? "subject",
    canonicalizeUrlForDedupe(input.url),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

export type FindingVerificationSignals = {
  /** Identity/face verified against enrolled references. */
  identityVerified: boolean;
  /** Synthetic-media or copy evidence confirmed by the classifier/hash gates. */
  mediaEvidenceConfirmed: boolean;
  /** Rights ownership of the protected work/identity verified. */
  ownershipVerified: boolean;
  /** Exact actionable target URL present. */
  actionableUrl: boolean;
  /** Confidence 0..100 of the match. */
  confidence: number;
};

export const MIN_AUTO_CONFIDENCE = 90;

/**
 * Decide whether a discovered candidate may even be handed to the enforcement
 * orchestrator as a verified finding. Anything uncertain → REVIEW.
 */
export function classifyFindingForEnforcement(signals: FindingVerificationSignals): {
  decision: "VERIFIED" | "REVIEW";
  blockingReason: string | null;
} {
  if (!signals.actionableUrl) {
    return { decision: "REVIEW", blockingReason: "No exact actionable target URL on the finding." };
  }
  if (!signals.identityVerified) {
    return {
      decision: "REVIEW",
      blockingReason: "Identity match not verified against enrolled references.",
    };
  }
  if (!signals.mediaEvidenceConfirmed) {
    return {
      decision: "REVIEW",
      blockingReason:
        "Visual similarity only — no confirmed synthetic-media/copy evidence. Similarity alone is not infringement.",
    };
  }
  if (!signals.ownershipVerified) {
    return { decision: "REVIEW", blockingReason: "Rights ownership of the protected work is unverified." };
  }
  if (!Number.isFinite(signals.confidence) || signals.confidence < MIN_AUTO_CONFIDENCE) {
    return {
      decision: "REVIEW",
      blockingReason: `Confidence ${Math.round(signals.confidence || 0)}% is below the ${MIN_AUTO_CONFIDENCE}% verified-policy threshold.`,
    };
  }
  return { decision: "VERIFIED", blockingReason: null };
}

/** Environment kill switches, read at call time. */
export function enforcementSwitches(env: Record<string, string | undefined> = process.env) {
  return {
    liveEnabled: env.ENFORCEMENT_LIVE_ENABLED === "true",
    testMode: env.ENFORCEMENT_TEST_MODE === "true",
    emergencyPause: env.ENFORCEMENT_EMERGENCY_PAUSE === "true",
  };
}

/**
 * Translate the orchestrator's case outcome + kill switches into the exact
 * blocking reason surfaced on the case. Never returns "sent".
 */
export function describeEnforcementOutcome(input: {
  caseStatus: string | null;
  eligibility?: string | null;
  routeName?: string | null;
  switches?: ReturnType<typeof enforcementSwitches>;
}): { externalSendAllowed: boolean; blockingReason: string | null } {
  const sw = input.switches ?? enforcementSwitches();
  if (sw.emergencyPause) {
    return { externalSendAllowed: false, blockingReason: "Emergency pause is ON." };
  }
  if (!sw.liveEnabled) {
    return {
      externalSendAllowed: false,
      blockingReason: "Live enforcement kill switch is OFF (ENFORCEMENT_LIVE_ENABLED=false).",
    };
  }
  if (sw.testMode) {
    return {
      externalSendAllowed: false,
      blockingReason: "Enforcement test mode is ON — dispatches are redirected, not sent.",
    };
  }
  if (input.caseStatus === "UNDER_REVIEW") {
    return { externalSendAllowed: false, blockingReason: "Case is held for operator review." };
  }
  if (input.caseStatus === "NOT_ELIGIBLE") {
    return {
      externalSendAllowed: false,
      blockingReason: "Case is not eligible for automated enforcement.",
    };
  }
  if (!input.routeName || /manual|human/i.test(input.routeName)) {
    return { externalSendAllowed: false, blockingReason: "HUMAN_ACTION_REQUIRED — no verified auto-sendable route." };
  }
  return { externalSendAllowed: true, blockingReason: null };
}

/* ------------------------------------------------------------------ */
/* Customer-facing stage timeline (pure — derived from real audit data) */
/* ------------------------------------------------------------------ */
export type ProtectionStageKey =
  | "onboarding_complete"
  | "protection_activated"
  | "initial_scan_queued"
  | "discovery"
  | "verification"
  | "evidence"
  | "enforcement"
  | "continuous";

export type ProtectionStageState = "pending" | "in_progress" | "done" | "blocked";

export interface ProtectionStage {
  key: ProtectionStageKey;
  label: string;
  state: ProtectionStageState;
  at: string | null;
  detail: string | null;
}

export interface ProtectionStageInput {
  onboardingCompletedAt?: string | null;
  protectionActivatedAt?: string | null;
  continuousMonitoringEnabledAt?: string | null;
  initialScanQueuedAt?: string | null;
  initialScanStartedAt?: string | null;
  initialScanCompletedAt?: string | null;
  evidenceCapturedAt?: string | null;
  enforcementCaseCreatedAt?: string | null;
  /** Real counters from the latest completed run — never fabricated. */
  discovered?: number | null;
  verified?: number | null;
  heldForReview?: number | null;
  casesCreated?: number | null;
  /** Exact blocking reason from the enforcement gates, if any. */
  blockingReason?: string | null;
}

/**
 * Turn recorded timestamps + real run counters into the customer-facing
 * progression. Never produces percentages or invented findings: a stage is
 * only `done` when the corresponding timestamp exists.
 */
export function deriveProtectionStages(input: ProtectionStageInput): ProtectionStage[] {
  const scanRunning = Boolean(input.initialScanStartedAt) && !input.initialScanCompletedAt;
  const n = (v: number | null | undefined) => (typeof v === "number" ? v : 0);

  const stage = (
    key: ProtectionStageKey,
    label: string,
    at: string | null | undefined,
    opts: { state?: ProtectionStageState; detail?: string | null } = {},
  ): ProtectionStage => ({
    key,
    label,
    at: at ?? null,
    state: opts.state ?? (at ? "done" : "pending"),
    detail: opts.detail ?? null,
  });

  const discoveredCount = n(input.discovered);
  const verifiedCount = n(input.verified);
  const reviewCount = n(input.heldForReview);

  return [
    stage("onboarding_complete", "Onboarding complete", input.onboardingCompletedAt),
    stage("protection_activated", "Protection activated", input.protectionActivatedAt),
    stage("initial_scan_queued", "Initial scan queued", input.initialScanQueuedAt),
    stage("discovery", "Scanning sources", input.initialScanStartedAt, {
      state: scanRunning ? "in_progress" : input.initialScanCompletedAt ? "done" : "pending",
      detail: input.initialScanCompletedAt
        ? `${discoveredCount} candidate${discoveredCount === 1 ? "" : "s"} discovered`
        : scanRunning
          ? "Scan running"
          : null,
    }),
    stage("verification", "Verifying identity", input.initialScanCompletedAt, {
      state: input.initialScanCompletedAt ? "done" : scanRunning ? "in_progress" : "pending",
      detail: input.initialScanCompletedAt
        ? verifiedCount === 0 && reviewCount === 0
          ? "No candidates required verification"
          : `${verifiedCount} verified · ${reviewCount} awaiting review`
        : scanRunning
          ? "Verification queued"
          : null,
    }),
    stage("evidence", "Capturing evidence", input.evidenceCapturedAt, {
      state: input.evidenceCapturedAt
        ? "done"
        : input.initialScanCompletedAt
          ? "pending"
          : "pending",
      detail: input.evidenceCapturedAt ? "Evidence preserved before any enforcement" : null,
    }),
    stage("enforcement", "Preparing enforcement", input.enforcementCaseCreatedAt, {
      state: input.blockingReason
        ? "blocked"
        : input.enforcementCaseCreatedAt
          ? "done"
          : "pending",
      detail: input.blockingReason ?? (n(input.casesCreated) ? `${n(input.casesCreated)} case(s) prepared` : null),
    }),
    stage("continuous", "Continuous protection active", input.continuousMonitoringEnabledAt),
  ];
}
