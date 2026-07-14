import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type Method = Database["public"]["Enums"]["verification_method"];
type State = Database["public"]["Enums"]["verification_state"];
type VerRow = Database["public"]["Tables"]["account_verifications"]["Row"];

function randomToken(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "ET-" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

type Json = Database["public"]["Tables"]["account_verifications"]["Insert"]["evidence"];


/* ------------------------------------------------------------------ */
/* startVerification — creates a pending record. For bio_code /       */
/* domain_meta / business_email a token is minted server-side.        */
/* ------------------------------------------------------------------ */
export const startVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    accountId: z.string().uuid(),
    method: z.enum(["oauth", "domain_dns", "domain_meta", "business_email", "bio_code", "document", "admin_review"]),
    evidence: z.record(z.string(), z.unknown()).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: acct, error: aErr } = await context.supabase
      .from("discovered_accounts")
      .select("id, user_id, profile_url, platform, status")
      .eq("id", data.accountId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!acct) throw new Error("Account not found");
    if (acct.user_id !== context.userId) throw new Error("Forbidden");

    const needsToken: Method[] = ["bio_code", "domain_meta", "domain_dns", "business_email"];
    const code = needsToken.includes(data.method as Method) ? randomToken() : null;
    const expires_at = needsToken.includes(data.method as Method)
      ? new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      : null;

    const { data: ver, error } = await context.supabase
      .from("account_verifications")
      .insert({
        user_id: context.userId,
        account_id: data.accountId,
        method: data.method as Method,
        state: "pending" as State,
        code,
        expires_at,
        evidence: data.evidence ?? {},
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Move account to ownership_pending on the first verification attempt (if not already verified/rejected).
    if (!["verified", "rejected"].includes(acct.status)) {
      await context.supabase
        .from("discovered_accounts")
        .update({ status: "ownership_pending" })
        .eq("id", data.accountId);
      await context.supabase.from("account_audit_log").insert({
        account_id: data.accountId,
        actor_id: context.userId,
        action: `verification_started:${data.method}`,
        from_status: acct.status,
        to_status: "ownership_pending",
        meta: { verification_id: ver.id },
      });
    }

    return ver as VerRow;
  });

/* ------------------------------------------------------------------ */
/* checkVerification — re-scrapes the profile / domain page and,     */
/* if the code is present, marks the account verified.                 */
/* ------------------------------------------------------------------ */
export const checkVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    verificationId: z.string().uuid(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: ver, error: vErr } = await context.supabase
      .from("account_verifications")
      .select("*, discovered_accounts!inner(id, profile_url, user_id, status)")
      .eq("id", data.verificationId)
      .maybeSingle();
    if (vErr) throw new Error(vErr.message);
    if (!ver) throw new Error("Verification not found");

    const account = (ver as unknown as { discovered_accounts: { id: string; profile_url: string; user_id: string; status: Database["public"]["Enums"]["discovered_account_status"] } }).discovered_accounts;
    if (account.user_id !== context.userId) throw new Error("Forbidden");
    if (ver.state !== "pending") return ver as VerRow;
    if (ver.expires_at && new Date(ver.expires_at).getTime() < Date.now()) {
      const { data: expired } = await context.supabase
        .from("account_verifications").update({ state: "expired" }).eq("id", ver.id).select("*").single();
      return expired as VerRow;
    }

    let passed = false;
    let evidence: Record<string, unknown> = (ver.evidence ?? {}) as Record<string, unknown>;

    if (ver.method === "bio_code" && ver.code) {
      const { scrapeProfile } = await import("./discovery/firecrawl.server");
      const p = await scrapeProfile(account.profile_url);
      const haystack = `${p.bio ?? ""}\n${p.displayName ?? ""}`;
      passed = haystack.includes(ver.code);
      evidence = { ...evidence, checkedAt: new Date().toISOString(), bio: p.bio?.slice(0, 500) ?? null };
    } else if (ver.method === "domain_meta" && ver.code) {
      const targetUrl = (evidence as { url?: string }).url ?? account.profile_url;
      const { scrapeProfile } = await import("./discovery/firecrawl.server");
      const p = await scrapeProfile(targetUrl);
      const html = p.html ?? "";
      passed = html.includes(`name="eterna-verify"`) && html.includes(ver.code);
      evidence = { ...evidence, checkedAt: new Date().toISOString(), targetUrl };
    } else if (ver.method === "domain_dns" && ver.code) {
      const domain = (evidence as { domain?: string }).domain;
      if (!domain) throw new Error("Missing evidence.domain for DNS check");
      // DNS-over-HTTPS via Cloudflare
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=TXT`, {
        headers: { accept: "application/dns-json" },
      });
      const dns = await res.json() as { Answer?: { data: string }[] };
      const answers = (dns.Answer ?? []).map((a) => a.data.replace(/"/g, ""));
      passed = answers.some((a) => a.includes(`eterna-verify=${ver.code}`));
      evidence = { ...evidence, checkedAt: new Date().toISOString(), answers };
    } else {
      // For oauth / business_email / document / admin_review the check() call is a no-op:
      // those methods are moved to `passed` via their own dedicated flows (or admin approval).
      return ver as VerRow;
    }

    const now = new Date().toISOString();
    const nextState: State = passed ? "passed" : "failed";
    const { data: updated } = await context.supabase
      .from("account_verifications")
      .update({ state: nextState, evidence, verified_at: passed ? now : null })
      .eq("id", ver.id).select("*").single();

    if (passed) {
      await context.supabase
        .from("discovered_accounts")
        .update({ status: "verified" }).eq("id", account.id);
      await context.supabase.from("account_audit_log").insert({
        account_id: account.id,
        actor_id: context.userId,
        action: `verification_passed:${ver.method}`,
        from_status: account.status,
        to_status: "verified",
        meta: { verification_id: ver.id },
      });
    }
    return updated as VerRow;
  });

/* ------------------------------------------------------------------ */
/* listVerifications                                                   */
/* ------------------------------------------------------------------ */
export const listVerifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ accountId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("account_verifications")
      .select("*")
      .eq("account_id", data.accountId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as VerRow[];
  });

/* ------------------------------------------------------------------ */
/* adminApprove — admin-only manual review                             */
/* ------------------------------------------------------------------ */
export const adminApproveVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    verificationId: z.string().uuid(),
    approve: z.boolean(),
    note: z.string().max(500).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: ver, error: vErr } = await context.supabase
      .from("account_verifications")
      .select("*, discovered_accounts!inner(id, status)")
      .eq("id", data.verificationId)
      .maybeSingle();
    if (vErr) throw new Error(vErr.message);
    if (!ver) throw new Error("Verification not found");

    const account = (ver as unknown as { discovered_accounts: { id: string; status: Database["public"]["Enums"]["discovered_account_status"] } }).discovered_accounts;
    const nextState: State = data.approve ? "passed" : "failed";
    const now = new Date().toISOString();

    await context.supabase.from("account_verifications").update({
      state: nextState, reviewer_id: context.userId, verified_at: data.approve ? now : null,
      evidence: { ...(ver.evidence as Record<string, unknown>), reviewerNote: data.note ?? null },
    }).eq("id", ver.id);

    if (data.approve) {
      await context.supabase.from("discovered_accounts").update({ status: "verified" }).eq("id", account.id);
      await context.supabase.from("account_audit_log").insert({
        account_id: account.id, actor_id: context.userId,
        action: `admin_approved:${ver.method}`,
        from_status: account.status, to_status: "verified",
        meta: { verification_id: ver.id, note: data.note ?? null },
      });
    } else {
      await context.supabase.from("account_audit_log").insert({
        account_id: account.id, actor_id: context.userId,
        action: `admin_rejected:${ver.method}`,
        from_status: account.status, to_status: account.status,
        meta: { verification_id: ver.id, note: data.note ?? null },
      });
    }
    return { ok: true };
  });
