/**
 * Customer-facing protection status vocabulary for MODE B social assets.
 *
 * Pure mapping only — it never activates anything and never claims a platform
 * connection. `PUBLIC_REFERENCE` accounts are always described as a public
 * reference, never as "Verified Instagram" or "Connected".
 */

export const SOCIAL_STATUSES = [
  "public_reference",
  "processing",
  "fingerprint_ready",
  "protection_active",
  "waiting_for_authorization",
  "upload_required",
  "failed",
] as const;

export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

export const SOCIAL_STATUS_LABEL: Record<SocialStatus, string> = {
  public_reference: "Public reference",
  processing: "Processing",
  fingerprint_ready: "Fingerprint ready",
  protection_active: "Protection active",
  waiting_for_authorization: "Protection waiting for authorization",
  upload_required: "Upload required",
  failed: "Failed",
};

/** Friendly, non-alarming copy for a platform that blocks anonymous retrieval. */
export const BLOCKED_RETRIEVAL_MESSAGE =
  "We couldn't securely retrieve this media from Instagram. Upload the original photo or video to protect it.";

export function blockedRetrievalMessage(platform?: string | null): string {
  if (!platform || platform === "instagram") return BLOCKED_RETRIEVAL_MESSAGE;
  const name = platform.charAt(0).toUpperCase() + platform.slice(1);
  return `We couldn't securely retrieve this media from ${name}. Upload the original photo or video to protect it.`;
}

export interface AssetStatusInput {
  fingerprinted: boolean;
  hasTarget: boolean;
  /** Protection profile status, e.g. ACTIVE / PENDING_AUTHORIZATION / null. */
  profileStatus: string | null;
  profilePaused?: boolean | null;
  autoScanEnabled?: boolean | null;
}

export interface AssetStatusView {
  status: SocialStatus;
  label: string;
  /** Exact, non-silent explanation when scanning has not activated. */
  reason: string | null;
}

/**
 * Derive the status of a stored social asset. Protection is only reported as
 * active when a recurring target actually exists — we never imply activation
 * around an authorization requirement.
 */
export function deriveAssetStatus(input: AssetStatusInput): AssetStatusView {
  const view = (status: SocialStatus, reason: string | null = null): AssetStatusView => ({
    status,
    label: SOCIAL_STATUS_LABEL[status],
    reason,
  });

  if (!input.fingerprinted) return view("processing", "Fingerprinting has not completed yet.");
  if (input.hasTarget) return view("protection_active");

  if (!input.profileStatus)
    return view(
      "waiting_for_authorization",
      "Protection scanning has not activated: no protection profile exists yet. Complete onboarding to activate scanning.",
    );
  if (input.profileStatus !== "ACTIVE")
    return view(
      "waiting_for_authorization",
      `Protection scanning has not activated: rights-holder authorization is ${input.profileStatus.replace(/_/g, " ").toLowerCase()}.`,
    );
  if (input.profilePaused || input.autoScanEnabled === false)
    return view(
      "waiting_for_authorization",
      "Protection scanning has not activated: automatic scanning is paused for this account.",
    );

  return view("fingerprint_ready", "Media is fingerprinted and queued for enrollment.");
}
