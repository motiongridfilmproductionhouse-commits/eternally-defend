/**
 * Secure desktop → phone hand-off for Face Protection enrollment.
 *
 * The QR only carries an opaque one-time token. No AWS credentials, no
 * biometric data, no user id. The token is stored hashed, expires quickly,
 * is bound to the authenticated onboarding user, and is consumed on success.
 */
import { createHash, randomBytes } from "crypto";

export const HANDOFF_TTL_MINUTES = 10;

/* eslint-disable @typescript-eslint/no-explicit-any */
type AdminDb = any;

export function hashHandoffToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function admin(): Promise<AdminDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function issueHandoff(userId: string): Promise<{
  token: string;
  expiresAt: string;
}> {
  const db = await admin();
  // Only one live hand-off per user: invalidate anything still pending.
  await db
    .from("face_enrollment_handoffs")
    .update({ status: "SUPERSEDED" })
    .eq("user_id", userId)
    .in("status", ["PENDING", "OPENED"]);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MINUTES * 60_000).toISOString();
  const { error } = await db.from("face_enrollment_handoffs").insert({
    user_id: userId,
    token_hash: hashHandoffToken(token),
    status: "PENDING",
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  return { token, expiresAt };
}

export type HandoffRecord = {
  id: string;
  user_id: string;
  status: string;
  expires_at: string;
};

/**
 * Resolves a token to its owning user, or throws. Never returns anything the
 * phone could use to reach another account.
 */
export async function requireHandoff(token: string, opts?: { userAgent?: string | null }) {
  if (!token || token.length < 20) throw new Error("HANDOFF_INVALID: Invalid secure link.");
  const db = await admin();
  const { data, error } = await db
    .from("face_enrollment_handoffs")
    .select("id,user_id,status,expires_at")
    .eq("token_hash", hashHandoffToken(token))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("HANDOFF_INVALID: This secure link is not valid.");
  if (data.status === "COMPLETED")
    throw new Error("HANDOFF_USED: This secure link was already used.");
  if (data.status === "SUPERSEDED" || data.status === "EXPIRED")
    throw new Error("HANDOFF_EXPIRED: This secure link is no longer active.");
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await db.from("face_enrollment_handoffs").update({ status: "EXPIRED" }).eq("id", data.id);
    throw new Error("HANDOFF_EXPIRED: This secure link has expired.");
  }
  if (data.status === "PENDING") {
    await db
      .from("face_enrollment_handoffs")
      .update({
        status: "OPENED",
        used_at: new Date().toISOString(),
        user_agent: opts?.userAgent ?? null,
      })
      .eq("id", data.id);
  }
  return { db, handoff: data as HandoffRecord };
}

export async function completeHandoff(handoffId: string) {
  const db = await admin();
  await db
    .from("face_enrollment_handoffs")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
    .eq("id", handoffId);
}
