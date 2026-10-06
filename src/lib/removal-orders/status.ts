export const CASE_STATUSES = [
  ["awaiting_payment", "Awaiting Payment"],
  ["case_received", "Case Received"],
  ["verification", "Verification in Progress"],
  ["evidence_review", "Evidence Review"],
  ["preparing", "Removal Request Preparing"],
  ["submitted", "Submitted"],
  ["platform_review", "Platform Review"],
  ["info_required", "Additional Information Required"],
  ["info_submitted", "Information Submitted — Under Review"],
  ["escalation", "Escalation in Progress"],
  ["resubmitted", "Resubmitted"],
  ["removed", "Removed"],
  ["rejected", "Rejected by Platform"],
  ["unable", "Unable to Complete"],
  ["closed", "Closed"],
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number][0];
export const CASE_STATUS_KEYS = CASE_STATUSES.map(([k]) => k) as [CaseStatus, ...CaseStatus[]];

export const PAYMENT_STATUSES = [
  ["awaiting_invoice", "Awaiting Invoice"],
  ["invoice_sent", "Invoice Sent"],
  ["payment_pending", "Payment Pending"],
  ["paid", "Paid"],
  ["refunded", "Refunded"],
  ["cancelled", "Cancelled"],
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number][0];

export const caseLabel = (k: string) => CASE_STATUSES.find(([s]) => s === k)?.[1] ?? k;
export const paymentLabel = (k: string) => PAYMENT_STATUSES.find(([s]) => s === k)?.[1] ?? k;

/** Statuses whose change warrants a customer email. */
export const MATERIAL_STATUSES: CaseStatus[] = [
  "case_received", "submitted", "platform_review", "escalation", "info_required", "removed", "rejected", "unable", "closed",
];
export const FINAL_UNSUCCESSFUL: CaseStatus[] = ["rejected", "unable"];

export const REMOVED_CUSTOMER_TEXT =
  "The submitted URL was checked by Eterna and the content was no longer publicly accessible at the time of verification.";
