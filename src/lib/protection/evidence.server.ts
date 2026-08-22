/**
 * Shared evidence-capture bridge for the automated (non-deepfake) scan
 * modules. Reuses the existing production evidence-capture function as-is
 * (fetch + hash + status — the same mechanism Deepfake already uses for
 * deepfake_evidence, confirmed to never persist raw bytes either, so this
 * doesn't invent a heavier evidence system than what's already proven).
 *
 * Writes to two tables with different mutability contracts:
 *  - automated_finding_evidence: the canonical, idempotent occurrence
 *    (upserted on (user_id, module_key, url)) used for dedup/case-prep
 *    gating — deliberately mutable so a re-verification refreshes it.
 *  - automated_finding_evidence_captures: append-only — one INSERT per
 *    capture attempt, never updated/deleted, so a later re-scan's upsert
 *    can never silently discard an earlier capture's hash/status/timestamp.
 *    Required for anything evidentiary feeding enforcement case prep
 *    (deployment-readiness audit finding).
 */
import { captureEvidenceCandidate } from "@/lib/deepfake/evidence-capture.server";

export interface FindingEvidenceInput {
  userId: string;
  moduleKey: string;
  findingSourceTable: string;
  findingId: string;
  url: string;
  title?: string;
  mediaType?: "image" | "video" | "page";
}

export interface FindingEvidenceResult {
  ok: boolean;
  evidenceId: string | null;
  status: string;
}

/**
 * Captures evidence for one finding and records it idempotently. Dedupe key
 * is (user_id, module_key, url) — content identity, not finding_id — so the
 * *same real-world URL* rediscovered in a later recurring scan (a new
 * copyright_matches/youtube_removal_findings row, since those are scoped
 * per-scan) upserts onto the same evidence record instead of accumulating a
 * fresh row every cadence cycle (duplicate-safety audit finding). Never
 * throws — a capture failure is recorded as evidence_status "capture_failed"
 * rather than blocking the caller, since a dead/unreachable URL is itself a
 * legitimate (if degraded) evidence outcome, not a system error.
 */
export async function captureAndRecordFindingEvidence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: FindingEvidenceInput,
): Promise<FindingEvidenceResult> {
  const capture = await captureEvidenceCandidate({
    url: input.url,
    title: input.title,
    media_type: input.mediaType === "page" ? undefined : input.mediaType,
  });

  const row = {
    user_id: input.userId,
    module_key: input.moduleKey,
    finding_source_table: input.findingSourceTable,
    finding_id: input.findingId,
    url: input.url,
    canonical_url: capture.canonical_url,
    media_type: capture.media_type,
    http_status: capture.http_status,
    content_type: capture.content_type,
    content_length: capture.content_length,
    media_sha256: capture.media_sha256,
    evidence_status: capture.evidence_status,
    capture_error: capture.capture_error,
    captured_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("automated_finding_evidence")
    .upsert(row, { onConflict: "user_id,module_key,url" })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[protection:evidence] failed to record evidence", input.findingId, error);
    return { ok: false, evidenceId: null, status: capture.evidence_status };
  }

  const evidenceId = data?.id ?? null;
  if (evidenceId) {
    // Best-effort — the canonical row above is the source of truth for
    // dedup/gating; a history-write hiccup must not block the caller.
    const { error: historyError } = await supabaseAdmin
      .from("automated_finding_evidence_captures")
      .insert({
        evidence_id: evidenceId,
        user_id: input.userId,
        module_key: input.moduleKey,
        url: input.url,
        canonical_url: capture.canonical_url,
        media_type: capture.media_type,
        http_status: capture.http_status,
        content_type: capture.content_type,
        content_length: capture.content_length,
        media_sha256: capture.media_sha256,
        evidence_status: capture.evidence_status,
        capture_error: capture.capture_error,
        captured_at: row.captured_at,
      });
    if (historyError) {
      console.error(
        "[protection:evidence] failed to record capture history",
        input.findingId,
        historyError,
      );
    }
  }

  return { ok: true, evidenceId, status: capture.evidence_status };
}
