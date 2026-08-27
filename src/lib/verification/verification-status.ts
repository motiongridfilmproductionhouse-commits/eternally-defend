/**
 * Single source of truth for the *display* verification status of an account.
 *
 * This intentionally derives from fields that already exist (KYC status, face
 * profile status, authorization status / badge) instead of introducing a new
 * verification concept. Account-type selection is self-declared and can never
 * produce VERIFIED.
 */

export type VerificationStatus = "UNVERIFIED" | "VERIFICATION_PENDING" | "VERIFIED";

export const VERIFICATION_OPTIONAL_MESSAGE =
  "Verification is optional during setup. You can verify your identity later to unlock sensitive protection and enforcement actions.";

export const VERIFICATION_REQUIRED_MESSAGE =
  "Verify your identity to continue with this protection action.";

export const VERIFY_PROFILE_CARD = {
  title: "Verify your profile",
  description: "Unlock advanced protection and enforcement capabilities.",
  primaryCta: "Verify now",
  secondaryCta: "Verify later",
} as const;

/** High-trust actions that always require a verified account. */
export const SENSITIVE_ACTIONS = [
  "platform_takedown",
  "legal_enforcement_request",
  "impersonation_ownership_claim",
  "removal_on_behalf",
  "sensitive_identity_data",
  "transfer_protected_identity",
  "authorize_representative",
] as const;

export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];

/** Human-readable copy for each sensitive action. */
export const SENSITIVE_ACTION_LABELS: Record<SensitiveAction, string> = {
  platform_takedown: "Platform takedown requests",
  legal_enforcement_request: "Legal enforcement requests",
  impersonation_ownership_claim: "Impersonation ownership claims",
  removal_on_behalf: "Removals on behalf of someone",
  sensitive_identity_data: "Sensitive identity data access",
  transfer_protected_identity: "Transferring a protected profile",
  authorize_representative: "Authorizing a representative",
};

export function isSensitiveAction(value: unknown): value is SensitiveAction {
  return typeof value === "string" && (SENSITIVE_ACTIONS as readonly string[]).includes(value);
}

export type VerificationSignals = {
  kycStatus?: string | null;
  faceStatus?: string | null;
  verificationBadge?: string | null;
  authorizationStatus?: string | null;
  /** Canonical client_authorizations.status of the latest signed authorization. */
  signedAuthorizationStatus?: string | null;
};

/**
 * Derives UNVERIFIED / VERIFICATION_PENDING / VERIFIED from existing records.
 * Never infers verification from the self-declared account type.
 */
export function deriveVerificationStatus(signals: VerificationSignals): VerificationStatus {
  const kyc = (signals.kycStatus ?? "").toUpperCase();
  const face = (signals.faceStatus ?? "").toUpperCase();
  const authorization = (signals.authorizationStatus ?? "").toLowerCase();

  if (
    kyc === "APPROVED" ||
    face === "FACE_VERIFIED" ||
    authorization === "authorized" ||
    authorization === "enterprise_authorized" ||
    Boolean(signals.verificationBadge)
  ) {
    return "VERIFIED";
  }

  const pendingKyc = ["SESSION_CREATED", "IN_PROGRESS", "SUBMITTED", "MANUAL_REVIEW"];
  const pendingFace = ["CAPTURE_IN_PROGRESS", "LIVENESS_PROCESSING", "MANUAL_REVIEW"];
  if (pendingKyc.includes(kyc) || pendingFace.includes(face)) {
    return "VERIFICATION_PENDING";
  }

  return "UNVERIFIED";
}

/** Sensitive actions require a fully verified account — pending is not enough. */
export function canPerformSensitiveAction(status: VerificationStatus): boolean {
  return status === "VERIFIED";
}

/** UNVERIFIED is a normal state: monitoring and analytics stay fully available. */
export function canUseMonitoring(_status: VerificationStatus): boolean {
  return true;
}
