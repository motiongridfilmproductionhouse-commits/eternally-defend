/**
 * YouTube Removal Intelligence — Controlled Pilot Operations & Authorization Layer.
 *
 * Manages pilot client enrollment records, multi-dimensional authorization gating,
 * feature flags, release versioning, and live outcome attribution.
 */

export type PilotStatus =
  | "INVITED"
  | "ONBOARDING"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "WITHDRAWN";

export type AuthorizationState =
  | "AUTHORIZED"
  | "PARTIALLY_AUTHORIZED"
  | "AUTHORIZATION_MISSING"
  | "AUTHORIZATION_EXPIRED";

export type PlatformOutcome =
  | "NOT_SUBMITTED"
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "MORE_INFO_REQUESTED"
  | "UNDER_REVIEW"
  | "REMOVED"
  | "PARTIALLY_ACTIONED"
  | "REJECTED"
  | "APPEALED"
  | "RESTORED"
  | "UNKNOWN";

export type RemovalAttributionDetailed =
  | "CONFIRMED_PLATFORM_REMOVAL"
  | "OBSERVED_UNAVAILABLE"
  | "CREATOR_DELETED"
  | "MADE_PRIVATE"
  | "REGION_RESTRICTED"
  | "UNKNOWN_UNAVAILABLE"
  | "REAPPEARED";

export interface AuthorizationGateRecord {
  identity_verified: boolean;
  target_ownership_verified: boolean;
  authorization_agreement_signed: boolean;
  rights_documentation_attached: boolean;
  scope_of_authorization: string[];
  platform_scope: string[];
  expiration_date: string;
  state: AuthorizationState;
}

export interface PilotEnrollment {
  pilot_id: string;
  client_id: string;
  client_name: string;
  target_id: string;
  target_name: string;
  account_type: "ENTERPRISE" | "HIGH_NET_WORTH" | "INDIVIDUAL";
  pilot_status: PilotStatus;
  started_at: string;
  ends_at: string;
  assigned_analyst: string;
  review_sla_hours: number;
  authorized_platforms: string[];
  authorized_action_types: string[];
  daily_scan_enabled: boolean;
  monitoring_enabled: boolean;
  human_approval_required: boolean;
  authorization_gate: AuthorizationGateRecord;
}

export interface FeatureFlags {
  YOUTUBE_REMOVAL_PILOT_ENABLED: boolean;
  YOUTUBE_COMPLAINT_SUBMISSION_ENABLED: boolean;
  YOUTUBE_CLIENT_APPROVAL_REQUIRED: boolean;
  YOUTUBE_MONITORING_ENABLED: boolean;
}

export interface ReleaseVersions {
  verifier_version: string;
  evidence_engine_version: string;
  classifier_version: string;
  complaint_engine_version: string;
  monitoring_engine_version: string;
}

export const DEFAULT_PILOT_FEATURE_FLAGS: FeatureFlags = {
  YOUTUBE_REMOVAL_PILOT_ENABLED: false, // Default false in unapproved envs
  YOUTUBE_COMPLAINT_SUBMISSION_ENABLED: false, // Default false to prevent auto submission
  YOUTUBE_CLIENT_APPROVAL_REQUIRED: true, // Default true
  YOUTUBE_MONITORING_ENABLED: true,
};

export const CURRENT_RELEASE_VERSIONS: ReleaseVersions = {
  verifier_version: "2.1.0",
  evidence_engine_version: "2.2.0",
  classifier_version: "2.3.0",
  complaint_engine_version: "1.5.0",
  monitoring_engine_version: "1.2.0",
};

/** Evaluate client authorization gate status. */
export function checkClientAuthorization(gate: Partial<AuthorizationGateRecord>): AuthorizationState {
  if (!gate) return "AUTHORIZATION_MISSING";

  if (gate.expiration_date && new Date(gate.expiration_date) < new Date()) {
    return "AUTHORIZATION_EXPIRED";
  }

  if (
    gate.identity_verified &&
    gate.target_ownership_verified &&
    gate.authorization_agreement_signed &&
    gate.rights_documentation_attached
  ) {
    return "AUTHORIZED";
  }

  if (gate.identity_verified || gate.authorization_agreement_signed) {
    return "PARTIALLY_AUTHORIZED";
  }

  return "AUTHORIZATION_MISSING";
}

/** Check if complaint submission workflow is allowed for client. */
export function isSubmissionAllowed(
  enrollment: PilotEnrollment,
  flags: FeatureFlags = DEFAULT_PILOT_FEATURE_FLAGS,
): { allowed: boolean; reason: string } {
  if (enrollment.pilot_status !== "ACTIVE") {
    return { allowed: false, reason: `Pilot status is ${enrollment.pilot_status}` };
  }

  const authState = checkClientAuthorization(enrollment.authorization_gate);
  if (authState !== "AUTHORIZED") {
    return { allowed: false, reason: `Client authorization state is ${authState}` };
  }

  if (!flags.YOUTUBE_REMOVAL_PILOT_ENABLED) {
    return { allowed: false, reason: "Feature flag YOUTUBE_REMOVAL_PILOT_ENABLED is disabled" };
  }

  return { allowed: true, reason: "Submission workflow authorized" };
}
