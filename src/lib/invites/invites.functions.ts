import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GENERIC_INVITE_ERROR } from "./evaluate";

function actorKey(): string {
  const fwd = getRequestHeader("x-forwarded-for") ?? "";
  return (fwd.split(",")[0] || getRequestHeader("cf-connecting-ip") || "unknown").trim();
}

/** Step 1 — pre-signup invitation check. Never consumes a use, never leaks why a code failed. */
export const verifyInviteCode = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string }) => ({ code: String(input?.code ?? "").slice(0, 64) }))
  .handler(async ({ data }) => {
    const {
      checkInviteCode,
      inviteAttemptsBlocked,
      recordInviteAttempt,
    } = await import("./invites.server");
    const key = actorKey();

    if (await inviteAttemptsBlocked(key)) {
      return { ok: false as const, error: "Too many attempts. Please try again later." };
    }

    const result = await checkInviteCode(data.code);
    await recordInviteAttempt(key, null, result.ok);
    if (!result.ok) return { ok: false as const, error: GENERIC_INVITE_ERROR };

    return {
      ok: true as const,
      accountType: result.accountType,
      assignedEmail: result.assignedEmail,
    };
  });

/**
 * Step 2 — create the account. The code is re-validated and atomically claimed here,
 * so a client cannot skip step 1: there is no signup path that does not pass this gate
 * (public Supabase signup is disabled at the auth-provider level).
 */
export const signUpWithInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string; email: string; password: string }) => {
    const email = String(input?.email ?? "").trim();
    const password = String(input?.password ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    return { code: String(input?.code ?? "").slice(0, 64), email, password };
  })
  .handler(async ({ data }) => {
    const {
      claimInvite,
      releaseInvite,
      createInvitedUser,
      recordRedemption,
      inviteAttemptsBlocked,
      recordInviteAttempt,
    } = await import("./invites.server");
    const key = actorKey();

    if (await inviteAttemptsBlocked(key)) {
      return { ok: false as const, error: "Too many attempts. Please try again later." };
    }

    const claim = await claimInvite(data.code, data.email);
    if (!claim) {
      await recordInviteAttempt(key, data.email, false);
      return { ok: false as const, error: GENERIC_INVITE_ERROR };
    }

    try {
      const user = await createInvitedUser(data.email, data.password);
      await recordRedemption(claim.inviteId, user.id, data.email);
      await recordInviteAttempt(key, data.email, true);
      return { ok: true as const, accountType: claim.accountType };
    } catch (e) {
      // Account creation failed — give the invitation use back.
      await releaseInvite(claim.inviteId);
      await recordInviteAttempt(key, data.email, false);
      const message = e instanceof Error ? e.message : "Account creation failed";
      return {
        ok: false as const,
        error: /already|registered|exists/i.test(message)
          ? "An account with this email already exists. Sign in instead."
          : "Could not create the account. Please try again.",
      };
    }
  });

/* ---------------------------------- admin ---------------------------------- */

async function assertAdmin(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (!isAdmin && !isSuper) throw new Error("Forbidden");
}

export const listInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("signup_invites")
      .select(
        "id, label, status, expires_at, max_uses, use_count, assigned_email, account_type, created_at, last_used_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { invites: data ?? [] };
  });

export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      label?: string;
      maxUses?: number;
      expiresAt?: string | null;
      assignedEmail?: string | null;
      accountType?: string | null;
    }) => ({
      label: input?.label?.trim() || null,
      maxUses: Math.min(Math.max(Number(input?.maxUses ?? 1), 1), 500),
      expiresAt: input?.expiresAt || null,
      assignedEmail: input?.assignedEmail?.trim() || null,
      accountType: input?.accountType || null,
    }),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { generateInviteCode, hashInviteCode } = await import("./invites.server");
    const code = generateInviteCode();

    const { error } = await context.supabase.from("signup_invites").insert({
      code_hash: hashInviteCode(code),
      label: data.label,
      max_uses: data.maxUses,
      expires_at: data.expiresAt,
      assigned_email: data.assignedEmail ? data.assignedEmail.toLowerCase() : null,
      account_type: data.accountType,
      created_by: context.userId,
    });
    if (error) throw error;

    // Shown to the admin once — only the hash is persisted.
    return { code };
  });

export const setInviteStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "active" | "inactive" | "revoked" }) => ({
    id: String(input.id),
    status: input.status,
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("signup_invites")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true as const };
  });
