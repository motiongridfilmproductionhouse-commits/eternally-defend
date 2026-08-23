/**
 * Read-only access to the user's OWN signed authorization contract.
 *
 * This reuses the existing onboarding signing artifacts:
 *   - authorization_signatures  (status = 'SIGNED', typed-name electronic signature)
 *   - authorization_documents   (kind = 'signed' letter, kind = 'signature_certificate')
 *   - S3 / authorization-vault storage written at signing time
 *
 * Nothing here creates a second signing system: if the stored PDFs exist we
 * simply return them (letter + signature certificate merged into one file).
 * Only when a stored artifact is missing do we re-render it from the frozen
 * snapshot + audit row so the user is never left without their contract.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export type SignedAuthorizationSummary = {
  available: boolean;
  typed_name: string | null;
  signature_method: string | null;
  signed_at: string | null;
  agreement_version: number | null;
  auth_number: string | null;
  authorization_status: string | null;
  signer_email: string | null;
  client_id: string | null;
  document_sha256: string | null;
  has_stored_document: boolean;
};

type SignatureRow = {
  id: string;
  authorization_id: string;
  user_id: string;
  version: number;
  typed_name: string | null;
  role_title: string | null;
  signature_method: string | null;
  signed_at: string | null;
  signer_email: string | null;
  client_id: string | null;
  auth_number: string | null;
  document_sha256: string | null;
  signature_sha256: string | null;
  consent_accepted: boolean | null;
  consent_text: string | null;
  ip_address: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  device_metadata: any;
};

const SIG_COLUMNS =
  "id,authorization_id,user_id,version,typed_name,role_title,signature_method,signed_at," +
  "signer_email,client_id,auth_number,document_sha256,signature_sha256,consent_accepted," +
  "consent_text,ip_address,device_metadata";

/**
 * Latest SIGNED signature for this user. Every query is filtered by user_id, so
 * a caller can never reach another account's signature by passing an id.
 */
async function loadLatestSignature(
  supabase: AnyClient,
  userId: string,
): Promise<SignatureRow | null> {
  const { data } = await supabase
    .from("authorization_signatures")
    .select(SIG_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "SIGNED")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SignatureRow | null) ?? null;
}

async function loadDocs(
  supabase: AnyClient,
  userId: string,
  authorizationId: string,
  version: number,
) {
  const { data } = await supabase
    .from("authorization_documents")
    .select("id,kind,s3_key,version,created_at")
    .eq("user_id", userId)
    .eq("authorization_id", authorizationId)
    .in("kind", ["signed", "signature_certificate"])
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Array<{
    id: string;
    kind: string;
    s3_key: string;
    version: number | null;
    created_at: string;
  }>;
  const pick = (kind: string) =>
    rows.find((r) => r.kind === kind && (r.version ?? version) === version) ??
    rows.find((r) => r.kind === kind) ??
    null;
  return { signed: pick("signed"), signatureCertificate: pick("signature_certificate") };
}

export async function getSignedAuthorizationSummary(
  supabase: AnyClient,
  userId: string,
): Promise<SignedAuthorizationSummary> {
  const sig = await loadLatestSignature(supabase, userId);
  if (!sig) {
    return {
      available: false,
      typed_name: null,
      signature_method: null,
      signed_at: null,
      agreement_version: null,
      auth_number: null,
      authorization_status: null,
      signer_email: null,
      client_id: null,
      document_sha256: null,
      has_stored_document: false,
    };
  }

  const { data: auth } = await supabase
    .from("client_authorizations")
    .select("auth_number,status")
    .eq("id", sig.authorization_id)
    .eq("user_id", userId)
    .maybeSingle();

  const docs = await loadDocs(supabase, userId, sig.authorization_id, sig.version);

  return {
    available: true,
    typed_name: sig.typed_name ?? null,
    signature_method: sig.signature_method ?? "typed-name electronic signature",
    signed_at: sig.signed_at ?? null,
    agreement_version: sig.version ?? null,
    auth_number: sig.auth_number ?? auth?.auth_number ?? null,
    authorization_status: auth?.status ?? null,
    signer_email: sig.signer_email ?? null,
    client_id: sig.client_id ?? null,
    document_sha256: sig.document_sha256 ?? null,
    has_stored_document: !!docs.signed,
  };
}

/** Re-renders the signed letter from the frozen snapshot when storage lost it. */
async function renderLetterFromSnapshot(
  supabase: AnyClient,
  userId: string,
  sig: SignatureRow,
): Promise<Uint8Array | null> {
  const { data: version } = await supabase
    .from("authorization_versions")
    .select("snapshot")
    .eq("user_id", userId)
    .eq("authorization_id", sig.authorization_id)
    .eq("version", sig.version)
    .maybeSingle();
  let snapshot = version?.snapshot ?? null;
  if (!snapshot) {
    const { data: auth } = await supabase
      .from("client_authorizations")
      .select("snapshot")
      .eq("id", sig.authorization_id)
      .eq("user_id", userId)
      .maybeSingle();
    snapshot = auth?.snapshot ?? null;
  }
  if (!snapshot) return null;
  const { renderAuthorizationLetterPdf } = await import(
    "@/lib/onboarding/authorization-letter-pdf.server"
  );
  return await renderAuthorizationLetterPdf(snapshot, {
    signed: true,
    signerName: sig.typed_name ?? undefined,
    signedAt: sig.signed_at ?? undefined,
  });
}

async function renderSignatureCertificate(sig: SignatureRow): Promise<Uint8Array | null> {
  if (!sig.typed_name || !sig.signed_at) return null;
  const { renderSignatureCertificatePdf } = await import(
    "@/lib/onboarding/signature-certificate.server"
  );
  return await renderSignatureCertificatePdf({
    legal_name: sig.typed_name,
    signer_email: sig.signer_email ?? null,
    email_verified: !!sig.signer_email,
    client_id: sig.client_id ?? null,
    user_id: sig.user_id,
    auth_number: sig.auth_number ?? "",
    authorization_id: sig.authorization_id,
    document_version: sig.version,
    signed_at_utc: sig.signed_at,
    signature_method: sig.signature_method ?? "typed-name electronic signature",
    consent_accepted: sig.consent_accepted ?? true,
    consent_text: sig.consent_text ?? "",
    document_sha256: sig.document_sha256 ?? "",
    signature_sha256: sig.signature_sha256 ?? "",
    ip_address: sig.ip_address ?? null,
    device_metadata: (sig.device_metadata as Record<string, string | null> | null) ?? null,
  });
}

export type SignedAuthorizationDownload = {
  filename: string;
  base64: string;
  regenerated: boolean;
};

/**
 * Returns the completed, electronically signed contract for the caller only.
 * Prefers stored artifacts; merges the signature certificate (typed name,
 * method, timestamp, version, audit hashes) onto the signed letter.
 */
export async function buildSignedAuthorizationDownload(
  supabase: AnyClient,
  userId: string,
): Promise<SignedAuthorizationDownload> {
  const sig = await loadLatestSignature(supabase, userId);
  if (!sig) throw new Error("NO_SIGNED_AUTHORIZATION");

  const docs = await loadDocs(supabase, userId, sig.authorization_id, sig.version);
  const { readOnboardingDocumentBytes } = await import(
    "@/lib/onboarding/document-storage.server"
  );

  let regenerated = false;
  let letter = docs.signed
    ? await readOnboardingDocumentBytes({ supabase, storagePath: docs.signed.s3_key })
    : null;
  if (!letter) {
    letter = await renderLetterFromSnapshot(supabase, userId, sig);
    regenerated = true;
  }
  if (!letter) throw new Error("DOCUMENT_UNAVAILABLE");

  let certificate = docs.signatureCertificate
    ? await readOnboardingDocumentBytes({
        supabase,
        storagePath: docs.signatureCertificate.s3_key,
      })
    : null;
  if (!certificate) {
    certificate = await renderSignatureCertificate(sig);
    if (certificate) regenerated = true;
  }

  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const part of [letter, certificate]) {
    if (!part) continue;
    try {
      const src = await PDFDocument.load(part);
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    } catch (error) {
      console.error("[signed-authorization] unreadable PDF part:", error);
    }
  }
  if (out.getPageCount() === 0) throw new Error("DOCUMENT_UNAVAILABLE");

  out.setTitle(`Eterna Signed Authorization ${sig.auth_number ?? ""}`.trim());
  out.setSubject("Electronically signed authorization agreement");
  const bytes = await out.save();

  const stamp = (sig.signed_at ?? new Date().toISOString()).slice(0, 10);
  const filename = `Eterna_Signed_Authorization_${sig.auth_number ?? "agreement"}_v${sig.version}_${stamp}.pdf`;
  return { filename, base64: Buffer.from(bytes).toString("base64"), regenerated };
}
