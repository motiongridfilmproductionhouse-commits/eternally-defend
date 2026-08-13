import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Enforcement email (Amazon SES) status + controlled test send.
 * All AWS access happens inside handlers; no credentials reach the client.
 */

export const getEnforcementEmailStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getSesSenderConfig, isSesConfigured } = await import("./transports/ses-transport");
    const cfg = getSesSenderConfig();
    return {
      configured: isSesConfigured(),
      provider: "SES" as const,
      region: process.env.AWS_SES_REGION || process.env.AWS_REGION || null,
      fromEmail: cfg.fromEmail,
      replyTo: cfg.replyTo,
      testMailbox: cfg.testDestination,
      testMode: process.env.ENFORCEMENT_TEST_MODE === "true",
      liveEnabled: process.env.ENFORCEMENT_LIVE_ENABLED === "true",
      productionAllowlistEnabled: process.env.ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED === "true",
      emergencyPaused: process.env.ENFORCEMENT_EMERGENCY_PAUSE === "true",
      demoMode: process.env.DEMO_MODE === "true",
      missing: [
        !(process.env.AWS_SES_REGION || process.env.AWS_REGION) ? "AWS_SES_REGION" : null,
        !(process.env.AWS_SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)
          ? "AWS_SES_ACCESS_KEY_ID"
          : null,
        !(process.env.AWS_SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY)
          ? "AWS_SES_SECRET_ACCESS_KEY"
          : null,
      ].filter(Boolean) as string[],
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

    const { SesEnforcementTransport, getSesSenderConfig } = await import("./transports/ses-transport");
    const { recordEmailDelivery } = await import("./email-delivery-log.server");
    const cfg = getSesSenderConfig();

    const subject = "Eterna Sentinel — Enforcement mail delivery self-test";
    const textBody = [
      "This is an internal Eterna Sentinel enforcement mail delivery self-test.",
      "",
      `Triggered by: ${email}`,
      `Timestamp: ${new Date().toISOString()}`,
      `Sender: ${cfg.fromEmail}`,
      `Region: ${process.env.AWS_SES_REGION || process.env.AWS_REGION}`,
      "",
      "No action is requested against any third party.",
    ].join("\n");

    const result = await new SesEnforcementTransport().send({
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

/** Sends the real notice for one of the caller's own enforcement requests. */
export const sendEnforcementRequestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enforcementRequestId: string; destinationEmail: string }) => {
    if (!input?.enforcementRequestId) throw new Error("enforcementRequestId is required");
    if (!input?.destinationEmail?.includes("@")) throw new Error("A valid destination email is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context as { userId: string; supabase: any };
    const { sendEnforcementRequestNotice } = await import("./notice-sender.server");
    return sendEnforcementRequestNotice(supabase, {
      userId,
      enforcementRequestId: data.enforcementRequestId,
      destinationEmail: data.destinationEmail,
    });
  });
