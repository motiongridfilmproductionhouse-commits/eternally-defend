/**
 * Provider (Resend) event ingestion: persists an append-only provider event
 * ledger, maintains suppression state for hard bounces / complaints, and
 * mirrors bounce/complaint signals into enforcement_events so the enforcement
 * circuit breaker can trip on them.
 *
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type NormalizedProviderEvent =
  | "DELIVERED"
  | "HARD_BOUNCE"
  | "SOFT_BOUNCE"
  | "COMPLAINT"
  | "DELIVERY_FAILED"
  | "DEFERRED"
  | "OTHER";

export function normalizeResendEvent(
  type: string,
  payload: Record<string, unknown>,
): NormalizedProviderEvent {
  const t = (type ?? "").toLowerCase();
  const bounceType = String(
    ((payload?.["bounce"] as Record<string, unknown> | undefined)?.["type"] as string) ?? "",
  ).toLowerCase();

  if (t === "email.delivered") return "DELIVERED";
  if (t === "email.bounced") {
    if (bounceType.includes("transient") || bounceType.includes("soft")) return "SOFT_BOUNCE";
    return "HARD_BOUNCE";
  }
  if (t === "email.complained") return "COMPLAINT";
  if (t === "email.failed") return "DELIVERY_FAILED";
  if (t === "email.delivery_delayed") return "DEFERRED";
  return "OTHER";
}

/** Event types that mark an address unusable for future enforcement mail. */
export function isSuppressingEvent(normalized: NormalizedProviderEvent): boolean {
  return normalized === "HARD_BOUNCE" || normalized === "COMPLAINT";
}

/** Circuit-breaker relevant enforcement_events mapping. */
export function circuitBreakerEventType(normalized: NormalizedProviderEvent): string | null {
  if (normalized === "HARD_BOUNCE") return "EMAIL_HARD_BOUNCE";
  if (normalized === "COMPLAINT") return "EMAIL_COMPLAINT";
  if (normalized === "DELIVERY_FAILED") return "DELIVERY_FAILED";
  return null;
}

async function admin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

export interface IngestResult {
  providerEventId: string | null;
  normalized: NormalizedProviderEvent;
  suppressed: boolean;
  linkedDeliveryId: string | null;
}

export async function ingestResendEvent(input: {
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}): Promise<IngestResult> {
  const db = await admin();
  const data = (input.payload?.["data"] as Record<string, unknown>) ?? input.payload ?? {};
  const normalized = normalizeResendEvent(input.eventType, data);

  const providerMessageId = (data["email_id"] as string) ?? (data["id"] as string) ?? null;
  const toField = data["to"];
  const recipient = Array.isArray(toField)
    ? String(toField[0] ?? "")
    : typeof toField === "string"
      ? toField
      : "";
  const reason =
    ((data["bounce"] as Record<string, unknown> | undefined)?.["message"] as string) ??
    ((data["failed"] as Record<string, unknown> | undefined)?.["reason"] as string) ??
    null;

  // Correlate back to the outbound delivery audit row when possible.
  type DeliveryRef = { id: string; user_id: string; case_id: string | null };
  let delivery: DeliveryRef | null = null;
  if (providerMessageId) {
    const { data: d } = await (db as any)
      .from("enforcement_email_deliveries")
      .select("id, user_id, case_id")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    delivery = (d as DeliveryRef | null) ?? null;
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();

  const { data: inserted, error: insertError } = await (db as any)
    .from("enforcement_provider_events")
    .insert({
      provider: "RESEND",
      event_type: input.eventType,
      normalized_type: normalized,
      provider_message_id: providerMessageId,
      recipient: recipient || null,
      user_id: delivery?.user_id ?? null,
      case_id: delivery?.case_id ?? null,
      delivery_id: delivery?.id ?? null,
      reason,
      payload: input.payload as never,
      occurred_at: occurredAt,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    // Never silently drop a provider event: fail so the provider retries.
    throw new Error(`provider_event_insert_failed: ${insertError.message}`);
  }

  const providerEventId = (inserted?.id as string) ?? null;

  // Suppression state for hard bounces and complaints.
  let suppressed = false;
  if (recipient && isSuppressingEvent(normalized)) {
    const { error: suppressionError } = await (db as any)
      .from("enforcement_suppressions")
      .upsert(
        {
          email: recipient.toLowerCase(),
          reason: `${normalized}${reason ? `: ${reason.slice(0, 200)}` : ""}`,
          source: "RESEND_WEBHOOK",
          active: true,
          provider_event_id: providerEventId,
        },
        { onConflict: "email" },
      );
    if (suppressionError) {
      throw new Error(`suppression_upsert_failed: ${suppressionError.message}`);
    }
    suppressed = true;
  }


  // Feed the enforcement circuit breaker via the enforcement event ledger.
  const cbType = circuitBreakerEventType(normalized);
  if (cbType && delivery?.user_id) {
    await (db as any).from("enforcement_events").insert({
      case_id: delivery.case_id,
      user_id: delivery.user_id,
      event_type: cbType,
      actor_type: "PROVIDER",
      metadata: {
        provider: "RESEND",
        providerMessageId,
        recipient,
        reason,
        providerEventId,
      } as never,
    });
  }

  // Mirror the provider outcome onto the outbound delivery audit row so the
  // enforcement UI reflects the terminal delivery status.
  if (delivery?.id) {
    const statusMap: Partial<Record<NormalizedProviderEvent, string>> = {
      DELIVERED: "DELIVERED",
      HARD_BOUNCE: "BOUNCED",
      SOFT_BOUNCE: "DEFERRED",
      COMPLAINT: "COMPLAINED",
      DELIVERY_FAILED: "FAILED",
      DEFERRED: "DEFERRED",
    };
    const nextStatus = statusMap[normalized];
    if (nextStatus) {
      await (db as any)
        .from("enforcement_email_deliveries")
        .update({ delivery_status: nextStatus, ...(reason ? { error: reason.slice(0, 500) } : {}) })
        .eq("id", delivery.id);
    }
  }

  return {

    providerEventId,
    normalized,
    suppressed,
    linkedDeliveryId: delivery?.id ?? null,
  };
}
