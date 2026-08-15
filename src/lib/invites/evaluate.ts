/**
 * Pure invite-code evaluation logic.
 *
 * Mirrors public.claim_signup_invite() in the database. The DB function is the
 * authoritative, race-safe gate (row lock + increment); this module exists so the
 * same rules are unit-testable and so callers can produce consistent generic errors.
 *
 * IMPORTANT: never surface `reason` to unauthenticated clients — it distinguishes
 * "no such code" from "expired". Public callers must return GENERIC_INVITE_ERROR.
 */

export const GENERIC_INVITE_ERROR = "Invalid or expired invitation code";

export type InviteRow = {
  id: string;
  status: string;
  expires_at: string | null;
  max_uses: number;
  use_count: number;
  assigned_email: string | null;
  account_type: string | null;
};

export type InviteReason =
  | "not_found"
  | "not_active"
  | "expired"
  | "exhausted"
  | "email_mismatch";

export type InviteEvaluation =
  | { ok: true; inviteId: string; accountType: string | null; emailBound: boolean }
  | { ok: false; reason: InviteReason };

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Evaluate an invite row. `email` may be empty during the pre-signup code check —
 * email-bound codes are then treated as valid-so-far and re-checked at signup time.
 */
export function evaluateInvite(
  row: InviteRow | null | undefined,
  email: string,
  now: Date = new Date(),
): InviteEvaluation {
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "active") return { ok: false, reason: "not_active" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (row.use_count >= row.max_uses) return { ok: false, reason: "exhausted" };

  const bound = normalizeEmail(row.assigned_email);
  const candidate = normalizeEmail(email);
  if (bound && candidate && bound !== candidate) {
    return { ok: false, reason: "email_mismatch" };
  }

  return { ok: true, inviteId: row.id, accountType: row.account_type, emailBound: Boolean(bound) };
}

/** Invalid-attempt rate limit: max failures allowed inside the window. */
export const INVITE_ATTEMPT_LIMIT = 10;
export const INVITE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export function isRateLimited(recentFailureCount: number): boolean {
  return recentFailureCount >= INVITE_ATTEMPT_LIMIT;
}
