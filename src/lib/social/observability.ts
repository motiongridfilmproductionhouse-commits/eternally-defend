/**
 * MODE B operational observability.
 *
 * Emits one structured line per funnel step so operators can see where a
 * customer's social protection attempt ended, and can tell a PLATFORM_LIMIT
 * (Instagram 429 / login wall) apart from an ETERNA_FAILURE.
 *
 * Deliberately never logged: original media bytes, presigned URLs, storage
 * object keys, auth tokens, emails, or any identity document data. Only the
 * coarse funnel outcome plus non-reversible identifiers (uuid ids) are emitted.
 */

export const MODE_B_EVENTS = [
  "profile_registration",
  "public_reference_created",
  "link_import",
  "public_retrieval_blocked",
  "upload_required",
  "manual_upload_prepared",
  "upload_ingestion",
  "fingerprint",
  "dedupe_hit",
  "autopilot_enrollment",
  "authorization_gate",
] as const;

export type ModeBEvent = (typeof MODE_B_EVENTS)[number];

/**
 * `platform_limit` marks an external platform refusing anonymous access — an
 * expected limitation, not an Eterna defect.
 */
export type ModeBOutcome = "success" | "failure" | "platform_limit" | "info";

export interface ModeBLogFields {
  event: ModeBEvent;
  outcome: ModeBOutcome;
  platform?: string | null;
  /** Machine-readable reason such as `profile_not_active`, `already_protected`. */
  reason?: string | null;
  userId?: string | null;
  assetId?: string | null;
  socialAccountId?: string | null;
  importMethod?: "PUBLIC_LINK" | "MANUAL_UPLOAD" | "AUTHORIZED_API" | null;
  fingerprinted?: boolean | null;
  frames?: number | null;
}

const SENSITIVE = /url|token|key|secret|email|bytes|media/i;

export function modeBLog(fields: ModeBLogFields): void {
  const payload: Record<string, unknown> = {
    scope: "mode_b_social_protection",
    at: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (SENSITIVE.test(key)) continue;
    payload[key] = value;
  }
  const line = `[ModeB] ${JSON.stringify(payload)}`;
  if (fields.outcome === "failure") console.error(line);
  else console.log(line);
}

/** Classify an ingest/import reason as a platform limitation vs our own failure. */
export function classifyReason(reason: string | null | undefined): ModeBOutcome {
  if (!reason) return "success";
  if (
    reason === "public_retrieval_blocked" ||
    reason === "no_public_media_metadata" ||
    reason.includes("login") ||
    reason.includes("429") ||
    reason.includes("blocked")
  )
    return "platform_limit";
  return "failure";
}
