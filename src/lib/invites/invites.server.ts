import { createHash, randomBytes } from "crypto";
import {
  evaluateInvite,
  normalizeInviteCode,
  normalizeEmail,
  INVITE_ATTEMPT_WINDOW_MS,
  isRateLimited,
  type InviteRow,
} from "./evaluate";

/**
 * Hash of the invitation code. Only the hash is stored — the plaintext code exists
 * once, at creation time, in the admin's browser.
 */
export function hashInviteCode(raw: string): string {
  const pepper = process.env["INVITE_CODE_PEPPER"] ?? "";
  return createHash("sha256").update(`${pepper}:${normalizeInviteCode(raw)}`).digest("hex");
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars

export function generateInviteCode(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `ETRN-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

const INVITE_COLUMNS = "id, status, expires_at, max_uses, use_count, assigned_email, account_type";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Log an invite attempt (used for rate limiting invalid guesses). */
export async function recordInviteAttempt(
  actorKey: string,
  email: string | null,
  succeeded: boolean,
): Promise<void> {
  const db = await admin();
  await db.from("signup_invite_attempts").insert({ actor_key: actorKey, email, succeeded });
}

export async function inviteAttemptsBlocked(actorKey: string): Promise<boolean> {
  const db = await admin();
  const since = new Date(Date.now() - INVITE_ATTEMPT_WINDOW_MS).toISOString();
  const { count } = await db
    .from("signup_invite_attempts")
    .select("id", { count: "exact", head: true })
    .eq("actor_key", actorKey)
    .eq("succeeded", false)
    .gte("created_at", since);
  return isRateLimited(count ?? 0);
}

/**
 * Non-consuming pre-check for the "Enter Invitation Code" screen.
 * Returns only what the UI needs — never the reason a code failed.
 */
export async function checkInviteCode(code: string, email?: string) {
  const db = await admin();
  const { data } = await db
    .from("signup_invites")
    .select(INVITE_COLUMNS)
    .eq("code_hash", hashInviteCode(code))
    .maybeSingle();

  const result = evaluateInvite(data as InviteRow | null, email ?? "");
  if (!result.ok) return { ok: false as const };

  const row = data as InviteRow;
  return {
    ok: true as const,
    accountType: result.accountType,
    // Only ever the bound address for THIS code, which the holder already knows.
    assignedEmail: normalizeEmail(row.assigned_email) || null,
  };
}

/**
 * Atomically claim one use of an invite. Returns null when the code is unusable
 * (unknown, inactive, revoked, expired, exhausted, or bound to another email).
 * Race-safe: the DB function locks the row before incrementing use_count.
 */
export async function claimInvite(code: string, email: string) {
  const db = await admin();
  const { data, error } = await db.rpc("claim_signup_invite", {
    _code_hash: hashInviteCode(code),
    _email: normalizeEmail(email),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_id) return null;
  return { inviteId: row.invite_id as string, accountType: (row.account_type ?? null) as string | null };
}

export async function releaseInvite(inviteId: string): Promise<void> {
  const db = await admin();
  await db.rpc("release_signup_invite", { _invite_id: inviteId });
}

export async function recordRedemption(inviteId: string, userId: string, email: string) {
  const db = await admin();
  await db
    .from("signup_invite_redemptions")
    .insert({ invite_id: inviteId, user_id: userId, email: normalizeEmail(email) });
}

/**
 * Create the account after a successful claim. The invite use is released if the
 * account cannot be created, so failed signups never burn an invitation.
 */
export async function createInvitedUser(email: string, password: string) {
  const db = await admin();
  const { data, error } = await db.auth.admin.createUser({
    email: normalizeEmail(email),
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "Account creation failed");
  }
  return data.user;
}
