import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Public, unauthenticated waitlist endpoints for /waitinglist.
 * Writes go through the admin client inside the handler (the table has no
 * anon grants), after strict server-side validation. No auth, KYC, or
 * account creation is involved, and nothing here touches existing auth.
 */

const PERSONAS = ["Student", "Individual", "Professional", "Organization"] as const;

const JoinInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(7).max(24),
  persona: z.enum(PERSONAS),
  organization: z.string().trim().max(160).optional().nullable(),
  source: z.string().trim().max(60).optional().nullable(),
  utmSource: z.string().trim().max(60).optional().nullable(),
  utmMedium: z.string().trim().max(60).optional().nullable(),
  utmCampaign: z.string().trim().max(80).optional().nullable(),
  referrer: z.string().trim().max(500).optional().nullable(),
});

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  // Compare on the last 10 significant digits so +91 / 0091 / 0-prefixed
  // variants of the same number are treated as one person.
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function generateWaitlistId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `ET-WL-${suffix}`;
}

export type JoinWaitlistResult =
  | { status: "JOINED"; waitlistId: string }
  | { status: "ALREADY_JOINED"; waitlistId: string }
  | { status: "ERROR"; message: string };

export const joinWaitlist = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => JoinInput.parse(d))
  .handler(async ({ data }): Promise<JoinWaitlistResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const emailNormalized = data.email.trim().toLowerCase();
    const phoneNormalized = normalizePhone(data.phone);
    if (phoneNormalized.length < 7) {
      return { status: "ERROR", message: "Please enter a valid mobile number." };
    }

    const findExisting = async () => {
      const { data: rows } = await supabaseAdmin
        .from("waitlist_signups")
        .select("waitlist_id")
        .or(`email_normalized.eq.${emailNormalized},phone_normalized.eq.${phoneNormalized}`)
        .limit(1);
      return rows?.[0]?.waitlist_id ?? null;
    };

    const existing = await findExisting();
    if (existing) return { status: "ALREADY_JOINED", waitlistId: existing };

    const waitlistId = generateWaitlistId();
    const { error } = await supabaseAdmin.from("waitlist_signups").insert({
      waitlist_id: waitlistId,
      full_name: data.fullName,
      email: data.email,
      email_normalized: emailNormalized,
      phone: data.phone,
      phone_normalized: phoneNormalized,
      persona: data.persona,
      organization: data.organization?.trim() || null,
      source: data.source ?? null,
      utm_source: data.utmSource ?? null,
      utm_medium: data.utmMedium ?? null,
      utm_campaign: data.utmCampaign ?? null,
      referrer: data.referrer ?? null,
    });

    if (error) {
      // Unique violation = a concurrent submission of the same person.
      const raced = await findExisting();
      if (raced) return { status: "ALREADY_JOINED", waitlistId: raced };
      console.error("[waitlist] insert failed", error.message);
      return { status: "ERROR", message: "We couldn't complete your registration. Please try again." };
    }

    return { status: "JOINED", waitlistId };
  });

/** Real count only — returns null when the list is still empty so the UI never invents a number. */
export const getWaitlistCount = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("waitlist_signups")
    .select("id", { count: "exact", head: true });
  return { count: count && count > 0 ? count : null };
});
