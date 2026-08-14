import { processManualEvidenceLead, splitManualEvidenceUrls } from "./manual-evidence.server";

export type ManualEvidenceIntakeResult = {
  submitted_url: string;
  lead_id: string | null;
  status: string;
  reason: string | null;
  classification: string | null;
  source_domain: string | null;
  source_page_url: string | null;
  face_similarity: number | null;
};

export type ManualEvidenceIntakeSummary = {
  scan_id: string | null;
  target_name: string;
  submitted: number;
  processed: number;
  review_required: number;
  rejected: number;
  failed: number;
  results: ManualEvidenceIntakeResult[];
};

/**
 * Runs the manual-evidence intake pipeline end to end for pasted URLs:
 * creates a manual scan container, stores one lead per URL, resolves + crawls
 * each page, runs enrolled-face comparison, and records findings for the UI.
 * Nothing is auto-enforced: leads land in review states only.
 */
export async function runManualEvidenceIntake(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  targetName: string;
  urls: string[];
  profileId?: string | null;
  signal?: AbortSignal;
}): Promise<ManualEvidenceIntakeSummary> {
  const urls = splitManualEvidenceUrls(input.urls.join("\n"));
  const summary: ManualEvidenceIntakeSummary = {
    scan_id: null,
    target_name: input.targetName,
    submitted: 0,
    processed: 0,
    review_required: 0,
    rejected: 0,
    failed: 0,
    results: [],
  };
  if (!urls.length) return summary;

  const { data: scan, error: scanError } = await input.supabase
    .from("deepfake_scans")
    .insert({
      user_id: input.userId,
      target_name: input.targetName,
      profile_id: input.profileId ?? null,
      status: "running",
      total_queries: 0,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (scanError) throw new Error(`Could not start manual evidence review: ${scanError.message}`);
  summary.scan_id = scan.id as string;

  const leadIds: Array<{ id: string; url: string }> = [];
  for (const url of urls) {
    const { data: lead, error } = await input.supabase
      .from("deepfake_manual_leads")
      .upsert(
        {
          user_id: input.userId,
          scan_id: summary.scan_id,
          profile_id: input.profileId ?? null,
          target_name: input.targetName,
          submitted_url: url,
          submitted_url_kind: "source_page",
          processing_status: "submitted",
          initial_dedupe_key: url,
          source_type: "client_supplied",
          state: "submitted",
          verification_status: "unverified",
          submitted_by: "client_manual_url",
          error_reason: null,
        },
        { onConflict: "profile_id,submitted_url" },
      )
      .select("id")
      .single();
    if (error || !lead) {
      summary.results.push({
        submitted_url: url,
        lead_id: null,
        status: "failed",
        reason: error?.message ?? "Lead could not be stored.",
        classification: null,
        source_domain: null,
        source_page_url: null,
        face_similarity: null,
      });
      summary.failed += 1;
      continue;
    }
    // A re-submitted URL is re-attached to this scan so its finding surfaces here.
    await input.supabase
      .from("deepfake_manual_leads")
      .update({ scan_id: summary.scan_id, processing_status: "submitted", error_reason: null })
      .eq("id", lead.id);
    summary.submitted += 1;
    leadIds.push({ id: lead.id as string, url });
  }

  for (const lead of leadIds) {
    let status = "failed";
    let reason: string | null = null;
    try {
      const outcome = await processManualEvidenceLead({
        supabase: input.supabase,
        leadId: lead.id,
        signal: input.signal,
      });
      status = outcome.status;
      reason = outcome.reason;
    } catch (error) {
      reason = error instanceof Error ? error.message.slice(0, 400) : String(error);
      await input.supabase
        .from("deepfake_manual_leads")
        .update({ processing_status: "failed", error_reason: reason })
        .eq("id", lead.id);
    }

    const { data: row } = await input.supabase
      .from("deepfake_manual_leads")
      .select("classification, source_domain, source_page_url, face_similarity_score, error_reason")
      .eq("id", lead.id)
      .maybeSingle();

    summary.processed += 1;
    if (status === "rejected") summary.rejected += 1;
    else if (status === "failed") summary.failed += 1;
    else summary.review_required += 1;

    summary.results.push({
      submitted_url: lead.url,
      lead_id: lead.id,
      status,
      reason: reason ?? row?.error_reason ?? null,
      classification: row?.classification ?? null,
      source_domain: row?.source_domain ?? null,
      source_page_url: row?.source_page_url ?? null,
      face_similarity:
        typeof row?.face_similarity_score === "number" ? row.face_similarity_score : null,
    });
  }

  await input.supabase
    .from("deepfake_scans")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      total_results: summary.review_required,
    })
    .eq("id", summary.scan_id);

  return summary;
}
