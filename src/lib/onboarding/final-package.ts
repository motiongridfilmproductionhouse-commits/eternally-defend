/**
 * Pure content model for the FINAL onboarding downloads.
 *
 * Everything here is client-safe and deliberately free of biometric vectors,
 * AWS identifiers (collection ids, face ids), S3 locations, secrets or debug data.
 */

export type CertificateSnapshot = {
  profile?: {
    client_id?: string | null;
    legal_name?: string | null;
    display_name?: string | null;
    full_name?: string | null;
    company_name?: string | null;
    country?: string | null;
  } | null;
  face?: { status?: string | null } | null;
  assets?: Array<{
    kind?: string | null;
    name?: string | null;
    handle?: string | null;
    channel_url?: string | null;
    verification_status?: string | null;
    verified_at?: string | null;
  }> | null;
  signatures?: Array<{ status?: string | null; signed_at?: string | null }> | null;
};

export type ProtectionCertificateModel = {
  clientName: string;
  companyName: string | null;
  clientId: string;
  certificateNumber: string;
  authorizationId: string;
  authorizationStatus: string;
  signedStatus: "SIGNED" | "NOT SIGNED";
  signedDate: string | null;
  faceProtectionStatus: "ACTIVE" | "NOT ENROLLED";
  protectedFaceCount: number;
  effectiveDate: string | null;
  expiryDate: string | null;
  score: number;
  badge: string | null;
  verifyUrl: string | null;
};

const isoDay = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export function buildProtectionCertificateModel(input: {
  snapshot: CertificateSnapshot | null;
  certificate: {
    certificate_number: string;
    score: number;
    status: string;
    issued_at?: string | null;
    expires_at?: string | null;
    verification_badge?: string | null;
    public_slug?: string | null;
  };
  authorization: {
    auth_number: string;
    status: string;
    effective_date?: string | null;
    expiry_date?: string | null;
  };
  protectedFaceCount: number;
  publicBaseUrl?: string | null;
}): ProtectionCertificateModel {
  const p = input.snapshot?.profile ?? {};
  const signed = (input.snapshot?.signatures ?? []).find((s) => s?.status === "SIGNED");
  const faceEnrolled =
    input.snapshot?.face?.status === "FACE_VERIFIED" || input.protectedFaceCount > 0;

  return {
    clientName: p.legal_name || p.display_name || p.full_name || "—",
    companyName: p.company_name || null,
    clientId: p.client_id || "—",
    certificateNumber: input.certificate.certificate_number,
    authorizationId: input.authorization.auth_number,
    authorizationStatus: input.authorization.status,
    signedStatus: signed ? "SIGNED" : "NOT SIGNED",
    signedDate: signed ? isoDay(signed.signed_at) : null,
    faceProtectionStatus: faceEnrolled ? "ACTIVE" : "NOT ENROLLED",
    protectedFaceCount: input.protectedFaceCount,
    effectiveDate:
      isoDay(input.authorization.effective_date) ?? isoDay(input.certificate.issued_at),
    expiryDate: isoDay(input.authorization.expiry_date) ?? isoDay(input.certificate.expires_at),
    score: input.certificate.score,
    badge: input.certificate.verification_badge || null,
    verifyUrl:
      input.certificate.public_slug && input.publicBaseUrl
        ? `${input.publicBaseUrl.replace(/\/$/, "")}/verify/${input.certificate.public_slug}`
        : null,
  };
}

export function buildFaceProtectionSummary(input: {
  model: ProtectionCertificateModel;
  faces: Array<{ label?: string | null; status?: string | null; created_at?: string | null }>;
}): string {
  const lines: string[] = [
    "ETERNA SENTINEL DEFENCE LLC",
    "FACE PROTECTION SUMMARY",
    "",
    `Client: ${input.model.clientName}`,
    `Client ID: ${input.model.clientId}`,
    `Authorization ID: ${input.model.authorizationId}`,
    `Face Protection: ${input.model.faceProtectionStatus}`,
    `Protected face references: ${input.faces.length}`,
    "",
  ];
  input.faces.forEach((f, i) => {
    lines.push(
      `${i + 1}. Reference ${f.label ? `"${f.label}"` : "(primary)"} — status ${
        f.status ?? "ACTIVE"
      }${f.created_at ? `, enrolled ${isoDay(f.created_at)}` : ""}`,
    );
  });
  if (!input.faces.length) lines.push("No face reference has been enrolled for this account.");
  lines.push(
    "",
    "This summary records enrollment status only. No biometric templates, facial",
    "measurements, image locations or provider identifiers are included.",
  );
  return lines.join("\n");
}

export function buildDigitalAssetSummary(input: {
  model: ProtectionCertificateModel;
  assets: Array<{
    kind?: string | null;
    name?: string | null;
    handle?: string | null;
    channel_url?: string | null;
    verification_status?: string | null;
    verified_at?: string | null;
  }>;
}): string {
  const lines: string[] = [
    "ETERNA SENTINEL DEFENCE LLC",
    "DIGITAL ASSET SUMMARY",
    "",
    `Client: ${input.model.clientName}`,
    `Client ID: ${input.model.clientId}`,
    `Authorization ID: ${input.model.authorizationId}`,
    `Assets on record: ${input.assets.length}`,
    "",
  ];
  input.assets.forEach((a, i) => {
    const label = a.name || a.handle || a.channel_url || "(unnamed)";
    lines.push(
      `${i + 1}. [${(a.kind ?? "asset").toUpperCase()}] ${label} — ${
        a.verification_status ?? "PENDING"
      }${a.verified_at ? ` (verified ${isoDay(a.verified_at)})` : ""}`,
    );
    if (a.channel_url && a.channel_url !== label) lines.push(`   ${a.channel_url}`);
  });
  if (!input.assets.length) lines.push("No digital assets have been added for this account.");
  return lines.join("\n");
}

export const CERTIFICATE_FILENAME = (certificateNumber: string) =>
  `Eterna_Protection_Certificate_${certificateNumber}.pdf`;

export const BUNDLE_FILENAME = (certificateNumber: string) =>
  `Eterna_Protection_Bundle_${certificateNumber}.zip`;

/** Keys that must never reach a downloadable artifact. */
export const FORBIDDEN_EXPORT_TERMS = [
  "rekognition",
  "collection_id",
  "face_id",
  "s3_key",
  "s3_bucket",
  "bounding_box",
  "aws_",
  "secret",
  "api_key",
];

export function containsForbiddenExportData(text: string): boolean {
  // Normalize so snake_case, camelCase and spaced variants ("face_id", "faceId",
  // "face id") are all caught by a single term list.
  const normalized = text.toLowerCase().replace(/[\s_\-.]/g, "");
  return FORBIDDEN_EXPORT_TERMS.some((t) => normalized.includes(t.replace(/[\s_\-.]/g, "")));
}

