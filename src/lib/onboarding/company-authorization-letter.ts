/**
 * Eterna Sentinel company authorization letter.
 *
 * Pure module (no server / PDF imports) so the exact wording, version and
 * canonical hash input are unit-testable and shared by the PDF renderer, the
 * review screen and the electronic-signature record.
 *
 * Celebrity onboarding is untouched by anything in this file.
 */

export const COMPANY_LETTER_VERSION = "company-authorization-v1";

export const COMPANY_SERVICE_PROVIDER = "Eterna Sentinel";
export const COMPANY_SERVICE_PROVIDER_LEGAL = "Eterna Sentinel Defence LLC (Eterna AI)";

export const COMPANY_LETTER_TITLE = "Authorization to Monitor and Protect Digital Assets";

export type CompanyLetterInput = {
  company_name: string;
  registration_number?: string | null;
  website?: string | null;
  representative_name: string;
  representative_title?: string | null;
  representative_email?: string | null;
  /** ISO date string; the letter renders the calendar date. */
  date: string;
};

export type CompanyLetterField = { label: string; value: string };

export type CompanyLetterDocument = {
  version: string;
  title: string;
  provider: string;
  fields: CompanyLetterField[];
  paragraphs: string[];
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

export function buildCompanyAuthorizationLetter(
  input: CompanyLetterInput,
): CompanyLetterDocument {
  const company = clean(input.company_name) || "[COMPANY NAME]";
  const rep = clean(input.representative_name) || "[REPRESENTATIVE NAME]";
  const title = clean(input.representative_title);
  const email = clean(input.representative_email);
  const website = clean(input.website);
  const reg = clean(input.registration_number);
  const dateLabel = formatLetterDate(input.date);

  const fields: CompanyLetterField[] = [
    { label: "Company", value: company },
    ...(reg ? [{ label: "Registration number", value: reg }] : []),
    ...(website ? [{ label: "Website / domain", value: website }] : []),
    { label: "Representative", value: rep },
    ...(title ? [{ label: "Title / role", value: title }] : []),
    ...(email ? [{ label: "Work email", value: email }] : []),
    { label: "Date", value: dateLabel },
    { label: "Service provider", value: COMPANY_SERVICE_PROVIDER_LEGAL },
  ];

  const paragraphs = [
    `I, ${rep}${title ? `, ${title}` : ""}, acting on behalf of ${company}, authorize ${COMPANY_SERVICE_PROVIDER} to monitor publicly accessible online sources for potential impersonation, reputation threats, unauthorized use of company assets, fraudulent accounts, deepfake or manipulated media, copyright misuse, and related digital threats involving the company and the digital assets submitted to the platform.`,
    `This authorization permits monitoring and evidence collection within the protection scope selected in the ${COMPANY_SERVICE_PROVIDER} account. Enforcement, takedown, or third-party legal actions remain subject to the applicable authorization and review requirements.`,
    `The company confirms that the information submitted during onboarding is accurate and that the registration document provided evidences the legal existence of the company. Submission of documents and acceptance of this authorization establish submitted evidence and authorization assertions only; verified status is granted solely after review by ${COMPANY_SERVICE_PROVIDER}.`,
  ];

  const canonical = JSON.stringify({
    version: COMPANY_LETTER_VERSION,
    title: COMPANY_LETTER_TITLE,
    provider: COMPANY_SERVICE_PROVIDER_LEGAL,
    company,
    registration_number: reg || null,
    website: website || null,
    representative: rep,
    representative_title: title || null,
    representative_email: email || null,
    date: dateLabel,
    paragraphs,
  });

  return {
    version: COMPANY_LETTER_VERSION,
    title: COMPANY_LETTER_TITLE,
    provider: COMPANY_SERVICE_PROVIDER_LEGAL,
    fields,
    paragraphs,
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
    enforcement: input.authorityApproved
      ? "Available"
      : "Locked until authorization is approved",
  };
}
