/**
 * Company (Client Type = COMPANY / enterprise) onboarding model.
 *
 * Pure functions only — no server or PDF imports — so the company flow,
 * authority derivation and protection-service mapping are unit testable and
 * shared by the wizard, server functions and authorization letter.
 *
 * Celebrity onboarding is untouched by anything in this file.
 */

export const COMPANY_RELATIONSHIPS = [
  "founder",
  "director",
  "employee",
  "legal_representative",
  "agency_representative",
  "other",
] as const;

export type CompanyRelationship = (typeof COMPANY_RELATIONSHIPS)[number];

export const COMPANY_RELATIONSHIP_LABELS: Record<CompanyRelationship, string> = {
  founder: "Founder",
  director: "Director",
  employee: "Employee",
  legal_representative: "Legal Representative",
  agency_representative: "Agency Representative",
  other: "Other",
};

export function isCompanyRelationship(value: unknown): value is CompanyRelationship {
  return (
    typeof value === "string" && (COMPANY_RELATIONSHIPS as readonly string[]).includes(value)
  );
}

/**
 * Optional company registration / formation documents that can support a
 * later company review but do not block the electronic signature.
 *
 * Uploading a registration document evidences the legal existence of the
 * company only — never that the uploader is authorized to represent it.
 */
export const COMPANY_REGISTRATION_DOC_TYPES = [
  "certificate_of_incorporation",
  "certificate_of_registration",
  "business_registration_certificate",
  "company_registry_extract",
  "other_government_formation_document",
] as const;

export type CompanyRegistrationDocType = (typeof COMPANY_REGISTRATION_DOC_TYPES)[number];

export const COMPANY_REGISTRATION_DOC_LABELS: Record<CompanyRegistrationDocType, string> = {
  certificate_of_incorporation: "Certificate of Incorporation",
  certificate_of_registration: "Certificate of Registration",
  business_registration_certificate: "Business Registration Certificate",
  company_registry_extract: "Company Registry Extract",
  other_government_formation_document: "Other government-issued formation document",
};

export const COMPANY_REGISTRATION_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
] as const;

/** Authority documents a company may upload as supporting evidence. */
export const COMPANY_AUTHORITY_DOC_TYPES = [
  "company_authorization_letter",
  "director_authorization",
  "business_registration_document",
  "other_authority_document",
] as const;

export type CompanyAuthorityDocType = (typeof COMPANY_AUTHORITY_DOC_TYPES)[number];

export const COMPANY_AUTHORITY_DOC_LABELS: Record<CompanyAuthorityDocType, string> = {
  company_authorization_letter: "Company authorization letter",
  director_authorization: "Director authorization",
  business_registration_document: "Business registration document",
  other_authority_document: "Other authority document",
};

export function isCompanyAuthorityDocType(value: unknown): value is CompanyAuthorityDocType {
  return (
    typeof value === "string" &&
    (COMPANY_AUTHORITY_DOC_TYPES as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------------ *
 * Company authority status
 * ------------------------------------------------------------------ */

export type CompanyAuthorityStatus =
  | "AUTHORITY_PENDING"
  | "COMPANY_VERIFIED"
  | "AUTHORIZED_REPRESENTATIVE";

export const COMPANY_AUTHORITY_LABELS: Record<CompanyAuthorityStatus, string> = {
  AUTHORITY_PENDING: "Authority Pending",
  COMPANY_VERIFIED: "Company Verified",
  AUTHORIZED_REPRESENTATIVE: "Authorized Representative",
};

export type CompanyAuthoritySignals = {
  businessEmailVerified: boolean;
  /** Work email domain matches the official company website domain. */
  workEmailMatchesCompanyDomain: boolean;
  registrationNumberProvided: boolean;
  /** Review outcome of the uploaded authority document, when one exists. */
  authorityDocumentStatus?: string | null;
};

/** Normalises a hostname from a URL or bare domain. Returns null when unusable. */
export function normalizeDomain(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const withoutScheme = raw.replace(/^[a-z]+:\/\//, "");
  const host = withoutScheme.split("/")[0].split("?")[0].split("@").pop() ?? "";
  const clean = host.replace(/^www\./, "").trim();
  if (!clean.includes(".")) return null;
  return clean;
}

/** Domain of an email address, or null when the address is unusable. */
export function emailDomain(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0) return null;
  return normalizeDomain(raw.slice(at + 1));
}

/** True when the email belongs to the company's official website domain. */
export function emailMatchesCompanyDomain(
  email: string | null | undefined,
  website: string | null | undefined,
): boolean {
  const domain = emailDomain(email);
  const site = normalizeDomain(website);
  if (!domain || !site) return false;
  return domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`);
}

/**
 * Derives the company authority status from real, persisted signals.
 *
 * Account-type selection alone can never produce authority: an approved
 * authority document, or a verified business email on the official company
 * domain plus registration details, is required.
 */
export function deriveCompanyAuthorityStatus(
  signals: CompanyAuthoritySignals,
): CompanyAuthorityStatus {
  const doc = (signals.authorityDocumentStatus ?? "").toUpperCase();
  if (doc === "APPROVED" || doc === "VERIFIED") return "AUTHORIZED_REPRESENTATIVE";

  if (
    signals.businessEmailVerified &&
    signals.workEmailMatchesCompanyDomain &&
    signals.registrationNumberProvided
  ) {
    return "AUTHORIZED_REPRESENTATIVE";
  }

  if (signals.businessEmailVerified) return "COMPANY_VERIFIED";
  return "AUTHORITY_PENDING";
}

/** Monitoring is always allowed while authority verification is pending. */
export function companyCanMonitor(_status: CompanyAuthorityStatus): boolean {
  return true;
}

/** Enforcement / takedown actions require established company authority. */
export function companyCanEnforce(status: CompanyAuthorityStatus): boolean {
  return status === "AUTHORIZED_REPRESENTATIVE";
}

export const COMPANY_ENFORCEMENT_BLOCKED_MESSAGE =
  "Monitoring is active. Takedown and enforcement actions unlock once company authority is established.";

/* ------------------------------------------------------------------ *
 * Protection services
 * ------------------------------------------------------------------ */

export type CompanyProtectionService = {
  key: string;
  label: string;
  /** Granular authorization scope keys granted when this service is selected. */
  scopeKeys: readonly string[];
  /** Only offered when an authorized person is enrolled in Face Protection. */
  requiresFaceEnrollment?: boolean;
};

export const COMPANY_PROTECTION_SERVICES: readonly CompanyProtectionService[] = [
  {
    key: "brand_reputation_monitoring",
    label: "Brand Reputation Monitoring",
    scopeKeys: ["monitor_public", "monitoring_reports"],
  },
  {
    key: "brand_impersonation",
    label: "Brand Impersonation",
    scopeKeys: ["prepare_impersonation", "monitor_public"],
  },
  {
    key: "fake_social_accounts",
    label: "Fake Social Accounts",
    scopeKeys: ["prepare_impersonation", "communicate_platforms"],
  },
  {
    key: "executive_impersonation",
    label: "Executive Impersonation",
    scopeKeys: ["prepare_impersonation"],
  },
  {
    key: "copyright_protection",
    label: "Copyright Protection",
    scopeKeys: ["prepare_copyright"],
  },
  {
    key: "campaign_protection",
    label: "Campaign Protection",
    scopeKeys: ["monitor_verified_assets"],
  },
  {
    key: "unauthorized_advertising",
    label: "Unauthorized Advertising",
    scopeKeys: ["monitor_verified_assets", "prepare_copyright"],
  },
  {
    key: "fake_endorsements",
    label: "Fake Endorsements",
    scopeKeys: ["prepare_impersonation", "monitor_verified_assets"],
  },
  {
    key: "domain_phishing_monitoring",
    label: "Domain / Phishing Monitoring",
    scopeKeys: ["monitor_public", "prepare_hosting"],
  },
  {
    key: "public_internet_monitoring",
    label: "Public Internet Monitoring",
    scopeKeys: ["monitor_public"],
  },
  {
    key: "evidence_collection",
    label: "Evidence Collection",
    scopeKeys: ["collect_evidence"],
  },
  {
    key: "face_deepfake_protection",
    label: "Face / Deepfake Protection",
    scopeKeys: ["detect_face_misuse"],
    requiresFaceEnrollment: true,
  },
];

/** Services offered to a company, honouring the face-enrollment condition. */
export function availableCompanyServices(faceEnrolled: boolean): CompanyProtectionService[] {
  return COMPANY_PROTECTION_SERVICES.filter(
    (service) => !service.requiresFaceEnrollment || faceEnrolled,
  );
}

export function isCompanyServiceKey(value: unknown): boolean {
  return (
    typeof value === "string" && COMPANY_PROTECTION_SERVICES.some((s) => s.key === value)
  );
}

/**
 * Maps selected company services onto the existing granular authorization
 * scope keys used by the authorization letter and enforcement gating.
 */
export function scopesForCompanyServices(
  selected: readonly string[],
  faceEnrolled: boolean,
): Record<string, boolean> {
  const allowed = new Set(availableCompanyServices(faceEnrolled).map((s) => s.key));
  const scopes: Record<string, boolean> = {};
  for (const service of COMPANY_PROTECTION_SERVICES) {
    if (!selected.includes(service.key) || !allowed.has(service.key)) continue;
    for (const key of service.scopeKeys) scopes[key] = true;
  }
  // Evidence-backed enforcement is always prepared under separate approval.
  if (Object.keys(scopes).length > 0) scopes["submit_final_after_approval"] = true;
  return scopes;
}

/* ------------------------------------------------------------------ *
 * Company flow
 * ------------------------------------------------------------------ */

export type CompanyStepKey =
  | "company_profile"
  | "company_representative"
  | "company_social"
  | "company_authority"
  | "company_signature"
  | "company_review"
  | "company_complete";

/**
 * Company (Client Type = COMPANY) onboarding.
 *
 * Work-email OTP verification is intentionally NOT part of this flow yet: the
 * work email is stored but never labelled verified. The OTP helpers and the
 * `company_email_verified_at` signal remain in place, so an
 * "company_email_otp" step can be inserted between representative details and
 * social profiles later without reshaping the rest of the flow.
 */
export const COMPANY_FLOW: readonly { step: number; key: CompanyStepKey; title: string }[] = [
  { step: 1, key: "company_profile", title: "Company Details" },
  { step: 2, key: "company_representative", title: "Representative Details" },
  { step: 3, key: "company_social", title: "Official Social Profiles" },
  { step: 4, key: "company_authority", title: "Registration & Authorization" },
  { step: 5, key: "company_signature", title: "Electronic Signature" },
  { step: 6, key: "company_review", title: "Review" },
  { step: 7, key: "company_complete", title: "Complete" },
];

export const COMPANY_AUTHORIZATION_TITLE =
  "Digital Brand, Reputation & Content Protection Authorization";
