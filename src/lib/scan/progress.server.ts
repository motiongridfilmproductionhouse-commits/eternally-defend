/**
 * Minimal persisted progress store for the Web Scan live-status UI.
 *
 * IMPORTANT SCOPE NOTE: this is NOT a durable/resumable background-job
 * system. The scan pipeline (src/routes/api/scan.ts) still runs inline in a
 * single client-triggered request. This module only lets that same request
 * report small, real checkpoints to `web_scan_progress` so the frontend can
 * show genuine stages/counters instead of a coarse fallback. If the
 * triggering request is aborted (tab closed, browser refreshed), the scan
 * stops exactly as it did before this module existed — checkpoint writes
 * here never change that, and callers must not claim otherwise.
 *
 * Every write is fire-and-forget: it never throws, is never awaited by the
 * scan pipeline, and a failure here (network blip, missing row) can only
 * ever degrade the live status UI — never the scan itself.
 */
import type { ScanPipelineFunnel } from "./pipeline-funnel";
import type { ProviderNode } from "./provider-nodes";

export type ScanCheckpointStage =
  | "INITIALIZING"
  | "QUERY_GENERATION"
  | "DISCOVERY"
  | "AI_RESEARCH"
  | "AI_EXPANSION"
  | "EXTRACTION"
  | "IDENTITY_VERIFICATION"
  | "EVIDENCE_ANALYSIS"
  | "RANKING"
  | "FINALIZING"
  | "COMPLETE"
  | "FAILED";

export type ScanProgressStatus = "queued" | "running" | "complete" | "failed";

export interface ScanProgressCounters {
  queries_planned?: number;
  queries_executed?: number;
  urls_discovered?: number;
  unique_candidates?: number;
  pages_extracted?: number;
  verified_subjects?: number;
  needs_review?: number;
  findings?: number;
  ai_expansion_urls?: number;
}

export interface ScanCheckpointInput {
  stage: ScanCheckpointStage;
  /** Defaults from `stage` when omitted: COMPLETE->complete, FAILED->failed, else running. */
  status?: ScanProgressStatus;
  counters?: ScanProgressCounters;
  providers?: ProviderNode[];
  error?: string | null;
}

/** Builds a real-values-only counters snapshot from the live, mutable ScanPipelineFunnel. */
export function snapshotCounters(
  funnel: ScanPipelineFunnel | undefined,
  extra?: Partial<ScanProgressCounters>,
): ScanProgressCounters {
  return {
    queries_planned: funnel?.queries_planned,
    queries_executed: funnel?.queries_executed,
    urls_discovered: funnel?.discovered,
    unique_candidates: funnel?.unique,
    pages_extracted: funnel?.extracted,
    verified_subjects: funnel?.verified,
    needs_review: funnel?.needs_review,
    ai_expansion_urls: funnel?.ai?.ai_urls_discovered,
    ...extra,
  };
}

function statusForStage(stage: ScanCheckpointStage): ScanProgressStatus {
  if (stage === "COMPLETE") return "complete";
  if (stage === "FAILED") return "failed";
  return "running";
}

/**
 * Fire-and-forget progress checkpoint write. Safe to call with `scanRunId`
 * absent (no-op) — every call site in scan.ts must remain fully functional
 * for callers that don't opt into live progress.
 */
export function reportScanCheckpoint(
  scanRunId: string | null | undefined,
  input: ScanCheckpointInput,
): void {
  if (!scanRunId) return;
  const status = input.status ?? statusForStage(input.stage);
  void (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const nowIso = new Date().toISOString();
      const patch: {
        stage: string;
        status: string;
        updated_at: string;
        counters?: Record<string, number>;
        providers?: ProviderNode[];
        error?: string | null;
        finished_at?: string;
      } = {
        stage: input.stage,
        status,
        updated_at: nowIso,
      };
      if (input.counters) {
        // Strip undefined keys so "not yet known" never masquerades as "known zero".
        patch.counters = Object.fromEntries(
          Object.entries(input.counters).filter(
            (entry): entry is [string, number] => typeof entry[1] === "number",
          ),
        );
      }
      if (input.providers) patch.providers = input.providers;
      if (input.error !== undefined) patch.error = input.error;
      if (status === "complete" || status === "failed") patch.finished_at = nowIso;
      await supabaseAdmin
        .from("web_scan_progress")
        .update(patch as never)
        .eq("id", scanRunId);
    } catch {
      // Best-effort only — never surfaces to the scan pipeline.
    }
  })();
}
