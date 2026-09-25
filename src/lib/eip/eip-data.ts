import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Untyped handle so new EIP tables work before generated types refresh. */
export const eipDb = supabase as unknown as SupabaseClient;

export type EipStatus =
  | "QUEUED" | "PROCESSING" | "VALIDATING" | "IMMUNIZING" | "EVALUATING" | "FINALIZING"
  | "PASS" | "LIMITED" | "FAIL" | "CANCELLED" | "SYSTEM_ERROR";
export const ACTIVE_STATUSES: EipStatus[] = ["QUEUED", "PROCESSING", "VALIDATING", "IMMUNIZING", "EVALUATING", "FINALIZING"];
export const isActive = (s: EipStatus) => ACTIVE_STATUSES.includes(s);

export type EipJob = {
  id: string;
  user_id: string;
  image_name: string;
  storage_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  original_sha256: string;
  authorization_ref: string;
  authorized_identity: string | null;
  status: EipStatus;
  current_stage: string | null;
  engine_version: string | null;
  config_sha256: string | null;
  protected_storage_path: string | null;
  protected_sha256: string | null;
  certificate_id: string | null;
  reason_codes: string[];
  error_message: string | null;
  error_code: string | null;
  engine_job_id: string | null;
  research_base_version: string | null;
  evaluation_version: string | null;
  heartbeat_at: string | null;
  attempt_count: number;
  worker_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type EipEvaluation = {
  id: string;
  job_id: string;
  evaluation_version: string;
  is_initial: boolean;
  status: "PASS" | "LIMITED" | "FAIL" | "SYSTEM_ERROR";
  visual_quality: string | null;
  transformation_robustness: string | null;
  identity_evaluation: string | null;
  reason_codes: string[];
  duration_ms: number | null;
  created_at: string;
};

export const EIP_STAGES = [
  "Validating Image",
  "Analyzing Identity",
  "Applying EIP Protection",
  "Testing Visual Quality",
  "Testing Transformation Robustness",
  "Evaluating Protection",
  "Generating Certificate",
] as const;

export const REASON_LABELS: Record<string, string> = {
  insufficient_effect: "Insufficient measurable protection effect",
  visual_quality_below_threshold: "Visual quality below threshold",
  robustness_insufficient: "Transformation robustness insufficient",
  no_face: "No detectable face",
  multiple_faces: "Multiple faces are not supported",
  invalid_image: "Invalid or unreadable image",
};
export const reasonLabel = (c: string) => REASON_LABELS[c] ?? c.replace(/_/g, " ");

export async function fetchEipAccess(userId: string) {
  const { data } = await eipDb
    .from("eip_account_access")
    .select("enabled, requested_at")
    .eq("user_id", userId)
    .maybeSingle();
  return (data ?? null) as { enabled: boolean; requested_at: string | null } | null;
}

export async function fetchEipJobs(userId?: string) {
  let q = eipDb.from("eip_jobs").select("*").order("created_at", { ascending: false }).limit(200);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EipJob[];
}

export async function fetchEvaluations(jobIds: string[]) {
  if (jobIds.length === 0) return [] as EipEvaluation[];
  const { data, error } = await eipDb
    .from("eip_evaluations")
    .select("*")
    .in("job_id", jobIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EipEvaluation[];
}

/** Summary numbers are computed only from stored rows. */
export function summarize(jobs: EipJob[], evals: EipEvaluation[]) {
  const latestVersion = evals.reduce<string | null>(
    (v, e) => (!v || e.evaluation_version > v ? e.evaluation_version : v),
    null,
  );
  const needsReeval = latestVersion
    ? jobs.filter((j) => {
        if (!["PASS", "LIMITED"].includes(j.status)) return false;
        const mine = evals.filter((e) => e.job_id === j.id);
        return mine.length > 0 && !mine.some((e) => e.evaluation_version === latestVersion);
      }).length
    : 0;
  return {
    protected: jobs.filter((j) => j.status === "PASS").length,
    processing: jobs.filter((j) => isActive(j.status)).length,
    limited: jobs.filter((j) => j.status === "LIMITED").length,
    needsReeval,
    latest: jobs.find((j) => !isActive(j.status)) ?? null,
  };
}

export async function sha256Hex(file: Blob) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const STATUS_STYLE: Record<EipStatus, string> = {
  PASS: "bg-success/15 text-success border-success/30",
  LIMITED: "bg-warning/15 text-warning border-warning/30",
  FAIL: "bg-danger/15 text-danger border-danger/30",
  SYSTEM_ERROR: "bg-muted text-foreground border-border",
  QUEUED: "bg-info/15 text-info border-info/30",
  PROCESSING: "bg-info/15 text-info border-info/30",  VALIDATING: "bg-info/15 text-info border-info/30",
  IMMUNIZING: "bg-info/15 text-info border-info/30",
  EVALUATING: "bg-info/15 text-info border-info/30",
  FINALIZING: "bg-info/15 text-info border-info/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};
export const STATUS_LABEL: Record<EipStatus, string> = {
  PASS: "PASS",
  LIMITED: "LIMITED",
  FAIL: "FAIL",
  SYSTEM_ERROR: "SYSTEM ERROR",
  QUEUED: "PROCESSING",
  PROCESSING: "PROCESSING",  VALIDATING: "PROCESSING",
  IMMUNIZING: "PROCESSING",
  EVALUATING: "PROCESSING",
  FINALIZING: "PROCESSING",
  CANCELLED: "CANCELLED",
};
