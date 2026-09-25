/**
 * EIP worker tick — transport-agnostic so it can be tested with a mocked engine.
 * One bounded tick: health check → claim a few jobs → submit or poll each →
 * validate manifest + hashes → store protected output → write result.
 * Never fabricates an outcome: without a valid engine manifest a job stays
 * in progress or becomes SYSTEM_ERROR.
 */
import {
  EvaluationStatusSchema,
  HealthSchema,
  JobStatusSchema,
  PREFLIGHT_CODES,
  STAGE_MAP,
  SubmitResponseSchema,
  USER_ERROR_MESSAGE,
  checkVersions,
  mapDecision,
  validateManifest,
  type EipErrorCode,
  type Expected,
} from "./engine-contract";

export class EngineError extends Error {
  constructor(public code: EipErrorCode, detail: string) {
    super(detail);
  }
}

export type WorkerJob = {
  id: string;
  user_id: string;
  storage_path: string;
  original_sha256: string;
  authorization_ref: string;
  engine_job_id: string | null;
  engine_version: string | null;
  config_sha256: string | null;
  claimed_at: string | null;
  started_at: string | null;
};

export type Reeval = {
  id: string;
  job_id: string;
  engine_evaluation_id: string | null;
  protected_storage_path: string | null;
  protected_sha256: string | null;
  engine_job_id: string | null;
};

export interface EnginePort {
  health(): Promise<unknown>;
  submitJob(body: Record<string, unknown>, idempotencyKey: string): Promise<unknown>;
  getJob(engineJobId: string): Promise<unknown>;
  submitEvaluation(body: Record<string, unknown>, idempotencyKey: string): Promise<unknown>;
  getEvaluation(id: string): Promise<unknown>;
  download(url: string): Promise<Uint8Array>;
}

export interface DbPort {
  claimJobs(limit: number): Promise<WorkerJob[]>;
  updateJob(id: string, patch: Record<string, unknown>, evaluation?: Record<string, unknown> | null): Promise<void>;
  claimReevals(limit: number): Promise<Reeval[]>;
  updateReeval(id: string, status: string, engineEvaluationId: string | null, errorCode: string | null, evaluation?: Record<string, unknown> | null): Promise<void>;
  report(status: Record<string, unknown> | null, log: Record<string, unknown> | null): Promise<void>;
  signInputUrl(path: string, seconds: number): Promise<string>;
  uploadProtected(userId: string, jobId: string, bytes: Uint8Array): Promise<string>;
  idle(force: boolean): Promise<boolean>;
}

export type WorkerConfig = {
  enabled: boolean;
  expected: Expected;
  evaluationVersion?: string;
  jobTimeoutSeconds: number;
  batch: number;
  now?: () => number;
};

export async function sha256Hex(bytes: Uint8Array) {
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type TickResult = { engine: string; processed: number; idle: boolean };

export async function runEipTick(engine: EnginePort, db: DbPort, cfg: WorkerConfig): Promise<TickResult> {
  const now = cfg.now ?? Date.now;
  if (!cfg.enabled) {
    await db.report({ status: "DISABLED" }, null);
    return { engine: "DISABLED", processed: 0, idle: await db.idle(true) };
  }

  // 1. Health gate — never claim work if the engine isn't healthy and approved.
  let healthState = "OPERATIONAL";
  let healthCode: string | null = null;
  let health: ReturnType<typeof HealthSchema.parse> | null = null;
  try {
    const parsed = HealthSchema.safeParse(await engine.health());
    if (!parsed.success) throw new EngineError("ENGINE_RESPONSE_INVALID", "health schema");
    health = parsed.data;
    if (!health.engineAvailable || !health.modelsLoaded) throw new EngineError(health.modelsLoaded ? "ENGINE_UNAVAILABLE" : "MODEL_LOAD_FAILED", "engine not ready");
    if (health.configIntegrity === "failed") throw new EngineError("CONFIG_INTEGRITY_FAILED", "engine reports config integrity failure");
    const v = checkVersions({ engineVersion: health.engineVersion, configSha256: health.configSha256 }, cfg.expected);
    if (v) throw new EngineError(v, "health version policy");
  } catch (e) {
    healthCode = e instanceof EngineError ? e.code : "ENGINE_UNAVAILABLE";
    healthState =
      healthCode === "ENGINE_VERSION_MISMATCH" ? "VERSION_MISMATCH" : healthCode === "CONFIG_INTEGRITY_FAILED" ? "CONFIG_INTEGRITY_FAILURE" : "UNAVAILABLE";
  }
  await db.report(
    {
      status: healthState,
      engine_version: health?.engineVersion ?? null,
      research_base_version: health?.researchBaseVersion ?? null,
      config_sha256: health?.configSha256 ?? null,
      expected_engine_version: cfg.expected.engineVersion ?? null,
      models_loaded: health?.modelsLoaded ?? null,
      error_code: healthCode,
    },
    null,
  );
  if (healthState !== "OPERATIONAL") return { engine: healthState, processed: 0, idle: false };

  // 2. Jobs.
  let processed = 0;
  for (const job of await db.claimJobs(cfg.batch)) {
    processed++;
    try {
      await advanceJob(job, engine, db, cfg, now);
    } catch (e) {
      const code: EipErrorCode = e instanceof EngineError ? e.code : "ENGINE_UNAVAILABLE";
      const transient = code === "ENGINE_UNAVAILABLE" || code === "ENGINE_TIMEOUT";
      await db.report(null, { job_id: job.id, error_code: code, detail: sanitize(e) });
      // Transient network errors leave the job held; heartbeat-based recovery + attempt budget bound retries.
      if (!transient) await failSystem(db, job.id, code);
    }
  }

  // 3. Re-evaluations (never re-run the optimizer).
  for (const r of await db.claimReevals(cfg.batch)) {
    processed++;
    try {
      await advanceReeval(r, engine, db, cfg);
    } catch (e) {
      const code: EipErrorCode = e instanceof EngineError ? e.code : "ENGINE_UNAVAILABLE";
      await db.report(null, { reevaluation_id: r.id, job_id: r.job_id, error_code: code, detail: sanitize(e) });
      if (code !== "ENGINE_UNAVAILABLE" && code !== "ENGINE_TIMEOUT") await db.updateReeval(r.id, "SYSTEM_ERROR", null, code, null);
    }
  }

  return { engine: healthState, processed, idle: await db.idle(false) };
}

async function failSystem(db: DbPort, id: string, code: string) {
  await db.updateJob(id, {
    status: "SYSTEM_ERROR",
    error_code: code,
    error_message: USER_ERROR_MESSAGE[code] ?? "EIP processing could not complete.",
  });
}

async function advanceJob(job: WorkerJob, engine: EnginePort, db: DbPort, cfg: WorkerConfig, now: () => number) {
  const started = Date.parse(job.started_at ?? job.claimed_at ?? "") || now();
  if (now() - started > cfg.jobTimeoutSeconds * 1000) throw new EngineError("ENGINE_TIMEOUT", "job exceeded timeout");

  if (!job.engine_job_id) {
    const inputUrl = await db.signInputUrl(job.storage_path, 900);
    const res = SubmitResponseSchema.safeParse(
      await engine.submitJob(
        {
          platformJobId: job.id,
          authorizationId: job.authorization_ref,
          assetId: job.id,
          inputUrl,
          inputSha256: job.original_sha256,
          requestedEngineVersion: cfg.expected.engineVersion ?? null,
          evaluationVersion: cfg.evaluationVersion ?? null,
        },
        job.id,
      ),
    );
    if (!res.success) throw new EngineError("ENGINE_RESPONSE_INVALID", "submit schema");
    if (res.data.platformJobId !== job.id) throw new EngineError("ENGINE_RESPONSE_INVALID", "platformJobId mismatch");
    const v = checkVersions(res.data, cfg.expected);
    if (v) throw new EngineError(v, "submit version policy");
    await db.updateJob(job.id, {
      engine_job_id: res.data.engineJobId,
      engine_version: res.data.engineVersion,
      research_base_version: res.data.researchBaseVersion,
      config_sha256: res.data.configSha256,
      status: "PROCESSING",
      current_stage: "Validating Image",
    });
    return;
  }

  const st = JobStatusSchema.safeParse(await engine.getJob(job.engine_job_id));
  if (!st.success) throw new EngineError("ENGINE_RESPONSE_INVALID", "status schema");
  const s = st.data;
  if (s.platformJobId !== job.id) throw new EngineError("ENGINE_RESPONSE_INVALID", "platformJobId mismatch");

  if (s.status in STAGE_MAP) {
    const m = STAGE_MAP[s.status];
    await db.updateJob(job.id, { status: m.status, current_stage: m.stage });
    return;
  }
  if (s.status === "CANCELLED") {
    await db.updateJob(job.id, { status: "CANCELLED", error_message: "Processing was cancelled." });
    return;
  }
  if (s.status === "FAILED_SYSTEM") {
    const reasons = s.preflightReasonCodes ?? [];
    if (reasons.length > 0 && reasons.every((r) => PREFLIGHT_CODES.has(r))) {
      // Legitimate technical outcome: the image cannot be protected.
      await db.updateJob(job.id, { status: "FAIL", reason_codes: reasons, current_stage: null });
      return;
    }
    const code = reasons.includes("AUTHORIZATION_INVALID") ? "AUTHORIZATION_INVALID" : (s.errorCode ?? "ENGINE_UNAVAILABLE");
    await db.report(null, { job_id: job.id, error_code: code, detail: "engine reported system failure" });
    await failSystem(db, job.id, code);
    return;
  }

  // COMPLETED — accept only a valid manifest with matching hashes.
  const check = validateManifest(s.manifest, job, { engineVersion: job.engine_version, configSha256: job.config_sha256 }, cfg.expected);
  if (!check.ok) throw new EngineError(check.code, check.detail);
  const m = check.manifest;
  const decision = mapDecision(m.decision);
  if (!decision) throw new EngineError("MANIFEST_INVALID", "decision");

  let protectedPath: string | null = null;
  if (m.protected_asset_sha256) {
    if (!s.outputUrl) throw new EngineError("MANIFEST_INVALID", "missing output");
    let bytes: Uint8Array;
    try {
      bytes = await engine.download(s.outputUrl);
    } catch {
      throw new EngineError("ENGINE_UNAVAILABLE", "output download failed");
    }
    if ((await sha256Hex(bytes)) !== m.protected_asset_sha256) throw new EngineError("OUTPUT_HASH_MISMATCH", "protected hash mismatch");
    try {
      protectedPath = await db.uploadProtected(job.user_id, job.id, bytes);
    } catch {
      throw new EngineError("STORAGE_WRITE_FAILED", "upload failed");
    }
  }

  await db.updateJob(
    job.id,
    {
      status: decision,
      current_stage: null,
      protected_storage_path: protectedPath,
      protected_sha256: m.protected_asset_sha256,
      certificate_id: decision === "FAIL" ? null : (m.certificate_id ?? `EIP-${job.id.slice(0, 8).toUpperCase()}`),
      evaluation_version: m.evaluation_version,
      reason_codes: m.reason_codes,
      manifest: m,
    },
    {
      evaluation_version: m.evaluation_version,
      is_initial: true,
      status: decision,
      visual_quality: m.summary?.visual_quality ?? null,
      transformation_robustness: m.summary?.transformation_robustness ?? null,
      identity_evaluation: m.summary?.identity_evaluation ?? null,
      reason_codes: m.reason_codes,
    },
  );
}

async function advanceReeval(r: Reeval, engine: EnginePort, db: DbPort, cfg: WorkerConfig) {
  if (!r.protected_storage_path || !r.protected_sha256) throw new EngineError("EVALUATION_INCOMPLETE", "no protected asset");
  if (!r.engine_evaluation_id) {
    const url = await db.signInputUrl(r.protected_storage_path, 900);
    const res = (await engine.submitEvaluation(
      { platformJobId: r.job_id, reevaluationId: r.id, protectedUrl: url, protectedSha256: r.protected_sha256, evaluationVersion: cfg.evaluationVersion ?? null },
      r.id,
    )) as { engineEvaluationId?: string };
    if (!res?.engineEvaluationId) throw new EngineError("ENGINE_RESPONSE_INVALID", "evaluation submit");
    await db.updateReeval(r.id, "PROCESSING", res.engineEvaluationId, null, null);
    return;
  }
  const st = EvaluationStatusSchema.safeParse(await engine.getEvaluation(r.engine_evaluation_id));
  if (!st.success) throw new EngineError("ENGINE_RESPONSE_INVALID", "evaluation schema");
  if (st.data.status === "QUEUED" || st.data.status === "EVALUATING") {
    await db.updateReeval(r.id, "PROCESSING", null, null, null);
    return;
  }
  if (st.data.status === "FAILED_SYSTEM" || !st.data.evaluation) throw new EngineError("EVALUATION_INCOMPLETE", st.data.errorCode ?? "no evaluation");
  const ev = st.data.evaluation;
  if (ev.protected_asset_sha256 !== r.protected_sha256) throw new EngineError("OUTPUT_HASH_MISMATCH", "evaluated asset hash mismatch");
  await db.updateReeval(r.id, "DONE", null, null, {
    evaluation_version: ev.evaluation_version,
    status: ev.decision,
    visual_quality: ev.summary?.visual_quality ?? null,
    transformation_robustness: ev.summary?.transformation_robustness ?? null,
    identity_evaluation: ev.summary?.identity_evaluation ?? null,
    reason_codes: ev.reason_codes,
  });
}

/** Sanitized technical detail for the admin log: no URLs, tokens or stack traces. */
export function sanitize(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .split("\n")[0]
    .slice(0, 300);
}
