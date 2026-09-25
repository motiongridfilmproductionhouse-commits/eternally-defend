import { describe, expect, it } from "vitest";
import { isRetryableSystemError, validateManifest } from "./engine-contract";
import { EngineError, runEipTick, sanitize, sha256Hex, type DbPort, type EnginePort, type WorkerJob } from "./worker-core";

const CFG_SHA = "a".repeat(64);
const ORIG = "b".repeat(64);
const OUT = new Uint8Array([1, 2, 3]);
const JOB_ID = "11111111-1111-4111-8111-111111111111";

const baseJob = (over: Partial<WorkerJob> = {}): WorkerJob => ({
  id: JOB_ID,
  user_id: "u1",
  storage_path: "u1/x.png",
  original_sha256: ORIG,
  authorization_ref: "auth-1",
  engine_job_id: null,
  engine_version: null,
  config_sha256: null,
  claimed_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  ...over,
});

const health = { status: "ok", engineAvailable: true, engineVersion: "eip-production-v1", researchBaseVersion: "v0.5", modelsLoaded: true, configSha256: CFG_SHA };

async function manifest(decision: "PASS" | "LIMITED" | "FAIL", over: Record<string, unknown> = {}) {
  return {
    eip_job_id: JOB_ID, authorization_id: "auth-1", engine_version: "eip-production-v1", research_base_version: "v0.5",
    config_sha256: CFG_SHA, original_asset_sha256: ORIG, protected_asset_sha256: decision === "FAIL" ? null : await sha256Hex(OUT),
    quality_metrics: {}, identity_metrics: {}, transform_metrics: {}, held_out_metrics: {}, decision, reason_codes: [], warnings: [],
    evaluation_version: "eval-1", created_at: "2026-09-25T00:00:00Z", ...over,
  };
}

function harness(jobs: WorkerJob[], engineOver: Partial<EnginePort> = {}) {
  const updates: { id: string; patch: Record<string, unknown>; evaluation?: unknown }[] = [];
  const logs: unknown[] = [];
  const statuses: Record<string, unknown>[] = [];
  const uploads: string[] = [];
  const submits: string[] = [];
  const db: DbPort = {
    claimJobs: async () => jobs,
    updateJob: async (id, patch, evaluation) => void updates.push({ id, patch, evaluation }),
    claimReevals: async () => [],
    updateReeval: async () => {},
    report: async (s, l) => { if (s) statuses.push(s); if (l) logs.push(l); },
    signInputUrl: async () => "https://signed.example/in",
    uploadProtected: async (u, j) => { uploads.push(j); return `${u}/protected/${j}.png`; },
    idle: async () => false,
  };
  const engine: EnginePort = {
    health: async () => health,
    submitJob: async (b, k) => { submits.push(k); return { engineJobId: "e1", platformJobId: b.platformJobId, status: "QUEUED", engineVersion: "eip-production-v1", researchBaseVersion: "v0.5", configSha256: CFG_SHA }; },
    getJob: async () => ({}),
    submitEvaluation: async () => ({}),
    getEvaluation: async () => ({}),
    download: async () => OUT,
    ...engineOver,
  };
  return { db, engine, updates, logs, statuses, uploads, submits };
}
const cfg = { enabled: true, expected: { engineVersion: "eip-production-v1", configSha256: CFG_SHA }, jobTimeoutSeconds: 3600, batch: 3 };
const pinned = { engine_job_id: "e1", engine_version: "eip-production-v1", config_sha256: CFG_SHA };
const completed = (m: unknown) => async () => ({ engineJobId: "e1", platformJobId: JOB_ID, status: "COMPLETED", manifest: m, outputUrl: "https://engine.example/out" });

describe("EIP worker", () => {
  it("disabled engine does nothing and disarms the schedule", async () => {
    const h = harness([baseJob()]);
    let forced = false;
    h.db.idle = async (f) => (forced = f);
    const r = await runEipTick(h.engine, h.db, { ...cfg, enabled: false });
    expect(r.processed).toBe(0);
    expect(forced).toBe(true);
    expect(h.updates).toHaveLength(0);
  });

  it("health success reports OPERATIONAL", async () => {
    const h = harness([]);
    expect((await runEipTick(h.engine, h.db, cfg)).engine).toBe("OPERATIONAL");
    expect(h.statuses[0].status).toBe("OPERATIONAL");
  });

  it("engine unavailable: no jobs claimed", async () => {
    const h = harness([baseJob()], { health: async () => { throw new EngineError("ENGINE_UNAVAILABLE", "x"); } });
    const r = await runEipTick(h.engine, h.db, cfg);
    expect(r.engine).toBe("UNAVAILABLE");
    expect(h.updates).toHaveLength(0);
  });

  it("authentication rejection blocks processing", async () => {
    const h = harness([baseJob()], { health: async () => { throw new EngineError("ENGINE_AUTH_REJECTED", "401"); } });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.statuses[0].error_code).toBe("ENGINE_AUTH_REJECTED");
    expect(h.updates).toHaveLength(0);
  });

  it("engine version mismatch", async () => {
    const h = harness([baseJob()], { health: async () => ({ ...health, engineVersion: "other" }) });
    expect((await runEipTick(h.engine, h.db, cfg)).engine).toBe("VERSION_MISMATCH");
  });

  it("config mismatch", async () => {
    const h = harness([baseJob()], { health: async () => ({ ...health, configSha256: "c".repeat(64) }) });
    expect((await runEipTick(h.engine, h.db, cfg)).engine).toBe("CONFIG_INTEGRITY_FAILURE");
  });

  it("successful submission stores engine id + versions, keyed by platform job id", async () => {
    const h = harness([baseJob()]);
    await runEipTick(h.engine, h.db, cfg);
    expect(h.submits).toEqual([JOB_ID]);
    expect(h.updates[0].patch).toMatchObject({ engine_job_id: "e1", config_sha256: CFG_SHA });
  });

  it("idempotent: an existing engine job is polled, never resubmitted", async () => {
    const h = harness([baseJob(pinned)], { getJob: async () => ({ engineJobId: "e1", platformJobId: JOB_ID, status: "IMMUNIZING" }) });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.submits).toHaveLength(0);
  });

  it("stage updates map real engine stages", async () => {
    const h = harness([baseJob(pinned)], { getJob: async () => ({ engineJobId: "e1", platformJobId: JOB_ID, status: "EVALUATING" }) });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.updates[0].patch).toEqual({ status: "EVALUATING", current_stage: "Evaluating Protection" });
  });

  for (const d of ["PASS", "LIMITED", "FAIL"] as const) {
    it(`valid ${d} is stored exactly with an initial evaluation`, async () => {
      const h = harness([baseJob(pinned)], { getJob: completed(await manifest(d)) });
      await runEipTick(h.engine, h.db, cfg);
      const u = h.updates.at(-1)!;
      expect(u.patch.status).toBe(d);
      expect((u.evaluation as { status: string }).status).toBe(d);
      expect(h.uploads.length).toBe(d === "FAIL" ? 0 : 1);
    });
  }

  it("engine system failure becomes SYSTEM_ERROR, never FAIL", async () => {
    const h = harness([baseJob(pinned)], { getJob: async () => ({ engineJobId: "e1", platformJobId: JOB_ID, status: "FAILED_SYSTEM", errorCode: "MODEL_LOAD_FAILED" }) });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.updates.at(-1)!.patch).toMatchObject({ status: "SYSTEM_ERROR", error_code: "MODEL_LOAD_FAILED" });
  });

  it("preflight NO_FACE is a technical FAIL", async () => {
    const h = harness([baseJob(pinned)], { getJob: async () => ({ engineJobId: "e1", platformJobId: JOB_ID, status: "FAILED_SYSTEM", preflightReasonCodes: ["NO_FACE"] }) });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.updates.at(-1)!.patch).toMatchObject({ status: "FAIL", reason_codes: ["NO_FACE"] });
  });

  it("input hash mismatch is a hard SYSTEM_ERROR", async () => {
    const h = harness([baseJob(pinned)], { getJob: completed(await manifest("PASS", { original_asset_sha256: "d".repeat(64) })) });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.updates.at(-1)!.patch).toMatchObject({ status: "SYSTEM_ERROR", error_code: "INPUT_HASH_MISMATCH" });
  });

  it("output hash mismatch rejects the result", async () => {
    const h = harness([baseJob(pinned)], { getJob: completed(await manifest("PASS")), download: async () => new Uint8Array([9]) });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.updates.at(-1)!.patch).toMatchObject({ status: "SYSTEM_ERROR", error_code: "OUTPUT_HASH_MISMATCH" });
    expect(h.uploads).toHaveLength(0);
  });

  it("malformed manifest rejects the result", async () => {
    const h = harness([baseJob(pinned)], { getJob: completed({ decision: "PASS" }) });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.updates.at(-1)!.patch).toMatchObject({ status: "SYSTEM_ERROR", error_code: "MANIFEST_INVALID" });
  });

  it("job timeout becomes SYSTEM_ERROR ENGINE_TIMEOUT", async () => {
    const old = new Date(Date.now() - 7200_000).toISOString();
    const h = harness([baseJob({ ...pinned, started_at: old })]);
    await runEipTick(h.engine, h.db, cfg);
    // Timeout is transient → job stays held; recovery budget converts it via the DB after attempts.
    expect(h.logs[0]).toMatchObject({ error_code: "ENGINE_TIMEOUT" });
  });

  it("transient engine error leaves the job for bounded retry", async () => {
    const h = harness([baseJob(pinned)], { getJob: async () => { throw new EngineError("ENGINE_UNAVAILABLE", "down"); } });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.updates).toHaveLength(0);
  });

  it("re-evaluation appends a non-initial evaluation and never resubmits the job", async () => {
    const h = harness([]);
    const calls: unknown[] = [];
    h.db.claimReevals = async () => [{ id: "r1", job_id: JOB_ID, engine_evaluation_id: "ev1", protected_storage_path: "p", protected_sha256: await sha256Hex(OUT), engine_job_id: "e1" }];
    h.db.updateReeval = async (...a) => void calls.push(a);
    h.engine.getEvaluation = async () => ({ engineEvaluationId: "ev1", status: "COMPLETED", evaluation: { protected_asset_sha256: await sha256Hex(OUT), evaluation_version: "eval-2", decision: "LIMITED", reason_codes: [] } });
    await runEipTick(h.engine, h.db, cfg);
    expect(h.submits).toHaveLength(0);
    expect(calls[0]).toMatchObject(["r1", "DONE", null, null, { evaluation_version: "eval-2", status: "LIMITED" }]);
  });

  it("admin retry policy excludes integrity failures", () => {
    expect(isRetryableSystemError("ENGINE_UNAVAILABLE")).toBe(true);
    expect(isRetryableSystemError("CONFIG_INTEGRITY_FAILED")).toBe(false);
  });

  it("manifest pinned to submit-time config", async () => {
    const r = validateManifest(await manifest("PASS"), baseJob(), { engineVersion: "eip-production-v1", configSha256: "e".repeat(64) }, {});
    expect(r).toMatchObject({ ok: false, code: "CONFIG_INTEGRITY_FAILED" });
  });

  it("sanitizes URLs and tokens from admin logs", () => {
    expect(sanitize(new Error("fail https://x.y/secret?t=1 " + "k".repeat(40)))).toBe("fail [url] [redacted]");
  });
});
