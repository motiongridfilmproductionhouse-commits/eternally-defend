import { createServerFn } from "@tanstack/react-start";
import { createHash } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CompanyAuthorizationSignatureSchema,
  CompanyRegistrationProofSchema,
} from "./company-schemas";
import {
  COMPANY_REGISTRATION_DOC_LABELS,
  deriveCompanyAuthorityStatus,
  emailMatchesCompanyDomain,
  type CompanyAuthorityStatus,
} from "./company-config";
import {
  buildCompanyAuthorizationLetter,
  companySubmissionStatus,
  COMPANY_LETTER_VERSION,
  type CompanyLetterInput,
} from "./company-authorization-letter";

type CompanyContext = {
  companyName: string;
  registrationNumber: string | null;
  website: string | null;
  companyEmail: string | null;
  representativeName: string;
  representativeTitle: string | null;
  representativeEmail: string | null;
  emailVerified: boolean;
};

const PROFILE_COLUMNS =
  "onboarding_account_type, company_name, business_reg_number, website, company_email, company_email_verified_at, legal_name, role_title";

async function loadCompanyContext(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<{ ctx: CompanyContext; evidence: any[] }> {
  const { data: profile, error } = await supabase
    .from("client_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.onboarding_account_type !== "enterprise") {
    throw new Error("Company onboarding is only available for company accounts.");
  }

  const { data: evidence } = await supabase
    .from("onboarding_v2_evidence")
    .select("evidence_type, status, reference_value, filename, storage_path, metadata, created_at")
    .eq("user_id", userId);

  const rows = (evidence ?? []) as any[];
  const rep = rows.find((row) => row.evidence_type === "representative");
  const repMeta = (rep?.metadata ?? {}) as Record<string, unknown>;

  return {
    ctx: {
      companyName: (profile?.company_name ?? "").trim(),
      registrationNumber: (profile?.business_reg_number ?? "").trim() || null,
      website: (profile?.website ?? "").trim() || null,
      companyEmail: (profile?.company_email ?? "").trim() || null,
      representativeName:
        ((repMeta["representative_name"] as string | undefined) ?? profile?.legal_name ?? "").trim(),
      representativeTitle:
        ((repMeta["representative_title"] as string | undefined) ?? profile?.role_title ?? "").trim() ||
        null,
      representativeEmail:
        ((repMeta["representative_email"] as string | undefined) ?? profile?.company_email ?? "").trim() ||
        null,
      emailVerified: Boolean(profile?.company_email_verified_at),
    },
    evidence: rows,
  };
}

function letterInput(ctx: CompanyContext, date: string): CompanyLetterInput {
  return {
    company_name: ctx.companyName,
    registration_number: ctx.registrationNumber,
    website: ctx.website,
    representative_name: ctx.representativeName,
    representative_title: ctx.representativeTitle,
    representative_email: ctx.representativeEmail,
    date,
  };
}

/**
 * Registration proof + generated authorization letter + signature state.
 *
 * Letter content is derived from data already collected during onboarding, so
 * it always reflects the current profile until it is signed and frozen.
 */
export const getCompanyAuthorization = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { ctx, evidence } = await loadCompanyContext(supabase, userId);

    const registration = evidence.find((row) => row.evidence_type === "company");
    const authorization = evidence.find((row) => row.evidence_type === "authorization");
    const authMeta = (authorization?.metadata ?? {}) as Record<string, unknown>;
    const signed = Boolean(authMeta["signed_at"]);

    // A signed letter is reproduced from the frozen snapshot, never regenerated.
    const frozen = authMeta["letter_snapshot"] as CompanyLetterInput | undefined;
    const letter = buildCompanyAuthorizationLetter(
      frozen ?? letterInput(ctx, new Date().toISOString()),
    );
    const letterHash = createHash("sha256").update(letter.canonical).digest("hex");

    const authorityStatus = deriveCompanyAuthorityStatus({
      businessEmailVerified: ctx.emailVerified,
      workEmailMatchesCompanyDomain: emailMatchesCompanyDomain(
        ctx.representativeEmail ?? ctx.companyEmail,
        ctx.website,
      ),
      registrationNumberProvided: Boolean(ctx.registrationNumber),
      authorityDocumentStatus: authorization?.status ?? null,
    }) as CompanyAuthorityStatus;

    return {
      company: {
        name: ctx.companyName,
        registration_number: ctx.registrationNumber,
        website: ctx.website,
        representative_name: ctx.representativeName,
        representative_title: ctx.representativeTitle,
        representative_email: ctx.representativeEmail,
      },
      registration_proof: registration
        ? {
            doc_type: (registration.metadata as Record<string, unknown> | null)?.["doc_type"] ?? null,
            label: registration.reference_value,
            filename: registration.filename,
            status: registration.status,
            uploaded_at: registration.created_at,
          }
        : null,
      letter: {
        version: letter.version,
        title: letter.title,
        provider: letter.provider,
        fields: letter.fields,
        paragraphs: letter.paragraphs,
        sha256: letterHash,
      },
      signature: signed
        ? {
            legal_name: (authMeta["legal_name"] as string | null) ?? null,
            title: (authMeta["title"] as string | null) ?? null,
            company_name: (authMeta["company_name"] as string | null) ?? null,
            signed_at: (authMeta["signed_at"] as string | null) ?? null,
            letter_version: (authMeta["letter_version"] as string | null) ?? COMPANY_LETTER_VERSION,
            letter_sha256: (authMeta["letter_sha256"] as string | null) ?? null,
          }
        : null,
      authority_status: authorityStatus,
      status_summary: companySubmissionStatus({
        registrationProofSubmitted: Boolean(registration),
        letterSigned: signed,
        authorityApproved: authorityStatus === "AUTHORIZED_REPRESENTATIVE",
      }),
    };
  });

/** Required: official company registration / formation document. */
export const uploadCompanyRegistrationProof = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CompanyRegistrationProofSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await loadCompanyContext(supabase, userId);

    const encoded = data.file_base64.includes(",")
      ? data.file_base64.split(",")[1]
      : data.file_base64;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
      throw new Error("Document must be smaller than 10 MB.");
    }

    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `clients/${userId}/company-registration/${crypto.randomUUID()}-${safeName}`;
    const { putObject } = await import("@/lib/aws/s3.server");
    await putObject({ key: storagePath, body: bytes, contentType: data.mime_type });

    const { error } = await supabase.from("onboarding_v2_evidence").upsert(
      {
        user_id: userId,
        // Registration proof evidences company existence only, never authority.
        evidence_type: "company",
        status: "SUBMITTED",
        verification_method: "company_registration_document_review",
        reference_value: COMPANY_REGISTRATION_DOC_LABELS[data.doc_type],
        storage_path: storagePath,
        filename: data.filename,
        mime_type: data.mime_type,
        metadata: {
          account_type: "enterprise",
          doc_type: data.doc_type,
          size_bytes: bytes.byteLength,
        },
      },
      { onConflict: "user_id,evidence_type" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, label: COMPANY_REGISTRATION_DOC_LABELS[data.doc_type] };
  });

/** Short-lived authenticated URL for a privately stored company document. */
export const getCompanyDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { kind: "registration_proof" | "authorization_letter" }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { evidence } = await loadCompanyContext(supabase, userId);
    const type = data.kind === "registration_proof" ? "company" : "authorization";
    const row = evidence.find((item) => item.evidence_type === type);
    const key = row?.storage_path as string | undefined;
    if (!key) throw new Error("That document is not available yet.");

    const { getSignedGetUrl } = await import("@/lib/aws/s3.server");
    const url = await getSignedGetUrl(key, 300, {
      disposition: "inline",
      filename: (row?.filename as string | undefined) ?? "document",
      contentType: (row?.mime_type as string | undefined) ?? undefined,
    });
    return { url, expires_in: 300 };
  });

/** Renders a short-lived preview PDF of the currently generated letter. */
export const previewCompanyAuthorizationLetter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { ctx, evidence } = await loadCompanyContext(supabase, userId);
    const authorization = evidence.find((row) => row.evidence_type === "authorization");
    const authMeta = (authorization?.metadata ?? {}) as Record<string, unknown>;
    const frozen = authMeta["letter_snapshot"] as CompanyLetterInput | undefined;

    const letter = buildCompanyAuthorizationLetter(
      frozen ?? letterInput(ctx, new Date().toISOString()),
    );
    const letterHash = createHash("sha256").update(letter.canonical).digest("hex");

    const { renderCompanyAuthorizationPdf } = await import("./company-authorization-pdf.server");
    const bytes = await renderCompanyAuthorizationPdf(
      letter,
      authMeta["signed_at"]
        ? {
            legal_name: String(authMeta["legal_name"] ?? ""),
            title: String(authMeta["title"] ?? ""),
            company_name: String(authMeta["company_name"] ?? ""),
            signed_at: String(authMeta["signed_at"]),
            letter_sha256: String(authMeta["letter_sha256"] ?? letterHash),
          }
        : null,
    );

    const key = `clients/${userId}/company-authorization/${letter.version}-${
      authMeta["signed_at"] ? "signed" : "preview"
    }.pdf`;
    const { putObject, getSignedGetUrl } = await import("@/lib/aws/s3.server");
    await putObject({ key, body: Buffer.from(bytes), contentType: "application/pdf" });
    const url = await getSignedGetUrl(key, 300, {
      disposition: "inline",
      filename: "Eterna_Company_Authorization.pdf",
      contentType: "application/pdf",
    });
    return { url, expires_in: 300 };
  });

/**
 * Electronic signature of the generated authorization letter.
 *
 * Freezes the exact document accepted (snapshot + version + SHA-256) with the
 * acceptance timestamp. Signing never grants verified status: the authority
 * review still runs separately.
 */
export const signCompanyAuthorizationLetter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CompanyAuthorizationSignatureSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { ctx, evidence } = await loadCompanyContext(supabase, userId);

    const registration = evidence.find((row) => row.evidence_type === "company");
    if (!registration?.storage_path) {
      throw new Error("Upload the company registration proof before signing.");
    }
    if (
      data.company_name.trim().toLowerCase() !== ctx.companyName.trim().toLowerCase() &&
      ctx.companyName
    ) {
      throw new Error("The company name must match the legal company name on file.");
    }

    const signedAt = new Date().toISOString();
    const snapshot = letterInput(ctx, signedAt);
    const letter = buildCompanyAuthorizationLetter(snapshot);
    const letterHash = createHash("sha256").update(letter.canonical).digest("hex");
    const signatureHash = createHash("sha256")
      .update(
        JSON.stringify({
          user_id: userId,
          letter_sha256: letterHash,
          letter_version: letter.version,
          legal_name: data.legal_name.trim(),
          title: data.title.trim(),
          company_name: data.company_name.trim(),
          signed_at: signedAt,
        }),
      )
      .digest("hex");

    const { renderCompanyAuthorizationPdf } = await import("./company-authorization-pdf.server");
    const bytes = await renderCompanyAuthorizationPdf(letter, {
      legal_name: data.legal_name.trim(),
      title: data.title.trim(),
      company_name: data.company_name.trim(),
      signed_at: signedAt,
      letter_sha256: letterHash,
    });

    const key = `clients/${userId}/company-authorization/${letter.version}-signed.pdf`;
    const { putObject } = await import("@/lib/aws/s3.server");
    await putObject({ key, body: Buffer.from(bytes), contentType: "application/pdf" });

    const { error } = await supabase.from("onboarding_v2_evidence").upsert(
      {
        user_id: userId,
        evidence_type: "authorization",
        // Signed assertion awaiting company-authority review — not verified.
        status: "SUBMITTED",
        verification_method: "generated_authorization_letter_electronic_signature",
        reference_value: data.legal_name.trim(),
        storage_path: key,
        filename: "Eterna_Company_Authorization.pdf",
        mime_type: "application/pdf",
        metadata: {
          account_type: "enterprise",
          legal_name: data.legal_name.trim(),
          title: data.title.trim(),
          company_name: data.company_name.trim(),
          agreed: true,
          signed_at: signedAt,
          letter_version: letter.version,
          letter_sha256: letterHash,
          signature_sha256: signatureHash,
          letter_snapshot: snapshot,
        },
      },
      { onConflict: "user_id,evidence_type" },
    );
    if (error) throw new Error(error.message);

    await supabase
      .from("client_profiles")
      .update({ onboarding_step: 5 })
      .eq("user_id", userId);

    return {
      signed_at: signedAt,
      letter_version: letter.version,
      letter_sha256: letterHash,
    };
  });
