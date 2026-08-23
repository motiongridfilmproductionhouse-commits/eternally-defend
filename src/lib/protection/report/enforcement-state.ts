/**
 * Pure mapping from existing enforcement rows (cases + jobs) to the report's
 * enforcement view. This layer never decides eligibility and never sends
 * anything: it only describes what the enforcement pipeline already recorded.
 */
import type { DiscoveryEnforcement, EnforcementState } from "./types";

export interface EnforcementCaseSnapshot {
  caseId: string;
  targetUrl: string;
  caseStatus: string | null;
  eligibilityStatus: string | null;
  basis: string | null;
  route: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  jobStatus: string | null;
}

export const ENFORCEMENT_STATE_LABEL: Record<EnforcementState, string> = {
  NOT_APPLICABLE: "No enforcement",
  BLOCKED: "Blocked",
  QUEUED: "Queued",
  UNDER_REVIEW: "Awaiting review",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

function mapCaseStatus(status: string | null, jobStatus: string | null): EnforcementState {
  const s = String(status ?? "").toUpperCase();
  if (s === "UNDER_REVIEW") return "UNDER_REVIEW";
  if (s === "NOT_ELIGIBLE") return "BLOCKED";
  if (s === "SUBMITTED" || s === "ACKNOWLEDGED") return "SUBMITTED";
  if (s === "REMOVED" || s === "COMPLETED" || s === "CLOSED") return "COMPLETED";
  if (s === "FAILED" || s === "REJECTED") return "FAILED";
  if (s === "PROCESSING" || s === "SENDING") return "IN_PROGRESS";
  if (s === "QUEUED") {
    const j = String(jobStatus ?? "").toLowerCase();
    if (j === "processing") return "IN_PROGRESS";
    if (j === "failed") return "FAILED";
    if (j === "completed" || j === "done") return "SUBMITTED";
    return "QUEUED";
  }
  return jobStatus ? "QUEUED" : "NOT_APPLICABLE";
}

const DETAIL: Record<EnforcementState, string> = {
  NOT_APPLICABLE: "No automatic enforcement was started for this discovery.",
  BLOCKED: "Automatic enforcement was refused — the eligibility engine did not clear this target.",
  QUEUED: "Removal request prepared and queued for the enforcement worker.",
  UNDER_REVIEW: "Routed to the human review queue before anything can be prepared or sent.",
  IN_PROGRESS: "The enforcement worker is preparing this removal request.",
  SUBMITTED: "Removal request submitted through the verified route for this domain.",
  COMPLETED: "Enforcement finished for this target.",
  FAILED: "Enforcement attempt failed — see the enforcement centre for the error.",
};

export function buildDiscoveryEnforcement(
  snapshot: EnforcementCaseSnapshot | undefined,
  opts: { testMode: boolean; blockedDetail?: string },
): DiscoveryEnforcement {
  if (!snapshot) {
    return {
      state: "NOT_APPLICABLE",
      detail: opts.blockedDetail ?? DETAIL.NOT_APPLICABLE,
      caseId: null,
      caseStatus: null,
      basis: null,
      route: null,
      jobStatus: null,
      queuedAt: null,
      updatedAt: null,
      testMode: opts.testMode,
    };
  }
  const state = mapCaseStatus(snapshot.caseStatus, snapshot.jobStatus);
  return {
    state,
    detail: DETAIL[state],
    caseId: snapshot.caseId,
    caseStatus: snapshot.caseStatus,
    basis: snapshot.basis,
    route: snapshot.route,
    jobStatus: snapshot.jobStatus,
    queuedAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    testMode: opts.testMode,
  };
}
