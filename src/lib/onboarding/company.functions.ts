import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CompanyAuthorityDocSchema,
  CompanyOtpVerifySchema,
  CompanyProfileSchema,
  CompanyRepresentativeSchema,
  CompanyServicesSchema,
} from "./company-schemas";
import {
  COMPANY_AUTHORITY_DOC_LABELS,
  deriveCompanyAuthorityStatus,
  emailMatchesCompanyDomain,
  isCompanyServiceKey,
  scopesForCompanyServices,
  type CompanyAuthorityStatus,
} from "./company-config";
import {
  deliverCompanyOtpEmail,
  generateOtpCode,
  hashOtpCode,
} from "./company-otp.server";

export const getCompanyOnboarding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile, error } = await supabase
      .from("client_profiles")
      .select(
        "onboarding_version, onboarding_account_type, company_name, company_brand_name, website, country, address, business_reg_number, company_email, company_email_verified_at, company_authority_status, phone, legal_name, role_title, social_profiles",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const { data: evidence } = await supabase
      .from("onboarding_v2_evidence")
      .select("evidence_type, status, reference_value, filename, metadata, created_at")
      .eq("user_id", userId);

    const representative = (evidence ?? []).find((e) => e.evidence_type === "representative");
    const authorityDoc = (evidence ?? []).find((e) => e.evidence_type === "authorization");

    const { data: otp } = await supabase
      .from("company_email_otps")
      .select("email, expires_at, consumed_at, delivery_status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const repMeta = (representative?.metadata ?? {}) as Record<string, unknown>;
    const social = (profile?.social_profiles ?? {}) as Record<string, unknown>;
    const services = Array.isArray(social["company_services"])
      ? (social["company_services"] as string[])
      : [];

    const authority = deriveCompanyAuthorityStatus({
      businessEmailVerified: Boolean(profile?.company_email_verified_at),
      workEmailMatchesCompanyDomain: emailMatchesCompanyDomain(
        (repMeta["representative_email"] as string | undefined) ?? profile?.company_email,
        profile?.website,
      ),
      registrationNumberProvided: Boolean(profile?.business_reg_number?.trim()),
      authorityDocumentStatus: authorityDoc?.status ?? null,
    });

    return {
      profile: {
        legal_company_name: profile?.company_name ?? "",
        brand_name: profile?.company_brand_name ?? "",
        website: profile?.website ?? "",
        country: profile?.country ?? "",
        business_address: profile?.address ?? "",
        registration_number: profile?.business_reg_number ?? "",
        business_email: profile?.company_email ?? "",
        business_email_verified: Boolean(profile?.company_email_verified_at),
        phone: profile?.phone ?? "",
      },
      representative: {
        full_legal_name: (repMeta["representative_name"] as string | null) ?? "",
        job_title: (repMeta["representative_title"] as string | null) ?? "",
        work_email: (repMeta["representative_email"] as string | null) ?? "",
        phone: (repMeta["representative_phone"] as string | null) ?? "",
        relationship: (repMeta["relationship"] as string | null) ?? "",
        relationship_other: (repMeta["relationship_other"] as string | null) ?? "",
        saved: Boolean(representative),
      },
      authority_document: authorityDoc
        ? {
            doc_type: (authorityDoc.metadata as Record<string, unknown> | null)?.["doc_type"] ?? null,
            filename: authorityDoc.filename,
            uploaded_at: authorityDoc.created_at,
          }
        : null,
      authority_status: authority as CompanyAuthorityStatus,
      services,
      otp: otp
        ? {
            email: otp.email,
            expires_at: otp.expires_at,
            verified: Boolean(otp.consumed_at),
            delivery_status: otp.delivery_status,
          }
        : null,
    };
  });

export const saveCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CompanyProfileSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_account_type, company_email, company_email_verified_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile?.onboarding_account_type !== "enterprise") {
      throw new Error("Company onboarding is only available for company accounts.");
    }

    // Changing the business email invalidates any previous verification.
    const emailChanged =
      (profile?.company_email ?? "").trim().toLowerCase() !==
      data.business_email.trim().toLowerCase();

    const { error } = await supabase
      .from("client_profiles")
      .update({
        company_name: data.legal_company_name,
        company_brand_name: data.brand_name?.trim() || null,
        website: data.website,
        country: data.country,
        address: data.business_address?.trim() || null,
        business_reg_number: data.registration_number?.trim() || null,
        company_email: data.business_email.trim().toLowerCase(),
        company_email_verified_at: emailChanged ? null : profile?.company_email_verified_at,
        phone: data.phone?.trim() || null,
        client_type: "corporate",
        onboarding_step: 1,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, email_verification_reset: emailChanged };
  });

export const requestCompanyEmailOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_account_type, company_name, company_email")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile?.onboarding_account_type !== "enterprise") {
      throw new Error("Company onboarding is only available for company accounts.");
    }
    const email = (profile?.company_email ?? "").trim().toLowerCase();
    if (!email) throw new Error("Save the business email before requesting a code.");

    // Simple rate limit: one code per 60 seconds.
    const { data: latest } = await supabase
      .from("company_email_otps")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest?.created_at && Date.now() - new Date(latest.created_at).getTime() < 60_000) {
      throw new Error("A code was just sent. Please wait a minute before requesting another.");
    }

    const code = generateOtpCode();
    const delivery = await deliverCompanyOtpEmail({
      to: email,
      code,
      companyName: profile?.company_name ?? "your company",
    });

    const { error } = await supabase.from("company_email_otps").insert({
      user_id: userId,
      email,
      code_hash: hashOtpCode(userId, email, code),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      delivery_status: delivery.status,
    });
    if (error) throw new Error(error.message);

    return { email, delivery_status: delivery.status };
  });

export const verifyCompanyEmailOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CompanyOtpVerifySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: record } = await supabase
      .from("company_email_otps")
      .select("id, email, code_hash, expires_at, attempts, consumed_at")
      .eq("user_id", userId)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!record) throw new Error("Request a verification code first.");
    if (new Date(record.expires_at).getTime() < Date.now()) {
      throw new Error("This code has expired. Request a new one.");
    }
    if ((record.attempts ?? 0) >= 5) {
      throw new Error("Too many attempts. Request a new code.");
    }

    if (hashOtpCode(userId, record.email, data.code) !== record.code_hash) {
      await supabase
        .from("company_email_otps")
        .update({ attempts: (record.attempts ?? 0) + 1 })
        .eq("id", record.id);
      throw new Error("That code is not correct.");
    }

    const verifiedAt = new Date().toISOString();
    await supabase
      .from("company_email_otps")
      .update({ consumed_at: verifiedAt })
      .eq("id", record.id);
    await supabase
      .from("client_profiles")
      .update({
        company_email_verified_at: verifiedAt,
        company_authority_status: "COMPANY_VERIFIED",
      })
      .eq("user_id", userId);

    return { verified: true };
  });

export const saveCompanyRepresentative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CompanyRepresentativeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_account_type, website, business_reg_number, company_email_verified_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile?.onboarding_account_type !== "enterprise") {
      throw new Error("Company onboarding is only available for company accounts.");
    }
    if (data.relationship === "other" && !data.relationship_other?.trim()) {
      throw new Error("Describe the relationship to the company.");
    }

    const { error } = await supabase.from("onboarding_v2_evidence").upsert(
      {
        user_id: userId,
        evidence_type: "representative",
        status: "SUBMITTED",
        verification_method: "company_representative_attestation",
        reference_value: data.full_legal_name.trim(),
        metadata: {
          account_type: "enterprise",
          representative_name: data.full_legal_name.trim(),
          representative_title: data.job_title.trim(),
          representative_email: data.work_email.trim().toLowerCase(),
          representative_phone: data.phone?.trim() || null,
          relationship: data.relationship,
          relationship_other: data.relationship_other?.trim() || null,
        },
      },
      { onConflict: "user_id,evidence_type" },
    );
    if (error) throw new Error(error.message);

    const authority = deriveCompanyAuthorityStatus({
      businessEmailVerified: Boolean(profile?.company_email_verified_at),
      workEmailMatchesCompanyDomain: emailMatchesCompanyDomain(data.work_email, profile?.website),
      registrationNumberProvided: Boolean(profile?.business_reg_number?.trim()),
    });

    await supabase
      .from("client_profiles")
      .update({
        legal_name: data.full_legal_name.trim(),
        full_name: data.full_legal_name.trim(),
        contact_person: data.full_legal_name.trim(),
        role_title: data.job_title.trim(),
        company_authority_status: authority,
        onboarding_step: 2,
      })
      .eq("user_id", userId);

    return { authority_status: authority };
  });

export const uploadCompanyAuthorityDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CompanyAuthorityDocSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_account_type")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile?.onboarding_account_type !== "enterprise") {
      throw new Error("Company onboarding is only available for company accounts.");
    }

    const encoded = data.file_base64.includes(",")
      ? data.file_base64.split(",")[1]
      : data.file_base64;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
      throw new Error("Document must be smaller than 10 MB.");
    }

    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `clients/${userId}/company-authority/${crypto.randomUUID()}-${safeName}`;
    const { putObject } = await import("@/lib/aws/s3.server");
    await putObject({
      key: storagePath,
      body: bytes,
      contentType: data.mime_type ?? "application/octet-stream",
    });

    const { error } = await supabase.from("onboarding_v2_evidence").upsert(
      {
        user_id: userId,
        evidence_type: "authorization",
        status: "SUBMITTED",
        verification_method: "company_authority_document_review",
        reference_value: COMPANY_AUTHORITY_DOC_LABELS[data.doc_type],
        storage_path: storagePath,
        filename: data.filename,
        mime_type: data.mime_type ?? null,
        metadata: {
          account_type: "enterprise",
          doc_type: data.doc_type,
          note: data.note?.trim() || null,
        },
      },
      { onConflict: "user_id,evidence_type" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveCompanyProtectionServices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CompanyServicesSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_account_type, social_profiles")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile?.onboarding_account_type !== "enterprise") {
      throw new Error("Company onboarding is only available for company accounts.");
    }

    const { data: faceProfile } = await supabase
      .from("protected_face_profiles")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();
    const faceEnrolled = faceProfile?.status === "FACE_VERIFIED";

    const selected = data.services.filter(isCompanyServiceKey);
    if (selected.length === 0) throw new Error("Select at least one protection service.");
    const scopes = scopesForCompanyServices(selected, faceEnrolled);
    if (Object.keys(scopes).length === 0) {
      throw new Error("Select at least one protection service that is available to your account.");
    }

    const social = (profile?.social_profiles ?? {}) as Record<string, unknown>;
    const { error } = await supabase
      .from("client_profiles")
      .update({
        social_profiles: { ...social, company_services: selected },
        onboarding_step: 6,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    const { saveScopes } = await import("./authorization.functions");
    await saveScopes({ data: { scopes } });

    return { services: selected, scopes: Object.keys(scopes) };
  });
