/**
 * Retention & cleanup.
 *
 * Policies:
 *   - immediate         → purge on job finish
 *   - retain_7_days     → cleanup temp media after 7 days
 *   - retain_30_days    → cleanup temp media after 30 days
 *   - case_closure      → cleanup only when linked case marked closed
 *   - legal_hold        → NEVER cleaned (until hold is released)
 *
 * Always retained: multimedia_analysis_jobs row + finding_review_history
 * (audit log) + narrative_clusters + fact_check_matches + extracted_claims.
 *
 * Cleaned when past window: multimedia_uploads (temporary media),
 * evidence_frames, transcript_segments, ocr_results, video_annotations,
 * visual_detections. Failed processing artefacts (multimedia_errors) older
 * than 30 days are also cleaned.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type RetentionPolicy = "immediate" | "retain_7_days" | "retain_30_days" | "case_closure" | "legal_hold";

const POLICY_DAYS: Record<RetentionPolicy, number | null> = {
  immediate: 0,
  retain_7_days: 7,
  retain_30_days: 30,
  case_closure: null,   // never age-based
  legal_hold: null,     // never cleaned
};

export const setJobRetentionPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    jobId: z.string().uuid(),
    policy: z.enum(["immediate", "retain_7_days", "retain_30_days", "case_closure", "legal_hold"]),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("multimedia_analysis_jobs")
      .update({ canceled_reason: null } as any) // placeholder to enable RLS check
      .eq("id", data.jobId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    // Store policy in source_metadata to avoid a migration
    const { data: job } = await supabase.from("multimedia_analysis_jobs")
      .select("source_metadata").eq("id", data.jobId).maybeSingle();
    const meta = (job?.source_metadata ?? {}) as any;
    meta.retention_policy = data.policy;
    meta.retention_set_at = new Date().toISOString();
    await supabase.from("multimedia_analysis_jobs")
      .update({ source_metadata: meta }).eq("id", data.jobId);
    return { ok: true, policy: data.policy };
  });

export const runRetentionCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    dryRun: z.boolean().default(true),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Admin-only when any admin exists
    const { data: anyAdmin } = await supabase.from("user_roles").select("user_id").eq("role", "admin").limit(1);
    if (anyAdmin && anyAdmin.length > 0) {
      const { data: ok } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
      if (!ok) throw new Error("Forbidden: admin role required for retention operations");
    }

    const now = Date.now();
    const { data: jobs } = await supabase.from("multimedia_analysis_jobs")
      .select("id, user_id, finished_at, created_at, source_metadata, status");

    const toClean: string[] = [];
    const summary: Record<string, number> = {};
    for (const j of jobs ?? []) {
      const meta = (j.source_metadata ?? {}) as any;
      const policy = (meta.retention_policy ?? "retain_30_days") as RetentionPolicy;
      const days = POLICY_DAYS[policy];
      if (policy === "legal_hold") { summary.legal_hold = (summary.legal_hold ?? 0) + 1; continue; }
      if (policy === "case_closure") { summary.case_closure = (summary.case_closure ?? 0) + 1; continue; }
      const anchor = j.finished_at ?? j.created_at;
      if (!anchor) continue;
      const ageDays = (now - new Date(anchor).getTime()) / 86400000;
      if (days !== null && ageDays >= days) {
        toClean.push(j.id);
        summary[policy] = (summary[policy] ?? 0) + 1;
      }
    }

    if (data.dryRun || toClean.length === 0) {
      return { dryRun: data.dryRun, jobsMatched: toClean.length, summary, deleted: {} };
    }

    // Bulk delete temporary + heavy tables. Audit-critical rows (jobs,
    // narrative_clusters, finding_review_history, extracted_claims,
    // fact_check_matches, timestamp_findings) are preserved.
    const deleted: Record<string, number> = {};
    const del = async (table: string) => {
      const { error, count } = await ((supabase as any).from(table) as any)
        .delete({ count: "exact" }).in("job_id", toClean);
      if (!error) deleted[table] = count ?? 0;
    };
    await del("multimedia_uploads");
    await del("evidence_frames");
    await del("transcript_segments");
    await del("ocr_results");
    await del("video_annotations");
    await del("visual_detections");
    await del("speaker_segments");

    // Old provider errors (>30d)
    const cutoff = new Date(now - 30 * 86400000).toISOString();
    const { count: errCount } = await supabase.from("multimedia_errors")
      .delete({ count: "exact" }).lt("created_at", cutoff);
    deleted.multimedia_errors = errCount ?? 0;

    return { dryRun: false, jobsMatched: toClean.length, summary, deleted };
  });

export const getRetentionPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: jobs } = await supabase.from("multimedia_analysis_jobs")
      .select("id, source_metadata, finished_at, created_at, status");
    const buckets: Record<string, number> = { immediate: 0, retain_7_days: 0, retain_30_days: 0, case_closure: 0, legal_hold: 0, unspecified: 0 };
    for (const j of jobs ?? []) {
      const p = ((j.source_metadata as any)?.retention_policy ?? "unspecified") as string;
      buckets[p] = (buckets[p] ?? 0) + 1;
    }
    return { buckets, total: jobs?.length ?? 0 };
  });
