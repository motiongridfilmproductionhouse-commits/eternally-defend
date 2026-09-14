export type AssessmentStatus =
  "QUEUED" | "SCANNING" | "ANALYZING" | "READY" | "FAILED" | "REVIEW_REQUIRED" | "EXPIRED";
export type Price = {
  minimum: number;
  maximum: number;
  currency: "INR";
  period: "YEAR";
  policy_version: number;
};
export type Signals = {
  matched_pages: number;
  domains: number;
  official_profile_found: boolean;
  identity_misuse: null;
  ai_misuse: null;
  scope: string;
};
export type Assessment = {
  id: string;
  agent_id: string;
  artist_name: string;
  official_profile_url: string | null;
  status: AssessmentStatus;
  stage: string;
  signals: Signals | null;
  pricing: Price | null;
  reason: string | null;
  conversion_status: string;
  created_at: string;
  updated_at: string;
};
export const isTerminal = (status: AssessmentStatus) =>
  ["READY", "FAILED", "REVIEW_REQUIRED", "EXPIRED"].includes(status);
export function formatPrice(price: Price) {
  const format = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: price.currency,
      maximumFractionDigits: 0,
    }).format(value);
  return `${format(price.minimum)} – ${format(price.maximum)} / year`;
}
