import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Enforcement email (Resend) status + controlled test send.
 * The Resend API key is read inside handlers only; no credentials reach the client.
 */

export const getEnforcementEmailStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getResendSenderConfig, isResendConfigured } = await import(
      "./transports/resend-transport"
    );
    const cfg = getResendSenderConfig();
    return {
      configured: isResendConfigured(),
      provider: "RESEND" as const,
      senderDomain: cfg.senderDomain,
      fromEmail: cfg.fromEmail,
      replyTo: cfg.replyTo,
      testMailbox: cfg.testDestination,
      testMode: process.env.ENFORCEMENT_TEST_MODE === "true",
      liveEnabled: process.env.ENFORCEMENT_LIVE_ENABLED === "true",
      productionAllowlistEnabled: process.env.ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED === "true",
      emergencyPaused: process.env.ENFORCEMENT_EMERGENCY_PAUSE === "true",
      demoMode: process.env.DEMO_MODE === "true",
      missing: [!isResendConfigured() ? "RESEND_API_KEY" : null].filter(Boolean) as string[],
    };
  });

/**
 * Controlled test send. Hard-locked to the internal Eterna test mailbox —
 * the caller cannot choose a recipient, so no third party can ever be emailed.
 */
export const sendEnforcementTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enforcementRequestId?: string } | undefined) => input ?? {})
  .handler(async ({ context }) => {
    const { userId, claims } = context as { userId: string; claims: Record<string, unknown> };
    const email = String((claims as { email?: string })?.email ?? "").toLowerCase();

    const { data: isAdmin } = await (context as any).supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const { isDemoUnrestrictedEmail } = await import("@/lib/security/subject-authorization");
    if (!isAdmin && !isDemoUnrestrictedEmail(email)) {
      throw new Error("Forbidden: enforcement test sends are restricted to Eterna operators.");
    }

    const { ResendEnforcementTransport, getResendSenderConfig } = await import(
      "./transports/resend-transport"
    );
    const { recordEmailDelivery } = await import("./email-delivery-log.server");
    const cfg = getResendSenderConfig();

    const subject = "Eterna Sentinel — Enforcement mail delivery self-test";
    const textBody = [
      "This is an internal Eterna Sentinel enforcement mail delivery self-test.",
      "",
      `Triggered by: ${email}`,
      `Timestamp: ${new Date().toISOString()}`,
      `Sender: ${cfg.fromEmail}`,
      "Provider: Resend",
      "",
      "No action is requested against any third party.",
    ].join("\n");

    const result = await new ResendEnforcementTransport().send({
      caseId: "internal-self-test",
      // Hard-coded internal mailbox: never a third party.
      intendedRecipient: cfg.testDestination,
      subject,
      textBody,
      demoMode: false,
    });

    const deliveryLogId = await recordEmailDelivery(
      {
        userId,
        fromEmail: cfg.fromEmail,
        intendedRecipient: cfg.testDestination,
        subject,
        testMode: true,
        metadata: { kind: "SELF_TEST", triggeredBy: email },
      },
      result,
    );

    return {
      success: result.success,
      status: result.status,
      messageId: result.providerMessageId ?? null,
      destination: result.actualRecipient ?? cfg.testDestination,
      sentAt: result.submittedAt ?? null,
      error: result.error ?? null,
      deliveryLogId,
    };
  });

/**
 * Sends the real notice for one of the caller's own enforcement requests.
 *
 * Hardened: the caller can NOT choose a recipient. The abuse route is resolved
 * server-side and must be VERIFIED, and the caller must hold the admin role —
 * ordinary authenticated users cannot address an arbitrary external party.
 */
export const sendEnforcementRequestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enforcementRequestId: string }) => {
    if (!input?.enforcementRequestId) throw new Error("enforcementRequestId is required");
    return { enforcementRequestId: input.enforcementRequestId };
  })
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context as { userId: string; supabase: any };

    // 1. Operator authorization — manual external sends are operator-only.
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) {
      throw new Error(
        "Manual enforcement sending is restricted to Eterna enforcement operators.",
      );
    }

    // 2. Load the caller-owned request and resolve its recipient server-side.
    const { data: reqRow, error: reqErr } = await supabase
      .from("enforcement_requests")
      .select("id, user_id, target_url")
      .eq("id", data.enforcementRequestId)
      .eq("user_id", userId)
      .maybeSingle();

    if (reqErr || !reqRow) {
      throw new Error("Enforcement request not found for this account.");
    }

    let domain = "";
    try {
      domain = new URL(String(reqRow.target_url)).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      throw new Error("Enforcement request has an invalid target URL.");
    }

    const { EnforcementRouteResolver } = await import("./route-resolver");
    const route = await EnforcementRouteResolver.resolveRoute(supabase, String(reqRow.target_url));
    if (
      route.verificationStatus !== "VERIFIED" ||
      route.submissionMethod !== "EMAIL" ||
      !route.canAutoSend ||
      !route.contactEmail?.includes("@")
    ) {
      throw new Error(
        `No VERIFIED email enforcement route exists for ${domain} (status: ${route.verificationStatus}). Route verification is required before a notice can be sent.`,
      );
    }

    const { sendEnforcementRequestNotice } = await import("./notice-sender.server");
    return sendEnforcementRequestNotice(supabase, {
      userId,
      enforcementRequestId: data.enforcementRequestId,
      destinationEmail: route.contactEmail,
    });
  });

