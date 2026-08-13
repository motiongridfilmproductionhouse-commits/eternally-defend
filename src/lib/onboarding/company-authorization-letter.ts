/**
 * Eterna Sentinel company authorization package (multi-page).
 *
 * Pure module (no server / PDF imports) so the exact wording, version, section
 * structure and canonical hash input are shared by the PDF renderer, the review
 * screen and the electronic-signature record.
 *
 * Nothing here is customer-specific: every value is passed in from the
 * authenticated company's onboarding record. Celebrity onboarding is untouched.
 */

export const COMPANY_LETTER_VERSION = "company-authorization-v2";

export const COMPANY_SERVICE_PROVIDER = "Eterna Sentinel";
export const COMPANY_SERVICE_PROVIDER_LEGAL = "Eterna Sentinel Defence LLC (Eterna AI)";

export const COMPANY_LETTER_TITLE = "Authorization to Monitor and Protect Digital Assets";
export const COMPANY_LETTER_CONFIDENTIALITY =
  "Confidential — prepared for the named company. Contains authorization and protection-scope terms.";

export const COMPANY_SIGNATURE_DECLARATION =
  "I confirm that I am authorized to act on behalf of the company identified in this authorization and that I have reviewed and accept the monitoring authorization and protection scope described in this document.";

/** Provenance of an asset listed in the authorization. */
export type CompanyAssetTrust = "Customer Submitted" | "Customer Confirmed" | "Eterna Verified";

export type CompanyAssetEntry = {
  category: string;
  value: string;
  trust: CompanyAssetTrust;
};

export type CompanyLetterInput = {
  company_name: string;
  brand_name?: string | null;
  registration_number?: string | null;
  country?: string | null;
  website?: string | null;
  representative_name: string;
  representative_title?: string | null;
  representative_email?: string | null;
  /** Stable, non-database authorization reference shown on every page. */
  reference_id: string;
  /** Protection services selected by the customer (human labels). */
  services?: string[];
  /** Assets covered, already classified by provenance. */
  assets?: CompanyAssetEntry[];
  /** ISO date string; the letter renders the calendar date. */
  date: string;
};

export type CompanyLetterField = { label: string; value: string };

export type CompanyLetterBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "fields"; fields: CompanyLetterField[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "callout"; text: string }
  | { kind: "subheading"; text: string };

export type CompanyLetterSection = {
  /** 1-based page number in the generated package. */
  page: number;
  title: string;
  blocks: CompanyLetterBlock[];
};

export type CompanyLetterDocument = {
  version: string;
  title: string;
  provider: string;
  reference_id: string;
  generated_date: string;
  confidentiality: string;
  /** Page-1 summary fields, also used by the on-screen review panel. */
  fields: CompanyLetterField[];
  /** Short summary paragraphs for the on-screen review panel. */
  paragraphs: string[];
  sections: CompanyLetterSection[];
  /** Deterministic string hashed to freeze the exact accepted document. */
  canonical: string;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function formatLetterDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function buildCompanyAuthorizationLetter(input: CompanyLetterInput): CompanyLetterDocument {
  const company = clean(input.company_name) || "[COMPANY NAME]";
  const brand = clean(input.brand_name);
  const rep = clean(input.representative_name) || "[REPRESENTATIVE NAME]";
  const title = clean(input.representative_title);
  const email = clean(input.representative_email);
  const website = clean(input.website);
  const country = clean(input.country);
  const reg = clean(input.registration_number);
  const reference = clean(input.reference_id) || "PENDING";
  const dateLabel = formatLetterDate(input.date);
  const services = (input.services ?? []).filter((item) => clean(item).length > 0);
  const assets = input.assets ?? [];

  const fields: CompanyLetterField[] = [
    { label: "Legal company name", value: company },
    ...(brand && brand.toLowerCase() !== company.toLowerCase()
      ? [{ label: "Trading / brand name", value: brand }]
      : []),
    ...(reg ? [{ label: "Registration number", value: reg }] : []),
    ...(country ? [{ label: "Country / jurisdiction", value: country }] : []),
    ...(website ? [{ label: "Official website", value: website }] : []),
    { label: "Representative", value: rep },
    ...(title ? [{ label: "Title / role", value: title }] : []),
    ...(email ? [{ label: "Work email", value: email }] : []),
    { label: "Date", value: dateLabel },
    { label: "Authorization reference", value: reference },
    { label: "Document version", value: COMPANY_LETTER_VERSION },
    { label: "Service provider", value: COMPANY_SERVICE_PROVIDER_LEGAL },
  ];

  const paragraphs = [
    `${rep}${title ? `, ${title},` : ","} acting for ${company}, declares that they are authorized to submit the company and its digital assets to ${COMPANY_SERVICE_PROVIDER} for monitoring and protection.`,
    `This package authorizes monitoring of publicly accessible sources and the preservation of evidence within the protection scope selected by the company. Enforcement actions, platform reports and legal escalations remain subject to separate approval.`,
    `Submission of documents and acceptance of this authorization establish submitted evidence and authorization assertions only. ${COMPANY_SERVICE_PROVIDER} has not independently verified the representative's authority at the time this document is generated; that review runs separately.`,
  ];

  const sections: CompanyLetterSection[] = [
    {
      page: 1,
      title: "Company & Representative Authorization",
      blocks: [
        { kind: "fields", fields },
        { kind: "subheading", text: "Declaration of authority" },
        { kind: "paragraph", text: paragraphs[0]! },
        {
          kind: "paragraph",
          text: `The representative confirms that the details above describe the company on whose behalf this authorization is submitted, and that they are entitled to submit the company's digital assets for protection.`,
        },
        {
          kind: "callout",
          text: `${COMPANY_SERVICE_PROVIDER} has not independently verified this authority at the time of generation. Company-authority review is a separate process and its outcome is recorded in the company's workspace.`,
        },
        { kind: "paragraph", text: paragraphs[1]! },
      ],
    },
    {
      page: 2,
      title: "Authorized Digital Assets and Identifiers",
      blocks: [
        {
          kind: "paragraph",
          text: "The following assets and identifiers are covered by this authorization. Provenance is recorded for every entry so that customer-supplied information is never presented as independently verified.",
        },
        {
          kind: "table",
          columns: ["Category", "Asset / identifier", "Provenance"],
          rows:
            assets.length > 0
              ? assets.map((asset) => [asset.category, asset.value, asset.trust])
              : [["Company name", company, "Customer Submitted"]],
        },
        { kind: "subheading", text: "Provenance definitions" },
        {
          kind: "bullets",
          items: [
            "Customer Submitted — provided by the company during onboarding; not independently checked.",
            "Customer Confirmed — explicitly confirmed by the company as an official asset or profile it owns or controls.",
            `Eterna Verified — confirmed through a completed ${COMPANY_SERVICE_PROVIDER} verification process.`,
          ],
        },
        {
          kind: "callout",
          text: "An account or asset discovered through public web or search discovery is never automatically treated as Eterna Verified. Discovery output is a candidate signal until the company confirms it and, where applicable, verification completes.",
        },
        {
          kind: "paragraph",
          text: "Additional assets, brands, domains, official profiles, campaigns and copyright-protected works may be added later through the company workspace and are covered by this authorization once submitted or confirmed.",
        },
      ],
    },
    {
      page: 3,
      title: "Monitoring Authorization Scope",
      blocks: [
        {
          kind: "paragraph",
          text: `${company} authorizes ${COMPANY_SERVICE_PROVIDER} to monitor publicly accessible online sources for the following categories of digital risk affecting the assets listed in this authorization.`,
        },
        {
          kind: "bullets",
          items: [
            "Company or brand impersonation",
            "Fake, cloned or misleading social accounts",
            "Reputation threats and coordinated defamatory activity",
            "Fraudulent representations of the company, its staff or its offerings",
            "Unauthorized use of brand names, logos and creative assets",
            "Fake endorsements and false affiliation claims",
            "Unauthorized advertisements using company assets",
            "Deepfake or manipulated media associated with protected assets",
            "Copyright misuse of submitted protected works",
            "Unauthorized distribution and re-uploads",
            "Phishing and look-alike surfaces, where supported by the platform",
            "Campaign misuse and unauthorized campaign derivatives",
            "Other digital threats covered by the protection services selected by the company",
          ],
        },
        ...(services.length > 0
          ? ([
              { kind: "subheading", text: "Protection services selected by the company" },
              { kind: "bullets", items: services },
            ] as CompanyLetterBlock[])
          : []),
        { kind: "subheading", text: "How monitoring is performed" },
        {
          kind: "paragraph",
          text: "Monitoring may include automated discovery across public sources, content classification, similarity analysis, risk scoring, evidence correlation across findings, and human review of prioritized cases.",
        },
        {
          kind: "callout",
          text: "Automated output is a signal or finding, not a legal conclusion. A finding does not by itself establish infringement, impersonation, fraud or any other unlawful conduct.",
        },
      ],
    },
    {
      page: 4,
      title: "Evidence Collection & Preservation",
      blocks: [
        {
          kind: "paragraph",
          text: `${company} authorizes ${COMPANY_SERVICE_PROVIDER} to preserve evidence reasonably necessary to document detected incidents affecting the authorized assets.`,
        },
        { kind: "subheading", text: "Evidence that may be preserved" },
        {
          kind: "bullets",
          items: [
            "Publicly accessible URLs and source locations",
            "Public account or profile information as displayed publicly",
            "Screenshots of publicly visible pages",
            "Thumbnails and preview imagery of detected media",
            "Publication and last-seen timestamps",
            "Platform or source identification",
            "Publicly displayed engagement or reach information",
            "Classification results and associated confidence indicators",
            "Detection timestamps and case history",
            "Relevant technical metadata describing the public source",
            "Copies or snapshots of publicly accessible evidence where legally and technically permitted",
          ],
        },
        {
          kind: "paragraph",
          text: "Evidence is handled through the platform's existing Evidence Vault, following its retention schedule, access-control model and privacy architecture. Access is limited to the company's authorized workspace users and personnel supporting the company's protection services.",
        },
        {
          kind: "callout",
          text: "This authorization does not permit bypassing authentication, accessing private accounts or private messages, purchasing restricted content, or circumventing technical access controls or platform protections.",
        },
      ],
    },
    {
      page: 5,
      title: "Enforcement & Takedown Authority",
      blocks: [
        { kind: "subheading", text: "Monitoring Authorization" },
        {
          kind: "paragraph",
          text: "Monitoring and evidence collection may begin once the onboarding requirements for monitoring are satisfied. This part of the authorization is operational and does not create legal representation.",
        },
        { kind: "subheading", text: "Enforcement Authorization" },
        {
          kind: "paragraph",
          text: `Enforcement is authorized separately. Takedown requests, platform reports, copyright notices, cease-and-desist workflows, hosting or registrar escalations and similar actions follow the applicable ${COMPANY_SERVICE_PROVIDER} workflow and its authorization requirements.`,
        },
        {
          kind: "bullets",
          items: [
            "Customer Approval Required — submitting takedown or platform reports naming the company",
            "Customer Approval Required — copyright or trademark notices sent on the company's behalf",
            "Customer Approval Required — cease-and-desist or legal-escalation workflows",
            "Customer Approval Required — communications that assert the company's legal position to a third party",
          ],
        },
        {
          kind: "callout",
          text: `This document does not grant ${COMPANY_SERVICE_PROVIDER} unrestricted authority to initiate litigation, make legal admissions, settle disputes, impersonate the company, or take other legally binding actions on the company's behalf.`,
        },
        {
          kind: "paragraph",
          text: "Where the company enables assisted or automated enforcement workflows in its workspace, those actions remain bound by the approval requirements configured for the company and by the applicable platform policies.",
        },
      ],
    },
    {
      page: 6,
      title: "Representations, Limitations & Consent",
      blocks: [
        { kind: "subheading", text: "Company representations" },
        {
          kind: "bullets",
          items: [
            "The company information submitted during onboarding is accurate to the best of the representative's knowledge.",
            "The representative has authority to submit the identified assets for protection.",
            "The company will not knowingly submit assets belonging to unrelated third parties as its own.",
            "Official profiles and assets confirmed by the company are represented as belonging to, or being authorized by, the company.",
            `The company will update ${COMPANY_SERVICE_PROVIDER} if the representative's authority materially changes.`,
          ],
        },
        { kind: "subheading", text: "Limitations" },
        {
          kind: "bullets",
          items: [
            `${COMPANY_SERVICE_PROVIDER} does not guarantee detection of every threat or every instance of misuse.`,
            "A detected signal is not automatically proof of unlawful conduct.",
            "Similarity alone must not be represented as proof of impersonation, deepfake creation or wrongdoing.",
            "Findings can require further review, additional context or legal assessment before action is appropriate.",
            "Outcomes of platform reports and third-party decisions are controlled by those platforms, not by the service provider.",
          ],
        },
        {
          kind: "paragraph",
          text: "The company consents to the processing described in this authorization for the purpose of protecting the authorized assets, in line with the platform's privacy and retention architecture.",
        },
      ],
    },
    {
      page: 7,
      title: "Electronic Signature & Audit Record",
      blocks: [
        { kind: "subheading", text: "Declaration" },
        { kind: "paragraph", text: COMPANY_SIGNATURE_DECLARATION },
        {
          kind: "paragraph",
          text: "The signature record below freezes the exact document version accepted, together with the acceptance timestamp and document hash, so the accepted document can be reproduced later.",
        },
      ],
    },
  ];

  const canonical = JSON.stringify({
    version: COMPANY_LETTER_VERSION,
    title: COMPANY_LETTER_TITLE,
    provider: COMPANY_SERVICE_PROVIDER_LEGAL,
    reference_id: reference,
    company,
    brand: brand || null,
    registration_number: reg || null,
    country: country || null,
    website: website || null,
    representative: rep,
    representative_title: title || null,
    representative_email: email || null,
    date: dateLabel,
    services,
    assets,
    sections,
  });

  return {
    version: COMPANY_LETTER_VERSION,
    title: COMPANY_LETTER_TITLE,
    provider: COMPANY_SERVICE_PROVIDER_LEGAL,
    reference_id: reference,
    generated_date: dateLabel,
    confidentiality: COMPANY_LETTER_CONFIDENTIALITY,
    fields,
    paragraphs,
    sections,
    canonical,
  };
}

/* ------------------------------------------------------------------ *
 * Verification status summary shown after submission
 * ------------------------------------------------------------------ */

export type CompanySubmissionStatus = {
  registrationProof: "Submitted" | "Missing";
  authorizationLetter: "Signed" | "Not signed";
  companyAuthority: "Pending review" | "Approved";
  monitoring: "Active";
  enforcement: "Locked until authorization is approved" | "Available";
};

export function companySubmissionStatus(input: {
  registrationProofSubmitted: boolean;
  letterSigned: boolean;
  authorityApproved: boolean;
}): CompanySubmissionStatus {
  return {
    registrationProof: input.registrationProofSubmitted ? "Submitted" : "Missing",
    authorizationLetter: input.letterSigned ? "Signed" : "Not signed",
    companyAuthority: input.authorityApproved ? "Approved" : "Pending review",
    monitoring: "Active",
    enforcement: input.authorityApproved ? "Available" : "Locked until authorization is approved",
  };
}
