// Pure deterministic rules. The policy is loaded only by server code, never returned to agents.
export type PricingPolicy = {
  version: number;
  enabled: boolean;
  minimum_pages: number;
  minimum_domains: number;
  base_annual: number;
  annual_per_domain: number;
  review_minutes_per_page_month: number;
  hourly_review_rate: number;
  range_margin: number;
};
export function normalizeArtist(name: string) {
  const value = name.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (value.length < 2 || value.length > 120 || /[\p{Cc}\p{Cf}]/u.test(value))
    throw new Error("Enter an artist name between 2 and 120 characters.");
  return value;
}
// URLs are identifiers sent as text to search providers, NEVER fetched by this feature.
// Reject IP literals, credentials, ports and local names even though no URL fetch occurs.
export function validateProfile(raw?: string | null): string | null {
  if (!raw?.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid public HTTPS profile URL.");
  }
  if (
    raw.length > 2048 ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(u.hostname) ||
    /\.(localhost|local|internal|test|invalid|example|lan|home|arpa)$/i.test(u.hostname)
  ) {
    throw new Error("Enter a public HTTPS profile URL without credentials or a custom port.");
  }
  u.hash = "";
  return u.href;
}
export function estimateProtection(
  signals: { matched_pages: number; domains: number; official_profile_found: boolean },
  policy: PricingPolicy | null,
) {
  if (!signals.official_profile_found)
    return {
      pricing: null,
      reason: "Add an official profile so Eterna can resolve this identity.",
    };
  if (!policy?.enabled)
    return {
      pricing: null,
      reason: "Assessment requires Eterna review. Pricing policy is not active.",
    };
  const values = [
    policy.version,
    policy.minimum_pages,
    policy.minimum_domains,
    policy.base_annual,
    policy.annual_per_domain,
    policy.review_minutes_per_page_month,
    policy.hourly_review_rate,
    policy.range_margin,
  ];
  if (
    values.some((v) => !Number.isFinite(v) || v < 0) ||
    policy.range_margin > 0.5 ||
    policy.minimum_pages < 3 ||
    policy.minimum_domains < 2
  )
    throw new Error("Invalid pricing policy");
  if (signals.matched_pages < policy.minimum_pages || signals.domains < policy.minimum_domains)
    return {
      pricing: null,
      reason: "Not enough public data found. Assessment requires Eterna review.",
    };
  const annualReviewHours =
    (signals.matched_pages * policy.review_minutes_per_page_month * 12) / 60;
  const base =
    policy.base_annual +
    signals.domains * policy.annual_per_domain +
    annualReviewHours * policy.hourly_review_rate;
  if (!Number.isFinite(base) || base <= 0 || base > 1e10)
    throw new Error("Invalid protection estimate");
  return {
    pricing: {
      minimum: Math.floor(base * (1 - policy.range_margin)),
      maximum: Math.ceil(base * (1 + policy.range_margin)),
      currency: "INR" as const,
      period: "YEAR" as const,
      policy_version: policy.version,
    },
    reason: null,
  };
}
export function assertAgentAccess(
  userId: string | null,
  active: boolean,
  admin: boolean,
  owner?: string,
) {
  if (!userId) throw new Error("Unauthorized");
  if (!active && !admin) throw new Error("Agent access is not enabled for this account.");
  if (owner && owner !== userId && !admin) throw new Error("Assessment not found.");
}
