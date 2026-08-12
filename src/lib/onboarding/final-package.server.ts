import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CertificateSnapshot } from "./final-package";

export type FinalPackageData = {
  certificate: {
    id: string;
    certificate_number: string;
    score: number;
    status: string;
    issued_at: string | null;
    expires_at: string | null;
    verification_badge: string | null;
    public_slug: string | null;
  };
  authorization: {
    id: string;
    auth_number: string;
    status: string;
    effective_date: string | null;
    expiry_date: string | null;
  };
  snapshot: CertificateSnapshot | null;
  documents: Array<{ kind: string; s3_key: string; version: number | null }>;
  faces: Array<{ label: string | null; status: string; created_at: string }>;
  assets: Array<{
    kind: string;
    name: string | null;
    handle: string | null;
    channel_url: string | null;
    verification_status: string;
    verified_at: string | null;
  }>;
};

/**
 * Loads only the data the final artifacts are allowed to contain. Biometric,
 * provider and storage internals are intentionally not selected.
 */
export async function loadFinalPackageData(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<FinalPackageData> {
  const { data: cert } = await supabase
    .from("verification_certificates")
    .select(
      "id,certificate_number,score,status,issued_at,expires_at,verification_badge,public_slug,snapshot,authorization_id",
    )
    .eq("user_id", userId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: auth } = await supabase
    .from("client_authorizations")
    .select("id,auth_number,status,effective_date,expiry_date,version")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cert || cert.status !== "ACTIVE" || !auth || auth.status !== "ACTIVE") {
    throw new Error("NOT_READY");
  }

  const [{ data: docs }, { data: faces }, { data: assets }] = await Promise.all([
    supabase
      .from("authorization_documents")
      .select("kind,s3_key,version")
      .eq("user_id", userId)
      .eq("authorization_id", cert.authorization_id ?? auth.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("protected_faces")
      .select("label,status,created_at")
      .eq("user_id", userId)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: true }),
    supabase
      .from("digital_assets")
      .select("kind,name,handle,channel_url,verification_status,verified_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);

  return {
    certificate: {
      id: cert.id,
      certificate_number: cert.certificate_number,
      score: cert.score,
      status: cert.status,
      issued_at: cert.issued_at ?? null,
      expires_at: cert.expires_at ?? null,
      verification_badge: cert.verification_badge ?? null,
      public_slug: cert.public_slug ?? null,
    },
    authorization: {
      id: auth.id,
      auth_number: auth.auth_number,
      status: auth.status,
      effective_date: auth.effective_date ?? null,
      expiry_date: auth.expiry_date ?? null,
    },
    snapshot: (cert.snapshot as CertificateSnapshot | null) ?? null,
    documents: (docs ?? []).map((d) => ({
      kind: d.kind,
      s3_key: d.s3_key,
      version: d.version ?? null,
    })),
    faces: (faces ?? []).map((f) => ({
      label: f.label ?? null,
      status: f.status,
      created_at: f.created_at,
    })),
    assets: (assets ?? []).map((a) => ({
      kind: a.kind,
      name: a.name ?? null,
      handle: a.handle ?? null,
      channel_url: a.channel_url ?? null,
      verification_status: a.verification_status,
      verified_at: a.verified_at ?? null,
    })),
  };
}
