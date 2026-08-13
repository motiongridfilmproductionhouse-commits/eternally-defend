/**
 * Durable audit log for every outbound Enforcement Center email.
 * Server-only: uses the service-role client so failures are still persisted
 * even when the request is unauthenticated (worker context).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnforcementEmailSendResult } from "./transports/email-transport";

export interface DeliveryLogInput {
  userId: string;
  enforcementRequestId?: string | null;
  caseId?: string | null;
  provider?: string;
  fromEmail: string;
  intendedRecipient: string;
  subject: string;
  testMode: boolean;
  attachments?: Array<{ label: string; key?: string; expiresInSeconds?: number }>;
  metadata?: Record<string, unknown>;
}

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export async function recordEmailDelivery(
  input: DeliveryLogInput,
  result: EnforcementEmailSendResult,
): Promise<string | null> {
  const status = result.success ? "SENT" : result.status;
  try {
    const db = await admin();
    const { data } = await (db as any)
      .from("enforcement_email_deliveries")
      .insert({
        user_id: input.userId,
        enforcement_request_id: input.enforcementRequestId ?? null,
        case_id: input.caseId ?? null,
        provider: input.provider ?? "SES",
        from_email: input.fromEmail,
        intended_recipient: input.intendedRecipient,
        destination_email: result.actualRecipient ?? input.intendedRecipient,
        subject: input.subject,
        provider_message_id: result.providerMessageId ?? null,
        delivery_status: status,
        error: result.error ?? null,
        test_mode: input.testMode,
        attachments: (input.attachments ?? []) as never,
        metadata: {
          ...(input.metadata ?? {}),
          notes: result.notes ?? null,
          retryable: result.status === "FAILED_RETRYABLE",
        } as never,
        sent_at: result.success ? (result.submittedAt ?? new Date().toISOString()) : null,
      })
      .select("id")
      .maybeSingle();
    return (data?.id as string) ?? null;
  } catch (err) {
    console.error("[enforcement/email] failed to persist delivery log", err);
    return null;
  }
}
