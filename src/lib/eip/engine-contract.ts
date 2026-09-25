/**
 * EIP engine integration contract (platform side). Pure and browser-safe:
 * schemas, validation and state mapping only — no secrets, no network.
 * The engine service contract itself is documented in docs/eip-engine-contract.md.
 */
import { z } from "zod";

export const EIP_ERROR_CODES = [
  "ENGINE_UNAVAILABLE",
  "ENGINE_TIMEOUT",
  "ENGINE_AUTH_REJECTED",
  "ENGINE_VERSION_MISMATCH",
  "CONFIG_INTEGRITY_FAILED",
  "MODEL_LOAD_FAILED",
  "INPUT_DOWNLOAD_FAILED",
  "INPUT_HASH_MISMATCH",
  "OUTPUT_HASH_MISMATCH",
  "MANIFEST_INVALID",
  "STORAGE_WRITE_FAILED",
  "EVALUATION_INCOMPLETE",
  "ENGINE_RESPONSE_INVALID",
] as const;
export type EipErrorCode = (typeof EIP_ERROR_CODES)[number];

/** Operational failures an admin may retry. Integrity failures are never retried blindly. */
export const NON_RETRYABLE: ReadonlySet<string> = new Set([
  "CONFIG_INTEGRITY_FAILED",
  "ENGINE_VERSION_MISMATCH",
  "INPUT_HASH_MISMATCH",
  "AUTHORIZATION_INVALID",
]);
export const isRetryableSystemError = (code: string | null | undefined) => !NON_RETRYABLE.has(code ?? "");

/** Clean user-facing wording; technical detail goes only to the admin ops log. */
export const USER_ERROR_MESSAGE: Record<string, string> = {
  ENGINE_UNAVAILABLE: "The EIP engine is temporarily unavailable.",
  ENGINE_TIMEOUT: "Processing did not complete in time.",
  ENGINE_AUTH_REJECTED: "The EIP engine could not be reached securely.",
  ENGINE_VERSION_MISMATCH: "The EIP engine version is not approved for processing.",
  CONFIG_INTEGRITY_FAILED: "The EIP configuration failed its integrity check.",
  MODEL_LOAD_FAILED: "The EIP engine could not load its models.",
  INPUT_DOWNLOAD_FAILED: "The engine could not retrieve the image.",
  INPUT_HASH_MISMATCH: "The image received by the engine did not match the upload.",
  OUTPUT_HASH_MISMATCH: "The protected image failed its integrity check.",
  MANIFEST_INVALID: "The engine returned an incomplete result record.",
  STORAGE_WRITE_FAILED: "The protected image could not be saved.",
  EVALUATION_INCOMPLETE: "The evaluation did not complete.",
  ENGINE_RESPONSE_INVALID: "The engine returned an unexpected response.",
};

const sha = z.string().regex(/^[a-f0-9]{64}$/);

export const HealthSchema = z.object({
  status: z.string(),
  engineAvailable: z.boolean(),
  engineVersion: z.string().min(1),
  researchBaseVersion: z.string().min(1),
  modelsLoaded: z.boolean(),
  configSha256: sha.optional(),
  configIntegrity: z.enum(["ok", "failed"]).optional(),
});
export type EngineHealth = z.infer<typeof HealthSchema>;

export const SubmitResponseSchema = z.object({
  engineJobId: z.string().min(1),
  platformJobId: z.string().uuid(),
  status: z.string(),
  engineVersion: z.string().min(1),
  researchBaseVersion: z.string().min(1),
  configSha256: sha,
});

export const ENGINE_STATES = [
  "QUEUED",
  "VALIDATING",
  "IMMUNIZING",
  "EVALUATING",
  "FINALIZING",
  "COMPLETED",
  "CANCELLED",
  "FAILED_SYSTEM",
] as const;

export const JobStatusSchema = z.object({
  engineJobId: z.string().min(1),
  platformJobId: z.string().uuid(),
  status: z.enum(ENGINE_STATES),
  stage: z.string().optional(),
  errorCode: z.string().optional(),
  preflightReasonCodes: z.array(z.string()).optional(),
  manifest: z.unknown().optional(),
  outputUrl: z.string().url().optional(),
});
export type EngineJobStatus = z.infer<typeof JobStatusSchema>;

const metrics = z.record(z.string(), z.unknown());
export const ManifestSchema = z.object({
  eip_job_id: z.string().min(1),
  authorization_id: z.string().min(1),
  engine_version: z.string().min(1),
  research_base_version: z.string().min(1),
  config_sha256: sha,
  original_asset_sha256: sha,
  protected_asset_sha256: sha.nullable(),
  quality_metrics: metrics,
  identity_metrics: metrics,
  transform_metrics: metrics,
  held_out_metrics: metrics,
  decision: z.enum(["PASS", "LIMITED", "FAIL"]),
  reason_codes: z.array(z.string()),
  warnings: z.array(z.string()),
  evaluation_version: z.string().min(1),
  created_at: z.string().min(1),
  certificate_id: z.string().optional(),
  summary: z
    .object({
      visual_quality: z.string().optional(),
      transformation_robustness: z.string().optional(),
      identity_evaluation: z.string().optional(),
    })
    .optional(),
});
export type EipManifest = z.infer<typeof ManifestSchema>;

export const EvaluationStatusSchema = z.object({
  engineEvaluationId: z.string().min(1),
  status: z.enum(["QUEUED", "EVALUATING", "COMPLETED", "FAILED_SYSTEM"]),
  errorCode: z.string().optional(),
  evaluation: z
    .object({
      protected_asset_sha256: sha,
      evaluation_version: z.string().min(1),
      decision: z.enum(["PASS", "LIMITED", "FAIL"]),
      reason_codes: z.array(z.string()),
      summary: ManifestSchema.shape.summary,
    })
    .optional(),
});

/** Engine stage → platform status + UI stage label (from EIP_STAGES). */
export const STAGE_MAP: Record<string, { status: string; stage: string }> = {
  QUEUED: { status: "PROCESSING", stage: "Validating Image" },
  VALIDATING: { status: "VALIDATING", stage: "Validating Image" },
  IMMUNIZING: { status: "IMMUNIZING", stage: "Applying EIP Protection" },
  EVALUATING: { status: "EVALUATING", stage: "Evaluating Protection" },
  FINALIZING: { status: "FINALIZING", stage: "Generating Certificate" },
};

export type Expected = { engineVersion?: string; configSha256?: string };

/** Version policy: when an expected version / config SHA is configured, anything else is rejected. */
export function checkVersions(
  got: { engineVersion: string; configSha256?: string },
  expected: Expected,
): EipErrorCode | null {
  if (expected.engineVersion && got.engineVersion !== expected.engineVersion) return "ENGINE_VERSION_MISMATCH";
  if (expected.configSha256 && got.configSha256 !== expected.configSha256) return "CONFIG_INTEGRITY_FAILED";
  return null;
}

export type ManifestCheck =
  | { ok: true; manifest: EipManifest }
  | { ok: false; code: EipErrorCode; detail: string };

/** A result is accepted only if the manifest is complete and every hash/version agrees. */
export function validateManifest(
  raw: unknown,
  job: { id: string; authorization_ref: string; original_sha256: string },
  pinned: { engineVersion: string | null; configSha256: string | null },
  expected: Expected,
): ManifestCheck {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "MANIFEST_INVALID", detail: parsed.error.issues.map((i) => i.path.join(".")).join(",") };
  const m = parsed.data;
  if (m.eip_job_id !== job.id) return { ok: false, code: "MANIFEST_INVALID", detail: "job id mismatch" };
  if (m.authorization_id !== job.authorization_ref) return { ok: false, code: "MANIFEST_INVALID", detail: "authorization mismatch" };
  if (m.original_asset_sha256 !== job.original_sha256) return { ok: false, code: "INPUT_HASH_MISMATCH", detail: "original hash mismatch" };
  const v = checkVersions({ engineVersion: m.engine_version, configSha256: m.config_sha256 }, expected);
  if (v) return { ok: false, code: v, detail: "manifest version/config" };
  if (pinned.configSha256 && m.config_sha256 !== pinned.configSha256) return { ok: false, code: "CONFIG_INTEGRITY_FAILED", detail: "config changed mid-job" };
  if (pinned.engineVersion && m.engine_version !== pinned.engineVersion) return { ok: false, code: "ENGINE_VERSION_MISMATCH", detail: "engine changed mid-job" };
  if (m.decision !== "FAIL" && !m.protected_asset_sha256) return { ok: false, code: "MANIFEST_INVALID", detail: "missing protected hash" };
  return { ok: true, manifest: m };
}

/** Engine decisions map 1:1; anything else is a system error, never a technical FAIL. */
export function mapDecision(decision: string): "PASS" | "LIMITED" | "FAIL" | null {
  return decision === "PASS" || decision === "LIMITED" || decision === "FAIL" ? decision : null;
}

/** Preflight failures are legitimate technical FAILs (the image cannot be protected). */
export const PREFLIGHT_CODES = new Set(["NO_FACE", "MULTIPLE_FACES", "LOW_RESOLUTION", "INVALID_IMAGE", "UNSUPPORTED_FORMAT"]);
