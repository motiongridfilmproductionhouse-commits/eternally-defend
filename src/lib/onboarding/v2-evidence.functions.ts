import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  ONBOARDING_V2,
  V2_EVIDENCE_TYPES,
  isV2AccountType,
  primaryEvidenceTypeForAccount,
  requiresRepresentative,
  type V2AccountType,
  type V2EvidenceType,
} from "./v2-config";

const EvidenceSchema = z.object({
  evidence_type: z.enum(V2_EVIDENCE_TYPES),
  reference_value: z.string().trim().min(3).max(500).optional().nullable(),
  filename: z.string().trim().min(1).max(200).optional().nullable(),
  mime_type: z.string().trim().max(120).optional().nullable(),
  file_base64: z.string().max(14_000_000).optional().nullable(),
  representative_name: z.string().trim().max(200).optional().nullable(),
  representative_title: z.string().trim().max(120).optional().nullable(),
  representative_email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  representative_phone: z.string().trim().max(40).optional().nullable(),
});

function allowedEvidenceTypes(accountType: V2AccountType): V2EvidenceType[] {
  const primary = primaryEvidenceTypeForAccount(accountType);
  const allowed: V2EvidenceType[] = [];
  if (requiresRepresentative(accountType)) allowed.push("representative");
  if (primary) allowed.push(primary);
  return allowed;
}

export const getV2Evidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("onboarding_v2_evidence")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const submitV2Evidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof EvidenceSchema>) => EvidenceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_version, onboarding_account_type")
      .eq("user_id", userId)
      .maybeSingle();
    if (
      profile?.onboarding_version !== ONBOARDING_V2 ||
      !isV2AccountType(profile.onboarding_account_type)
    ) {
      throw new Error("V2 onboarding profile not found.");
    }

    const accountType = profile.onboarding_account_type;
    const allowed = allowedEvidenceTypes(accountType);
    if (!allowed.includes(data.evidence_type)) {
      throw new Error("This evidence type does not match your account type.");
    }

    if (data.evidence_type === "representative") {
      if (!data.representative_name?.trim()) {
        throw new Error("Representative name is required.");
      }
    } else if (!data.reference_value && !data.file_base64) {
      throw new Error("Add a verification link or upload a document.");
    }

    let storagePath: string | null = null;
    if (data.file_base64) {
      const encoded = data.file_base64.includes(",")
        ? data.file_base64.split(",")[1]
        : data.file_base64;
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
        throw new Error("Document must be smaller than 10 MB.");
      }
      const safeName = (data.filename ?? "evidence").replace(/[^a-zA-Z0-9._-]/g, "_");
      storagePath = `clients/${userId}/onboarding-v2/${crypto.randomUUID()}-${safeName}`;
      const { putObject } = await import("@/lib/aws/s3.server");
      await putObject({
        key: storagePath,
        body: bytes,
        contentType: data.mime_type ?? "application/octet-stream",
      });
    }

    const metadata = {
      account_type: accountType,
      representative_name: data.representative_name ?? null,
      representative_title: data.representative_title ?? null,
      representative_email: data.representative_email || null,
      representative_phone: data.representative_phone ?? null,
    };

    const referenceValue =
      data.evidence_type === "representative"
        ? (data.representative_name?.trim() ?? null)
        : (data.reference_value ?? null);

    const { data: row, error } = await supabase
      .from("onboarding_v2_evidence")
      .upsert(
        {
          user_id: userId,
          evidence_type: data.evidence_type,
          status: "SUBMITTED",
          verification_method: data.file_base64
            ? "document_review"
            : data.evidence_type === "representative"
              ? "representative_attestation"
              : "reference_review",
          reference_value: referenceValue,
          storage_path: storagePath,
          filename: data.filename ?? null,
          mime_type: data.mime_type ?? null,
          metadata,
        },
        { onConflict: "user_id,evidence_type" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (data.evidence_type === "representative" && data.representative_name?.trim()) {
      await supabase
        .from("client_profiles")
        .update({
          contact_person: data.representative_name.trim(),
          role_title: data.representative_title?.trim() || null,
          phone: data.representative_phone?.trim() || null,
        })
        .eq("user_id", userId)
        .eq("onboarding_version", ONBOARDING_V2);
    }

    return row;
  });
