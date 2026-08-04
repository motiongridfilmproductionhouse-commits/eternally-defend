import { dispatchManualEvidenceWorker } from "./manual-evidence.server";

const SARAYU_NAME = "Sarayu Mohan";
const PRELOAD_COUNT = 6;
export const SARAYU_FALLBACK_SOURCE = "preloaded_manual_lead";
export const SARAYU_FALLBACK_QUERY = "preloaded_manual_lead";

export const SARAYU_PRELOAD_METADATA = {
  preload_reason: "Sarayu Mohan client meeting",
  automatically_discovered: false,
  automatically_verified: false,
} as const;

export type SarayuFallbackLead = {
  id: string;
  scan_id: string;
  profile_id: string;
  user_id: string;
  target_name: string;
  submitted_url: string;
  submitted_url_kind: "google_images_viewer";
  selected_result_fragment: string;
  processing_status: "submitted";
  state: "submitted";
  verification_status: "unverified";
  classification: "potential_identity_related_content";
  requires_human_review: true;
  client_visible: true;
  submitted_by: "admin_preload";
  metadata: typeof SARAYU_PRELOAD_METADATA;
  discovery_path: string[];
  error_reason: null;
  source_page_url: null;
  original_image_url: null;
};

export function isManualLeadTableUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /PGRST205|deepfake_manual_leads|relation .* does not exist|schema cache/i.test(message);
}

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

async function findOrCreateFallbackScan(
  supabase: any,
  profile: { id: string; user_id: string; target_name: string },
  ownerUserId = profile.user_id,
) {
  const { data: existing, error: existingError } = await supabase
    .from("deepfake_scans")
    .select("id, target_name")
    .eq("user_id", ownerUserId)
    .ilike("target_name", "%Sarayu Mohan%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(`Unable to locate a Deepfake scan container: ${existingError.message}`);
  if (existing?.id) return String(existing.id);

  const { data: created, error: createError } = await supabase
    .from("deepfake_scans")
    .insert({
      user_id: ownerUserId,
      target_name: profile.target_name,
      aliases: [],
      handles: [],
      status: "completed",
      total_queries: 0,
      total_results: 0,
      error_message: "Manual preload container; not an automated scan.",
      finished_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (createError || !created?.id) {
    throw new Error(`Unable to create a manual preload scan container: ${createError?.message ?? "unknown error"}`);
  }
  return String(created.id);
}

function fallbackLeadFromDiscovery(row: any, profileId: string): SarayuFallbackLead | null {
  if (row.source !== SARAYU_FALLBACK_SOURCE || row.search_query !== SARAYU_FALLBACK_QUERY) return null;
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(String(row.snippet ?? "{}")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (metadata.profile_id !== profileId || metadata.submitted_by !== "admin_preload") return null;
  const submittedUrl = String(row.page_url ?? "");
  if (!submittedUrl) return null;
  return {
    id: String(row.id),
    scan_id: String(row.scan_id),
    profile_id: profileId,
    user_id: String(row.user_id),
    target_name: SARAYU_NAME,
    submitted_url: submittedUrl,
    submitted_url_kind: "google_images_viewer",
    selected_result_fragment: new URL(submittedUrl).hash.slice(1),
    processing_status: "submitted",
    state: "submitted",
    verification_status: "unverified",
    classification: "potential_identity_related_content",
    requires_human_review: true,
    client_visible: true,
    submitted_by: "admin_preload",
    metadata: SARAYU_PRELOAD_METADATA,
    discovery_path: ["admin_preload", "deepfake_discoveries_compatibility"],
    error_reason: null,
    source_page_url: null,
    original_image_url: null,
  };
}

export async function listSarayuFallbackEvidence(supabase: any, profileId: string, userId: string) {
  const { data, error } = await supabase
    .from("deepfake_discoveries")
    .select("id, scan_id, user_id, page_url, snippet, source, search_query")
    .eq("user_id", userId)
    .eq("source", SARAYU_FALLBACK_SOURCE)
    .eq("search_query", SARAYU_FALLBACK_QUERY)
    .order("discovered_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => fallbackLeadFromDiscovery(row, profileId)).filter(Boolean) as SarayuFallbackLead[];
}

export async function seedSarayuFallbackEvidence(
  supabase: any,
  profile: { id: string; user_id: string; target_name: string },
  urls: string[],
  ownerUserId = profile.user_id,
): Promise<SarayuSeedResult> {
  const scanId = await findOrCreateFallbackScan(supabase, profile, ownerUserId);
  const existing = await listSarayuFallbackEvidence(supabase, profile.id, ownerUserId);
  const existingUrls = new Set(existing.map((lead) => lead.submitted_url));
  const insertedIds: string[] = [];

  for (const submittedUrl of urls) {
    if (existingUrls.has(submittedUrl)) continue;
    const metadata = {
      ...SARAYU_PRELOAD_METADATA,
      identity_id: profile.id,
      identity_name: SARAYU_NAME,
      discovery_method: SARAYU_FALLBACK_SOURCE,
      verification_status: "unverified",
      review_required: true,
      client_visible: true,
      is_demo_data: true,
      automatically_discovered: false,
      submitted_by: "admin_preload",
    };
    const { data, error } = await supabase
      .from("deepfake_discoveries")
      .insert({
        user_id: ownerUserId,
        scan_id: scanId,
        source: SARAYU_FALLBACK_SOURCE,
        search_query: SARAYU_FALLBACK_QUERY,
        page_url: submittedUrl,
        canonical_url: submittedUrl,
        source_host: "google.com",
        page_title: "Google Images",
        snippet: JSON.stringify(metadata),
        media_type: "google_images_viewer",
        analysis_status: "manual_lead_unverified",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Unable to seed compatibility lead: ${error.message}`);
    if (data?.id) insertedIds.push(String(data.id));
    existingUrls.add(submittedUrl);
  }

  return {
    profile_id: profile.id,
    inserted_count: insertedIds.length,
    existing_count: existing.length,
    dispatched_count: 0,
    processing_pending: true,
    lead_ids: [...insertedIds, ...existing.map((lead) => lead.id)],
  };
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
  ownerUserId?: string,
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
  if (existingError && isManualLeadTableUnavailable(existingError)) {
    return seedSarayuFallbackEvidence(supabase, profile, urls, ownerUserId);
  }
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

export async function removeSarayuMohanPreloadedEvidence(supabase: any, ownerUserId?: string) {
  const profile = await findSarayuProfile(supabase);
  const probe = await supabase
    .from("deepfake_manual_leads")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("submitted_by", "admin_preload")
    .limit(1);
  if (probe.error && isManualLeadTableUnavailable(probe.error)) {
    const leads = await listSarayuFallbackEvidence(supabase, profile.id, ownerUserId ?? profile.user_id);
    if (!leads.length) return { profile_id: profile.id, removed_count: 0 };
    const { error } = await supabase
      .from("deepfake_discoveries")
      .delete()
      .in("id", leads.map((lead) => lead.id));
    if (error) throw new Error(`Unable to remove Sarayu compatibility preload: ${error.message}`);
    return { profile_id: profile.id, removed_count: leads.length };
  }
  if (probe.error) throw new Error(probe.error.message);
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
