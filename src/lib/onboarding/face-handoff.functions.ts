import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const TokenInput = z.object({ token: z.string().min(20).max(200) });

/** Desktop: mint a short-lived one-time link + QR payload for the phone. */
export const createFaceHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { issueHandoff } = await import("./face-handoff.server");
    const { token, expiresAt } = await issueHandoff(context.userId);
    const request = getRequest();
    // Phones must reach a public, non-gated domain — never the Lovable preview host.
    const origin = (() => {
      const configured = process.env["PUBLIC_APP_URL"]?.replace(/\/$/, "");
      if (configured) return configured;
      try {
        const h = request!.headers;
        const host = h.get("x-forwarded-host") || h.get("host") || "";
        const proto = h.get("x-forwarded-proto") || "https";
        const gated = /localhost|127\.0\.0\.1|id-preview|lovableproject\.com/.test(host);
        if (host && !gated) return `${proto}://${host}`;
      } catch {
        /* fall through */
      }
      return "https://www.eternasentinel.com";
    })();
    return { token, url: `${origin}/face-handoff/${token}`, expiresAt };

  });


/** Phone: validate the link and report what the mobile page must show next. */
export const getFaceHandoffSession = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TokenInput.parse(d))
  .handler(async ({ data }) => {
    const { requireHandoff } = await import("./face-handoff.server");
    const request = getRequest();
    const { db, handoff } = await requireHandoff(data.token, {
      userAgent: request?.headers?.get("user-agent") ?? null,
    });
    const { hasActiveConsent } = await import("./face-enrollment-core.server");
    const [{ data: profile }, consent] = await Promise.all([
      db
        .from("protected_face_profiles")
        .select("status")
        .eq("user_id", handoff.user_id)
        .maybeSingle(),
      hasActiveConsent(db, handoff.user_id),
    ]);
    const { data: client } = await db
      .from("client_profiles")
      .select("display_name,full_name")
      .eq("user_id", handoff.user_id)
      .maybeSingle();
    return {
      ok: true as const,
      expiresAt: handoff.expires_at,
      needsConsent: !consent,
      enrollmentStatus: (profile?.status as string | undefined) ?? "NOT_STARTED",
      displayName: client?.display_name || client?.full_name || null,
    };
  });

/** Phone: record biometric consent for the hand-off owner. */
export const handoffRecordConsent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    TokenInput.extend({
      consents: z.record(z.string(), z.boolean()),
      consent_version: z.string().min(1),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireHandoff } = await import("./face-handoff.server");
    const { recordConsentFor } = await import("./face-enrollment-core.server");
    const { db, handoff } = await requireHandoff(data.token);
    const request = getRequest();
    await recordConsentFor(db, handoff.user_id, {
      consents: data.consents,
      consent_version: data.consent_version,
      userAgent: request?.headers?.get("user-agent") ?? null,
      ipAddress: request?.headers?.get("x-forwarded-for") ?? null,
    });
    return { ok: true as const };
  });

/** Phone: start the real AWS Face Liveness session for the hand-off owner. */
export const handoffCreateLivenessSession = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TokenInput.parse(d))
  .handler(async ({ data }) => {
    const { requireHandoff } = await import("./face-handoff.server");
    const { createLivenessSessionFor } = await import("./face-enrollment-core.server");
    const { db, handoff } = await requireHandoff(data.token);
    return createLivenessSessionFor(db, handoff.user_id);
  });

/** Phone: finalize liveness + protected-face enrollment, then burn the token. */
export const handoffFinalizeLiveness = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TokenInput.extend({ sessionId: z.string().min(8) }).parse(d))
  .handler(async ({ data }) => {
    const { requireHandoff, completeHandoff } = await import("./face-handoff.server");
    const { finalizeLivenessFor } = await import("./face-enrollment-core.server");
    const { db, handoff } = await requireHandoff(data.token);
    const res = await finalizeLivenessFor(db, handoff.user_id, data.sessionId);
    if (res.ok) await completeHandoff(handoff.id);
    // Never return the biometric reference image to the phone client.
    if (res.ok)
      return { ok: true as const, status: res.status, confidence: res.confidence };
    return {
      ok: false as const,
      status: res.status,
      code: res.code,
      reason: res.reason,
      confidence: res.confidence,
    };
  });
