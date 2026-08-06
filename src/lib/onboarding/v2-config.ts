export const ONBOARDING_V2 = "v2";

export const V2_ACCOUNT_TYPES = [
  "celebrity",
  "individual",
  "enterprise",
  "production_house",
] as const;

export type V2AccountType = (typeof V2_ACCOUNT_TYPES)[number];

export const V2_ACCOUNT_LABELS: Record<V2AccountType, string> = {
  celebrity: "Celebrity / Public Figure",
  individual: "Individual",
  enterprise: "Enterprise",
  production_house: "Production House",
};

export const V2_BADGES: Record<V2AccountType, string> = {
  celebrity: "Verified Celebrity",
  individual: "Verified Individual",
  enterprise: "Verified Enterprise",
  production_house: "Verified Production House",
};

export const V2_VERIFICATION_METHODS: Record<V2AccountType, string> = {
  celebrity: "public_identity_and_asset_review",
  individual: "veriff_identity_and_face_liveness",
  enterprise: "company_document_review",
  production_house: "production_rights_review",
};

export function isV2AccountType(value: unknown): value is V2AccountType {
  return typeof value === "string" && V2_ACCOUNT_TYPES.includes(value as V2AccountType);
}

export function clientTypeForV2(accountType: V2AccountType) {
  if (accountType === "celebrity") return "celebrity" as const;
  if (accountType === "individual") return "individual" as const;
  if (accountType === "production_house") return "agency" as const;
  return "corporate" as const;
}

export function legacyAccountTypeForV2(accountType: V2AccountType) {
  return accountType === "individual" || accountType === "celebrity"
    ? "personal" as const
    : "business" as const;
}