import { dispatchManualEvidenceWorker } from "./manual-evidence.server";

const SARAYU_NAME = "Sarayu Mohan";
const PRELOAD_COUNT = 6;

export const SARAYU_PRELOAD_METADATA = {
  preload_reason: "Sarayu Mohan client meeting",
  automatically_discovered: false,
  automatically_verified: false,
} as const;

function normalizeIdentityName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function configuredUrls(): string[] {
  const raw = process.env.SARAYU_MOHAN_MANUAL_EVIDENCE_URLS ?? "";
  let values: unknown = raw;
  try {
    if (raw.trim().startsWith("[")) values = JSON.parse(raw);
  } catch {
    throw new Error("SARAYU_MOHAN_MANUAL_EVIDENCE_URLS must be valid JSON or newline-separated URLs.");
  }
  const urls = Array.isArray(values)
    ? values
    : raw.split(/[\r\n,]+/);
  return urls
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function assertSixExactUrls(urls: string[]): string[] {
  const unique = [...new Set(urls)];
  if (unique.length !== PRELOAD_COUNT) {
    throw new Error(
      `Sarayu preload requires exactly ${PRELOAD_COUNT} unique Google Images URLs in SARAYU_MOHAN_MANUAL_EVIDENCE_URLS; received ${unique.length}.`,
    );
  }
  for (const url of unique) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid Sarayu preload URL: ${url}`);
    }
    if (!/^https?:$/i.test(parsed.protocol) || !/google\./i.test(parsed.hostname)) {
      throw new Error(`Sarayu preload URL is not a Google URL: ${url}`);
    }
    if (!parsed.hash.includes("sv=")) {
      throw new Error(`Sarayu preload URL must preserve a Google #sv= fragment: ${url}`);
    }
  }
  return unique;
}

async function findSarayuProfile(supabase: any) {
  const { data, error } = await supabase
    .from("deepfake_target_profiles")
    .select("id, user_id, target_name")
    .ilike("target_name", "%Sarayu Mohan%")
    .limit(50);
  if (error) throw new Error(`Unable to locate Sarayu Mohan identity: ${error.message}`);
  const normalized = normalizeIdentityName(SARAYU_NAME);
  const profile = (data ?? []).find(
    (row: { target_name?: string }) => normalizeIdentityName(row.target_name ?? "") === normalized,
  );
  if (!profile) throw new Error("Sarayu Mohan protected identity was not found.");
  return profile as { id: string; user_id: string; target_name: string };
}

export type SarayuSeedResult = {
  profile_id: string;
  inserted_count: number;
  existing_count: number;
  dispatched_count: number;
  processing_pending: boolean;
  lead_ids: string[];
};

export async function seedSarayuMohanManualEvidence(
  supabase?: any,
  suppliedUrls?: string[],
): Promise<SarayuSeedResult> {
  if (!supabase) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    supabase = supabaseAdmin;
  }
  const profile = await findSarayuProfile(supabase);
  let rawUrls = suppliedUrls ?? configuredUrls();
  if (!rawUrls.length) {
    const { data: existingPreloadRows, error: preloadError } = await supabase
      .from("deepfake_manual_leads")
      .select("submitted_url")
      .eq("profile_id", profile.id)
      .eq("submitted_by", "admin_preload")
      .limit(PRELOAD_COUNT);
    if (preloadError) throw new Error(preloadError.message);
    rawUrls = (existingPreloadRows ?? []).map((row: { submitted_url: string }) => row.submitted_url);
  }
  const urls = assertSixExactUrls(rawUrls);

  const { data: existingRows, error: existingError } = await supabase
    .from("deepfake_manual_leads")
    .select("id, submitted_url")
    .eq("profile_id", profile.id)
    .in("submitted_url", urls);
  if (existingError) throw new Error(existingError.message);

  const existing = new Set((existingRows ?? []).map((row: { submitted_url: string }) => row.submitted_url));
  const rows = urls
    .filter((submittedUrl) => !existing.has(submittedUrl))
    .map((submittedUrl) => ({
      user_id: profile.user_id,
      profile_id: profile.id,
      target_name: profile.target_name,
      submitted_url: submittedUrl,
      submitted_url_kind: "google_images_viewer",
      selected_result_fragment: new URL(submittedUrl).hash.slice(1),
      source_type: "google_images_viewer",
      state: "submitted",
      processing_status: "submitted",
      verification_status: "unverified",
      classification: "potential_identity_related_content",
      requires_human_review: true,
      client_visible: true,
      submitted_by: "admin_preload",
      metadata: SARAYU_PRELOAD_METADATA,
      discovery_path: ["admin_preload", "manual_evidence"],
      error_reason: null,
    }));

  let insertedRows: Array<{ id: string }> = [];
  if (rows.length) {
    const { data, error } = await supabase
      .from("deepfake_manual_leads")
      .upsert(rows, { onConflict: "profile_id,submitted_url", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`Unable to seed Sarayu evidence: ${error.message}`);
    insertedRows = data ?? [];
  }

  const leadIds = [
    ...insertedRows.map((row) => row.id),
    ...(existingRows ?? []).map((row: { id: string }) => row.id),
  ];
  const pendingIds = leadIds;
  const dispatch = pendingIds.length
    ? await dispatchManualEvidenceWorker(pendingIds)
    : { dispatched: false, reason: "No Sarayu leads found." };

  if (!dispatch.dispatched && leadIds.length) {
    await supabase
      .from("deepfake_manual_leads")
      .update({ error_reason: "Processing pending", state: "submitted", processing_status: "submitted" })
      .in("id", leadIds);
  }

  return {
    profile_id: profile.id,
    inserted_count: insertedRows.length,
    existing_count: existingRows?.length ?? 0,
    dispatched_count: dispatch.dispatched ? pendingIds.length : 0,
    processing_pending: !dispatch.dispatched,
    lead_ids: leadIds,
  };
}

export async function removeSarayuMohanPreloadedEvidence(supabase: any) {
  const profile = await findSarayuProfile(supabase);
  const { data, error } = await supabase
    .from("deepfake_manual_leads")
    .delete()
    .eq("profile_id", profile.id)
    .eq("submitted_by", "admin_preload")
    .select("id");
  if (error) throw new Error(`Unable to remove Sarayu preload: ${error.message}`);
  return { profile_id: profile.id, removed_count: data?.length ?? 0 };
}

export function sarayuPreloadCount() {
  return PRELOAD_COUNT;
}
