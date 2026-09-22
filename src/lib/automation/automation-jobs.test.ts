/**
 * Regression coverage for the three confirmed automation_jobs defects:
 *
 * 1. Late-callback terminal-state protection (status-callback.server.ts).
 * 2. Worker-restart zombie-callback race: a stale-recovered job must not be
 *    resurrected by a late callback from the pre-restart worker instance
 *    (combines status-callback.server.ts + job-recovery.server.ts).
 * 3. Stale-job recovery (job-recovery.server.ts).
 * 4. Duplicate-safe repeated recovery (job-recovery.server.ts idempotency).
 *
 * Runs against a small in-memory fake Postgrest-style client rather than a
 * real Supabase instance, so it exercises the actual WHERE-clause
 * compare-and-swap semantics the production code relies on (not a
 * reimplementation of the logic under test).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyAutomationStatusCallback } from "./status-callback.server";
import { recoverStaleAutomationJobs, AUTOMATION_JOB_STALE_TTL_MS } from "./job-recovery.server";

type Row = Record<string, unknown>;

/**
 * Minimal in-memory stand-in for the subset of supabase-js's query builder
 * used by status-callback.server.ts and job-recovery.server.ts:
 * select/eq/in/lt/maybeSingle for reads, update/eq/in/lt/select for
 * compare-and-swap writes, and insert for audit rows. Thenable so
 * `await supabase.from(t).select(...).eq(...)` resolves without an explicit
 * terminal call, matching real PostgrestFilterBuilder behavior.
 */
class FakeQueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private mode: "select" | "update" | "insert" = "select";
  private updatePatch: Row | null = null;
  private single = false;

  constructor(
    private readonly table: string,
    private readonly db: Map<string, Row[]>,
  ) {}

  select(_cols?: string) {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: readonly unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  lt(col: string, val: string) {
    this.filters.push((r) => typeof r[col] === "string" && (r[col] as string) < val);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.updatePatch = patch;
    return this;
  }
  insert(row: Row) {
    this.mode = "insert";
    const rows = this.db.get(this.table) ?? [];
    rows.push({ ...row });
    this.db.set(this.table, rows);
    return Promise.resolve({ data: [{ ...row }], error: null });
  }
  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    this.single = true;
    return this.exec() as Promise<{ data: Row | null; error: null }>;
  }
  then<T1 = { data: unknown; error: null }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  private async exec(): Promise<{ data: unknown; error: null }> {
    const rows = this.db.get(this.table) ?? [];
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));

    if (this.mode === "update") {
      for (const row of matched) Object.assign(row, this.updatePatch);
      return { data: matched.map((r) => ({ ...r })), error: null };
    }
    if (this.single) {
      return { data: matched[0] ? { ...matched[0] } : null, error: null };
    }
    return { data: matched.map((r) => ({ ...r })), error: null };
  }
}

function createFakeSupabase(seed: Record<string, Row[]>) {
  const db = new Map<string, Row[]>(
    Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
  );
  return {
    db,
    from(table: string) {
      return new FakeQueryBuilder(table, db);
    },
  };
}

function seedJob(overrides: Partial<Row> = {}): Row {
  return {
    id: "job-1",
    user_id: "user-1",
    enforcement_request_id: "req-1",
    platform: "youtube",
    adapter: "youtube_copyright",
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Late-callback terminal-state protection
// ---------------------------------------------------------------------------

test("late callback: a review_ready callback arriving after cancellation does not resurrect the job", async () => {
  const supabase = createFakeSupabase({
    automation_jobs: [seedJob({ status: "cancelled", completed_at: "2026-01-01T00:00:00.000Z" })],
    automation_events: [],
    enforcement_requests: [{ id: "req-1", automation_status: "cancelled" }],
  });

  const result = await applyAutomationStatusCallback(supabase, {
    job_id: "job-1",
    event: "review_generated",
    status: "review_ready",
    review_summary: { some: "summary" },
  });

  assert.deepEqual(result, { ok: true });

  const job = supabase.db.get("automation_jobs")![0];
  assert.equal(
    job.status,
    "cancelled",
    "terminal status must not be overwritten by a late callback",
  );
  assert.equal(
    job.review_summary_json,
    undefined,
    "late-callback fields must not be applied to the row",
  );

  const enforcementRequest = supabase.db.get("enforcement_requests")![0];
  assert.equal(
    enforcementRequest.automation_status,
    "cancelled",
    "mirror must not be overwritten either",
  );

  const events = supabase.db.get("automation_events")!;
  assert.equal(events.length, 1, "the late callback must still be recorded for audit purposes");
  const payload = events[0].payload_json as Record<string, unknown>;
  assert.equal(payload.late_callback, true);
  assert.equal(payload.job_status_at_receipt, "cancelled");
  assert.equal(payload.attempted_status, "review_ready");
});

test("normal callback: a review_ready callback for a still-running job is applied", async () => {
  const supabase = createFakeSupabase({
    automation_jobs: [seedJob({ status: "running" })],
    automation_events: [],
    enforcement_requests: [{ id: "req-1", automation_status: "running" }],
  });

  const result = await applyAutomationStatusCallback(supabase, {
    job_id: "job-1",
    event: "review_generated",
    status: "review_ready",
    review_summary: { ok: true },
  });

  assert.deepEqual(result, { ok: true });
  const job = supabase.db.get("automation_jobs")![0];
  assert.equal(job.status, "review_ready");
  assert.deepEqual(job.review_summary_json, { ok: true });

  const enforcementRequest = supabase.db.get("enforcement_requests")![0];
  assert.equal(enforcementRequest.automation_status, "review_ready");

  const events = supabase.db.get("automation_events")!;
  assert.equal(events.length, 1);
  const payload = events[0].payload_json as Record<string, unknown>;
  assert.equal(payload.late_callback, undefined);
});

// ---------------------------------------------------------------------------
// 2. Worker restart: a zombie pre-restart worker must not resurrect a job
//    that stale-recovery already marked failed.
// ---------------------------------------------------------------------------

test("worker restart: a zombie worker's late review_ready cannot undo stale recovery", async () => {
  const staleStartedAt = new Date(Date.now() - AUTOMATION_JOB_STALE_TTL_MS - 60_000).toISOString();
  const supabase = createFakeSupabase({
    automation_jobs: [seedJob({ status: "running", started_at: staleStartedAt })],
    automation_events: [],
    enforcement_requests: [{ id: "req-1", automation_status: "running" }],
  });

  // The enforcement-worker cron sweep recovers the job while the old worker
  // process (pre-restart) is still off doing Playwright work, unaware.
  const recoveredCount = await recoverStaleAutomationJobs({ supabase });
  assert.equal(recoveredCount, 1);
  assert.equal(supabase.db.get("automation_jobs")![0].status, "failed");

  // The zombie worker instance finally finishes and calls back as if nothing
  // happened — this must not resurrect the job.
  const result = await applyAutomationStatusCallback(supabase, {
    job_id: "job-1",
    event: "review_generated",
    status: "review_ready",
    review_summary: { zombie: true },
  });

  assert.deepEqual(result, { ok: true });
  const job = supabase.db.get("automation_jobs")![0];
  assert.equal(
    job.status,
    "failed",
    "stale-recovered job must stay failed despite the zombie callback",
  );
  assert.equal(job.review_summary_json, undefined);

  const lateEvent = supabase.db
    .get("automation_events")!
    .find((e) => e.event === "review_generated");
  assert.ok(lateEvent, "the zombie callback is still recorded for audit purposes");
  assert.equal((lateEvent!.payload_json as Record<string, unknown>).late_callback, true);
});

// ---------------------------------------------------------------------------
// 3. Stale-job recovery
// ---------------------------------------------------------------------------

test("stale recovery: a job stuck running past the TTL is marked failed with an audit trail", async () => {
  const staleStartedAt = new Date(Date.now() - AUTOMATION_JOB_STALE_TTL_MS - 1_000).toISOString();
  const supabase = createFakeSupabase({
    automation_jobs: [seedJob({ status: "running", started_at: staleStartedAt })],
    automation_events: [],
    enforcement_requests: [{ id: "req-1", automation_status: "running" }],
  });

  const recovered = await recoverStaleAutomationJobs({ supabase });
  assert.equal(recovered, 1);

  const job = supabase.db.get("automation_jobs")![0];
  assert.equal(job.status, "failed");
  assert.ok(job.completed_at);
  assert.equal((job.error_json as Record<string, unknown>).code, "stale_recovery");

  const enforcementRequest = supabase.db.get("enforcement_requests")![0];
  assert.equal(enforcementRequest.automation_status, "failed");

  const events = supabase.db.get("automation_events")!;
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "stale_job_recovered");
});

test("stale recovery: a recently-started running job is left alone", async () => {
  const supabase = createFakeSupabase({
    automation_jobs: [seedJob({ status: "running", started_at: new Date().toISOString() })],
    automation_events: [],
    enforcement_requests: [{ id: "req-1", automation_status: "running" }],
  });

  const recovered = await recoverStaleAutomationJobs({ supabase });
  assert.equal(recovered, 0);
  assert.equal(supabase.db.get("automation_jobs")![0].status, "running");
});

// ---------------------------------------------------------------------------
// 4. Duplicate-safe repeated recovery
// ---------------------------------------------------------------------------

test("duplicate-safe: running the recovery sweep twice only recovers the job once", async () => {
  const staleStartedAt = new Date(Date.now() - AUTOMATION_JOB_STALE_TTL_MS - 1_000).toISOString();
  const supabase = createFakeSupabase({
    automation_jobs: [seedJob({ status: "running", started_at: staleStartedAt })],
    automation_events: [],
    enforcement_requests: [{ id: "req-1", automation_status: "running" }],
  });

  const first = await recoverStaleAutomationJobs({ supabase });
  const second = await recoverStaleAutomationJobs({ supabase });

  assert.equal(first, 1);
  assert.equal(second, 0, "a repeat sweep must not re-recover an already-recovered job");

  const events = supabase.db
    .get("automation_events")!
    .filter((e) => e.event === "stale_job_recovered");
  assert.equal(events.length, 1, "no duplicate audit row from the repeat sweep");
});

test("duplicate-safe: two concurrent sweeps only recover the job once", async () => {
  const staleStartedAt = new Date(Date.now() - AUTOMATION_JOB_STALE_TTL_MS - 1_000).toISOString();
  const supabase = createFakeSupabase({
    automation_jobs: [seedJob({ status: "running", started_at: staleStartedAt })],
    automation_events: [],
    enforcement_requests: [{ id: "req-1", automation_status: "running" }],
  });

  const [a, b] = await Promise.all([
    recoverStaleAutomationJobs({ supabase }),
    recoverStaleAutomationJobs({ supabase }),
  ]);

  assert.equal(a + b, 1, "exactly one of the two concurrent sweeps recovers the job");

  const events = supabase.db
    .get("automation_events")!
    .filter((e) => e.event === "stale_job_recovered");
  assert.equal(events.length, 1);
});
