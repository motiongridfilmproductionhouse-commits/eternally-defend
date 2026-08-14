/**
 * Explicit production recipient allowlist + suppression gate.
 *
 * Fail-closed contract:
 *  - In LIVE mode a recipient is permitted ONLY when an active row exists in
 *    public.enforcement_recipient_allowlist matching the exact address or its
 *    domain. The ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED flag alone NEVER
 *    authorizes a recipient — it is an additional required gate.
 *  - Any lookup error, empty allowlist, or unknown recipient => blocked.
 *  - In TEST mode the only permitted recipient is the configured internal test
 *    mailbox, so no third party can ever be addressed.
 *  - Suppressed (bounced/complained) addresses are always blocked.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecipientGateResult {
  allowed: boolean;
  reason?: string;
  matchedEntry?: string;
}

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase().trim();
}

/** True when the address (or its domain) has an active allowlist entry. */
export async function isRecipientAllowlisted(recipient: string): Promise<RecipientGateResult> {
  const email = (recipient ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    return { allowed: false, reason: "Recipient is not a valid email address." };
  }
  const domain = emailDomain(email);

  try {
    const db = await admin();
    const { data, error } = await (db as any)
      .from("enforcement_recipient_allowlist")
      .select("entry_type, value, active")
      .eq("active", true);

    if (error) {
      return {
        allowed: false,
        reason: "Recipient allowlist could not be read; blocking send (fail closed).",
      };
    }

    const rows = (data ?? []) as Array<{ entry_type: string; value: string }>;
    const match = rows.find((r) => {
      const v = (r.value ?? "").trim().toLowerCase();
      if (!v) return false;
      if (r.entry_type === "ADDRESS") return v === email;
      if (r.entry_type === "DOMAIN") return v === domain || v === `@${domain}`;
      return false;
    });

    if (!match) {
      return {
        allowed: false,
        reason: `Recipient ${email} is not on the approved production enforcement recipient allowlist.`,
      };
    }

    return { allowed: true, matchedEntry: `${match.entry_type}:${match.value}` };
  } catch {
    return {
      allowed: false,
      reason: "Recipient allowlist lookup failed; blocking send (fail closed).",
    };
  }
}

/** True when the address is currently suppressed (hard bounce / complaint / manual). */
export async function isRecipientSuppressed(recipient: string): Promise<RecipientGateResult> {
  const email = (recipient ?? "").trim().toLowerCase();
  try {
    const db = await admin();
    const { data, error } = await (db as any)
      .from("enforcement_suppressions")
      .select("email, reason, active")
      .eq("active", true);

    if (error) {
      return { allowed: false, reason: "Suppression list unreadable; blocking send (fail closed)." };
    }

    const hit = ((data ?? []) as Array<{ email: string; reason: string }>).find(
      (r) => (r.email ?? "").trim().toLowerCase() === email,
    );
    if (hit) {
      return { allowed: false, reason: `Recipient ${email} is suppressed (${hit.reason}).` };
    }
    return { allowed: true };
  } catch {
    return { allowed: false, reason: "Suppression lookup failed; blocking send (fail closed)." };
  }
}

/**
 * Single send-time recipient gate used by every outbound transport.
 * `recipient` must be the FINAL recipient the provider will be handed.
 */
export async function assertRecipientPermitted(
  recipient: string,
  opts: { isTestMode: boolean; isLiveEnabled: boolean },
): Promise<RecipientGateResult> {
  const email = (recipient ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    return { allowed: false, reason: "Recipient is not a valid email address." };
  }

  const suppression = await isRecipientSuppressed(email);
  if (!suppression.allowed) return suppression;

  if (opts.isTestMode) {
    const testDestination = (process.env.ENFORCEMENT_TEST_DESTINATION ?? "").trim().toLowerCase();
    if (!testDestination) {
      return {
        allowed: false,
        reason: "Test mode is active but ENFORCEMENT_TEST_DESTINATION is not configured.",
      };
    }
    if (email !== testDestination) {
      return {
        allowed: false,
        reason: "Test mode permits only the configured internal test mailbox as recipient.",
      };
    }
    return { allowed: true, matchedEntry: "TEST_MAILBOX" };
  }

  if (!opts.isLiveEnabled) {
    return { allowed: false, reason: "Live enforcement is disabled (kill switch)." };
  }

  if (process.env.ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED !== "true") {
    return {
      allowed: false,
      reason: "Production allowlist enforcement flag is not enabled.",
    };
  }

  return isRecipientAllowlisted(email);
}
