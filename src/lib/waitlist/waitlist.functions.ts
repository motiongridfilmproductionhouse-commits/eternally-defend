import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Public, unauthenticated waitlist endpoints for /waitinglist.
 * Writes go through the SECURITY DEFINER RPC `join_waitlist` using the
 * publishable key, so registration never depends on the admin service-role
 * credential (which is not present in every deployment target). The table
 * itself has no anon grants; the RPC validates and dedupes server-side.
 */

/** Publishable server client — safe for the two public waitlist RPCs. */
function publicClient() {
  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"]!;
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}


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

export type JoinWaitlistResult =
  | { status: "JOINED"; waitlistId: string }
  | { status: "ALREADY_JOINED"; waitlistId: string }
  | { status: "ERROR"; message: string };

export const joinWaitlist = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => JoinInput.parse(d))
  .handler(async ({ data }): Promise<JoinWaitlistResult> => {
    const emailNormalized = data.email.trim().toLowerCase();
    const phoneNormalized = normalizePhone(data.phone);
    if (phoneNormalized.length < 7) {
      return { status: "ERROR", message: "Please enter a valid mobile number." };
    }

    const { data: rows, error } = await publicClient().rpc("join_waitlist", {
      p_full_name: data.fullName,
      p_email: data.email,
      p_email_normalized: emailNormalized,
      p_phone: data.phone,
      p_phone_normalized: phoneNormalized,
      p_persona: data.persona,
      p_organization: data.organization?.trim() || null,
      p_source: data.source ?? null,
      p_utm_source: data.utmSource ?? null,
      p_utm_medium: data.utmMedium ?? null,
      p_utm_campaign: data.utmCampaign ?? null,
      p_referrer: data.referrer ?? null,
    });

    const row = (rows as Array<{ result_status: string; result_waitlist_id: string | null }> | null)?.[0];

    if (error || !row) {
      console.error("[waitlist] rpc failed", error?.message ?? "no row returned");
      return {
        status: "ERROR",
        message: "We couldn't complete your registration. Please try again.",
      };
    }

    if (row.result_status === "ALREADY_JOINED" && row.result_waitlist_id) {
      return { status: "ALREADY_JOINED", waitlistId: row.result_waitlist_id };
    }

    if (row.result_status !== "JOINED" || !row.result_waitlist_id) {
      return { status: "ERROR", message: "Please check your details and try again." };
    }

    const waitlistId = row.result_waitlist_id;


    // Notify the admin inbox. Never let a mail failure break the registration.
    try {
      const { sendWaitlistAdminAlert } = await import("./admin-alert.server");
      const alert = await sendWaitlistAdminAlert({
        waitlistId,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        persona: data.persona,
        organization: data.organization?.trim() || null,
        source: data.source ?? null,
        utmSource: data.utmSource ?? null,
        utmMedium: data.utmMedium ?? null,
        utmCampaign: data.utmCampaign ?? null,
        referrer: data.referrer ?? null,
      });
      if (!alert.ok) console.error("[waitlist] admin alert failed:", alert.error);
    } catch (err) {
      console.error("[waitlist] admin alert threw:", (err as Error)?.message);
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
