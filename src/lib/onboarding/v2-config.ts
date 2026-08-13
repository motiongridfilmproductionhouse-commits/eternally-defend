import { COMPANY_FLOW } from "./company-config";

export const ONBOARDING_V2 = "v2";


export const V2_ACCOUNT_TYPES = [
  "celebrity",
  "individual",
  "enterprise",
  "production_house",
  "manager_agent",
  "pr_team",
  "legal_representative",
] as const;

export type V2AccountType = (typeof V2_ACCOUNT_TYPES)[number];

/**
 * Friction-light routes: these accounts complete setup with public profile
 * details only. No identity document is requested during initial onboarding;
 * verification is requested later, when a sensitive action is attempted.
 */
export const V2_LIGHT_ACCOUNT_TYPES = [
  "celebrity",
  "manager_agent",
  "pr_team",
  "legal_representative",
] as const;

export function isLightVerificationAccount(accountType: V2AccountType | null): boolean {
  return (
    !!accountType && (V2_LIGHT_ACCOUNT_TYPES as readonly string[]).includes(accountType)
  );
}

/** Representative routes act on behalf of a public figure. */
export function isRepresentativeAccount(accountType: V2AccountType | null): boolean {
  return (
    accountType === "manager_agent" ||
    accountType === "pr_team" ||
    accountType === "legal_representative"
  );
}

export const V2_ACCOUNT_LABELS: Record<V2AccountType, string> = {
  celebrity: "Celebrity / Public Figure",
  individual: "Individual",
  enterprise: "Brand / Organization",
  production_house: "Production House",
  manager_agent: "Manager / Agent",
  pr_team: "PR / Reputation Team",
  legal_representative: "Legal Representative",
};

export const V2_BADGES: Record<V2AccountType, string> = {
  celebrity: "Verified Celebrity",
  individual: "Verified Individual",
  enterprise: "Verified Enterprise",
  production_house: "Verified Production House",
  manager_agent: "Verified Representative",
  pr_team: "Verified Representative",
  legal_representative: "Verified Legal Representative",
};

/** Alternate badge labels accepted for display/certificate copy. */
export const V2_BADGE_ALTERNATES: Record<V2AccountType, readonly string[]> = {
  celebrity: ["Verified Celebrity", "Verified Public Figure"],
  individual: ["Verified Individual"],
  enterprise: ["Verified Enterprise", "Verified Organization"],
  production_house: ["Verified Production House", "Verified Rights Holder"],
  manager_agent: ["Verified Representative", "Verified Manager"],
  pr_team: ["Verified Representative", "Verified PR Team"],
  legal_representative: ["Verified Legal Representative", "Verified Representative"],
};

export const V2_VERIFICATION_METHODS: Record<V2AccountType, string> = {
  celebrity: "public_identity_and_asset_review",
  individual: "veriff_identity_and_face_liveness",
  enterprise: "company_document_review",
  production_house: "production_rights_review",
  manager_agent: "representative_authorization_review",
  pr_team: "representative_authorization_review",
  legal_representative: "legal_representative_authorization_review",
};

export const V2_EVIDENCE_TYPES = [
  "official_contact",
  "representative",
  "company",
  "rights",
  "authorization",
] as const;

export type V2EvidenceType = (typeof V2_EVIDENCE_TYPES)[number];

export function isV2AccountType(value: unknown): value is V2AccountType {
  return typeof value === "string" && (V2_ACCOUNT_TYPES as readonly string[]).includes(value);
}

export function isV2EvidenceType(value: unknown): value is V2EvidenceType {
  return typeof value === "string" && (V2_EVIDENCE_TYPES as readonly string[]).includes(value);
}

export function clientTypeForV2(accountType: V2AccountType) {
  if (accountType === "celebrity") return "celebrity" as const;
  if (accountType === "individual") return "individual" as const;
  if (accountType === "production_house") return "agency" as const;
  if (isRepresentativeAccount(accountType)) return "agency" as const;
  return "corporate" as const;
}

export function legacyAccountTypeForV2(accountType: V2AccountType) {
  return accountType === "individual" || accountType === "celebrity"
    ? ("personal" as const)
    : ("business" as const);
}

export type V2StepKey =
  | "account_type"
  | "profile"
  | "veriff"
  | "evidence"
  | "representative"
  | "face"
  | "assets"
  | "scope"
  | "review"
  | "signature"
  | "certificate"
  | "complete"
  // Company (enterprise) route steps
  | "company_profile"
  | "company_representative"
  | "company_authority"
  | "company_assets"
  | "company_campaigns"
  | "company_services";


export type V2FlowStep = {
  step: number;
  key: V2StepKey;
  title: string;
};

export function v2FlowForAccount(accountType: V2AccountType | null): V2FlowStep[] {
  if (!accountType) {
    return [{ step: 1, key: "account_type", title: "Account Type" }];
  }

  // Friction-light routes: public profile only, no identity document at signup.
  if (isLightVerificationAccount(accountType)) {
    return [
      { step: 1, key: "account_type", title: "Account Type" },
      {
        step: 2,
        key: "profile",
        title: accountType === "celebrity" ? "Public Profile" : "Workspace Profile",
      },
      { step: 3, key: "complete", title: "Start Monitoring" },
    ];
  }

  if (accountType === "individual") {
    return [
      { step: 1, key: "account_type", title: "Account Type" },
      { step: 2, key: "profile", title: "Personal Profile" },
      { step: 3, key: "veriff", title: "Veriff" },
      { step: 4, key: "face", title: "Face Protection" },
      { step: 5, key: "assets", title: "Digital Assets" },
      { step: 6, key: "scope", title: "Authorization Scope" },
      { step: 7, key: "review", title: "Authorization Review" },
      { step: 8, key: "signature", title: "Electronic Signature" },
      { step: 9, key: "certificate", title: "Certificate" },
      { step: 10, key: "complete", title: "Complete" },
    ];
  }

  // Client Type = COMPANY: dedicated 9-step company flow after account selection.
  if (accountType === "enterprise") {
    return [
      { step: 1, key: "account_type", title: "Account Type" },
      ...COMPANY_FLOW.map((item) => ({
        step: item.step + 1,
        key: item.key as V2StepKey,
        title: item.title,
      })),
    ];
  }


  return [
    { step: 1, key: "account_type", title: "Account Type" },
    { step: 2, key: "profile", title: "Production House Profile" },
    { step: 3, key: "representative", title: "Representative Details" },
    { step: 4, key: "evidence", title: "Rights Evidence" },
    { step: 5, key: "assets", title: "Film / Media Assets" },
    { step: 6, key: "scope", title: "Authorization Scope" },
    { step: 7, key: "review", title: "Authorization Review" },
    { step: 8, key: "signature", title: "Electronic Signature" },
    { step: 9, key: "certificate", title: "Certificate" },
    { step: 10, key: "complete", title: "Complete" },
  ];
}

export function primaryEvidenceTypeForAccount(
  accountType: V2AccountType,
): Exclude<V2EvidenceType, "representative" | "authorization"> | null {
  // Light routes submit no onboarding evidence; verification happens later.
  if (isLightVerificationAccount(accountType)) return null;
  if (accountType === "enterprise") return "company";
  if (accountType === "production_house") return "rights";
  return null;
}

export function requiresVeriff(accountType: V2AccountType): boolean {
  return accountType === "individual";
}

export function requiresFaceProtection(accountType: V2AccountType): boolean {
  return accountType === "individual";
}

export function requiresRepresentative(accountType: V2AccountType): boolean {
  return accountType === "enterprise" || accountType === "production_house";
}
