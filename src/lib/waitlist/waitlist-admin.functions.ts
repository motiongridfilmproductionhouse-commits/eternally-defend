import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin review of stored waitlist registrations.
 * Approving a signup issues a single-use, email-bound invitation code and emails
 * the person a login-creation link. Signup stays invite-only.
 */

async function assertAdmin(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (!isAdmin && !isSuper) throw new Error("Forbidden");
}

export const listWaitlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("waitlist_signups")
      .select(
        "id, waitlist_id, full_name, email, phone, persona, organization, source, utm_source, utm_campaign, status, admin_notes, reviewed_at, invite_sent_at, invite_email_error, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const rows = data ?? [];
    return {
      rows,
      counts: {
        total: rows.length,
        pending: rows.filter((r) => r.status === "PENDING").length,
        approved: rows.filter((r) => r.status === "APPROVED").length,
        declined: rows.filter((r) => r.status === "DECLINED").length,
      },
    };
  });

export const approveWaitlistSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; accountType?: string | null; expiresInDays?: number }) => ({
    id: String(input?.id ?? ""),
    accountType: input?.accountType || null,
    expiresInDays: Math.min(Math.max(Number(input?.expiresInDays ?? 14), 1), 90),
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: row, error: readErr } = await context.supabase
      .from("waitlist_signups")
      .select("id, waitlist_id, full_name, email, status")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) throw new Error("Waitlist entry not found");

    const { generateInviteCode, hashInviteCode } = await import("@/lib/invites/invites.server");
    const { sendWaitlistApprovalEmail, appBaseUrl } = await import("./invite-mail.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString();
    const email = row.email.trim().toLowerCase();

    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from("signup_invites")
      .insert({
        code_hash: hashInviteCode(code),
        label: `Waitlist ${row.waitlist_id} — ${row.full_name}`,
        max_uses: 1,
        expires_at: expiresAt,
        assigned_email: email,
        account_type: data.accountType,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (inviteErr) throw inviteErr;

    const signupUrl = `${appBaseUrl(getRequestHeader("origin"))}/auth?invite=${encodeURIComponent(code)}`;
    const mail = await sendWaitlistApprovalEmail({
      to: row.email,
      fullName: row.full_name,
      code,
      signupUrl,
      expiresAt,
    });

    await supabaseAdmin
      .from("waitlist_signups")
      .update({
        status: "APPROVED",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        invite_id: invite.id,
        invite_sent_at: mail.ok ? new Date().toISOString() : null,
        invite_email_error: mail.ok ? null : (mail.error ?? "send failed"),
      })
      .eq("id", row.id);

    return {
      ok: true as const,
      code,
      signupUrl,
      expiresAt,
      emailSent: mail.ok,
      emailError: mail.ok ? null : (mail.error ?? "send failed"),
    };
  });

export const declineWaitlistSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; notes?: string | null }) => ({
    id: String(input?.id ?? ""),
    notes: input?.notes?.slice(0, 500) || null,
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("waitlist_signups")
      .update({
        status: "DECLINED",
        admin_notes: data.notes,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true as const };
  });
