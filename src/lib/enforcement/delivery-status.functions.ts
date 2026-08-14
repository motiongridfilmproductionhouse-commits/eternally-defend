/**
 * Read-only derived delivery status for the Enforcement Center UI.
 *
 * enforcement_email_deliveries is append-only at the database level. This
 * helper never mutates historical rows: it reads the derived view
 * public.enforcement_delivery_status, which computes the latest effective
 * state from delivery rows + provider event ledger.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EffectiveDeliveryStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "SOFT_BOUNCE"
  | "HARD_BOUNCE"
  | "COMPLAINT"
  | "SUPPRESSED"
  | "FAILED";

export interface DeliveryStatusRow {
  id: string;
  caseId: string | null;
  enforcementRequestId: string | null;
  provider: string;
  fromEmail: string;
  intendedRecipient: string;
  destinationEmail: string;
  subject: string;
  providerMessageId: string | null;
  recordedStatus: string;
  effectiveStatus: EffectiveDeliveryStatus;
  latestEventType: string | null;
  latestEventReason: string | null;
  latestEventAt: string | null;
  testMode: boolean;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

const KNOWN: EffectiveDeliveryStatus[] = [
  "PENDING",
  "SENT",
  "DELIVERED",
  "SOFT_BOUNCE",
  "HARD_BOUNCE",
  "COMPLAINT",
  "SUPPRESSED",
  "FAILED",
];

function normalizeStatus(value: unknown): EffectiveDeliveryStatus {
  const upper = String(value ?? "").toUpperCase();
  return (KNOWN.find((s) => s === upper) ?? "PENDING") as EffectiveDeliveryStatus;
}

/** UI presentation hint for a derived delivery status. */
export function deliveryStatusTone(
  status: EffectiveDeliveryStatus,
): "positive" | "warning" | "critical" | "neutral" {
  switch (status) {
    case "DELIVERED":
      return "positive";
    case "SOFT_BOUNCE":
      return "warning";
    case "HARD_BOUNCE":
    case "COMPLAINT":
    case "FAILED":
    case "SUPPRESSED":
      return "critical";
    default:
      return "neutral";
  }
}

export function deliveryStatusLabel(status: EffectiveDeliveryStatus): string {
  switch (status) {
    case "SOFT_BOUNCE":
      return "Soft bounce";
    case "HARD_BOUNCE":
      return "Hard bounce";
    case "COMPLAINT":
      return "Complaint";
    case "SUPPRESSED":
      return "Suppressed";
    case "DELIVERED":
      return "Delivered";
    case "SENT":
      return "Sent";
    case "FAILED":
      return "Failed";
    default:
      return "Pending";
  }
}

export const getEnforcementDeliveryStatuses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { caseId?: string; limit?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<DeliveryStatusRow[]> => {
    const limit = Math.min(Math.max(data.limit ?? 100, 1), 200);
    let query = (context.supabase as any)
      .from("enforcement_delivery_status")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (data.caseId) query = query.eq("case_id", data.caseId);

    const { data: rows, error } = await query;
    if (error) throw new Error(`Failed to load delivery statuses: ${error.message}`);

    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id as string,
      caseId: (r.case_id as string | null) ?? null,
      enforcementRequestId: (r.enforcement_request_id as string | null) ?? null,
      provider: (r.provider as string) ?? "RESEND",
      fromEmail: (r.from_email as string) ?? "",
      intendedRecipient: (r.intended_recipient as string) ?? "",
      destinationEmail: (r.destination_email as string) ?? "",
      subject: (r.subject as string) ?? "",
      providerMessageId: (r.provider_message_id as string | null) ?? null,
      recordedStatus: (r.recorded_status as string) ?? "PENDING",
      effectiveStatus: normalizeStatus(r.effective_status),
      latestEventType: (r.latest_event_type as string | null) ?? null,
      latestEventReason: (r.latest_event_reason as string | null) ?? null,
      latestEventAt: (r.latest_event_at as string | null) ?? null,
      testMode: Boolean(r.test_mode),
      error: (r.error as string | null) ?? null,
      sentAt: (r.sent_at as string | null) ?? null,
      createdAt: (r.created_at as string) ?? new Date().toISOString(),
    }));
  });
