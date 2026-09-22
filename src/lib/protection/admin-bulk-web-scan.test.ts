/**
 * Regression coverage for the admin-gated bulk web-discovery scan feature
 * (public web-search/discovery only — no takedown, enforcement, email,
 * face/reverse-image/deepfake module is ever invoked from this code path):
 *
 * 1. classifyBulkWebScanCandidates: case-insensitive demo-email exclusion,
 *    account-type eligibility, auth-status eligibility, duplicate-email
 *    exclusion, protection-profile/enrollment completeness, and the
 *    already-active vs. planned-for-scanning split.
 * 2. runBulkWebScanBatchCore: dry run performs zero writes; a real batch
 *    claims + processes accounts via an injected fake scan runner (no real
 *    network/provider call) and skips already-active accounts with a
 *    recorded reason; a provider/persist failure marks the account FAILED
 *    without throwing and without touching any other account; repeated
 *    batch calls with the same operationId page through the full set
 *    without reprocessing an already-claimed account; skipFaceAnalysis is
 *    always forced true for this code path.
 *
 * Runs against the same in-memory fake Postgrest-style client convention as
 * src/lib/automation/automation-jobs.test.ts — no real Supabase instance,
 * network call, or search provider involved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyBulkWebScanCandidates,
  runBulkWebScanBatchCore,
  type ClientProfileRow,
  type EnrollmentRow,
} from "./admin-bulk-web-scan.functions";

type Row = Record<string, unknown>;

/** Same minimal in-memory Postgrest-style stand-in as automation-jobs.test.ts. */
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

function profile(overrides: Partial<ClientProfileRow> = {}): ClientProfileRow {
  return {
    user_id: "user-1",
    email: "creator1@example.com",
    account_type: "individual",
    onboarding_completed: true,
    ...overrides,
  };
}

function enrollment(overrides: Partial<Row> = {}): Row {
  return {
    id: "enr-1",
    user_id: "user-1",
    module_key: "reputation_web_scan",
    eligible: true,
    enabled: true,
    current_status: "WAITING_FOR_NEXT_SCAN",
    current_run_id: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    cadence_minutes: 1440,
    retry_count: 0,
    provider_failures: 0,
    last_success_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. classifyBulkWebScanCandidates
// ---------------------------------------------------------------------------

test("classify: demo emails are excluded case-insensitively", () => {
  const profiles: ClientProfileRow[] = [
    profile({ user_id: "u-demo-1", email: "HelloSreehari@Gmail.com" }),
    profile({ user_id: "u-demo-2", email: "SIJOJ4464@GMAIL.COM" }),
    profile({ user_id: "u-real", email: "real-user@example.com" }),
  ];
  const result = classifyBulkWebScanCandidates(
    profiles,
    new Set(["u-demo-1", "u-demo-2", "u-real"]),
    new Set(["u-real"]),
    [enrollment({ id: "e-real", user_id: "u-real" }) as unknown as EnrollmentRow],
  );

  assert.equal(result.demoExcluded.length, 2);
  assert.deepEqual(result.demoExcluded.map((d) => d.user_id).sort(), ["u-demo-1", "u-demo-2"]);
  assert.equal(result.plannedForScanning.length, 1);
  assert.equal(result.plannedForScanning[0].user_id, "u-real");
});

test("classify: only the four in-scope account types are eligible", () => {
  const profiles: ClientProfileRow[] = [
    profile({ user_id: "u-individual", account_type: "individual" }),
    profile({ user_id: "u-celebrity", account_type: "celebrity", email: "b@example.com" }),
    profile({ user_id: "u-enterprise", account_type: "enterprise", email: "c@example.com" }),
    profile({ user_id: "u-production", account_type: "production_house", email: "d@example.com" }),
    profile({ user_id: "u-legacy-personal", account_type: "personal", email: "e@example.com" }),
    profile({ user_id: "u-legacy-business", account_type: "business", email: "f@example.com" }),
  ];
  const allActive = new Set(profiles.map((p) => p.user_id));
  const allHaveProfile = new Set(profiles.map((p) => p.user_id));
  const enrollments = profiles.map(
    (p) => enrollment({ id: `e-${p.user_id}`, user_id: p.user_id }) as unknown as EnrollmentRow,
  );

  const result = classifyBulkWebScanCandidates(profiles, allActive, allHaveProfile, enrollments);

  assert.equal(result.plannedForScanning.length, 4);
  assert.equal(result.accountTypeExcluded, 2);
  assert.deepEqual(result.plannedForScanning.map((p) => p.user_id).sort(), [
    "u-celebrity",
    "u-enterprise",
    "u-individual",
    "u-production",
  ]);
});

test("classify: only ACTIVE-authorization accounts are eligible", () => {
  const profiles: ClientProfileRow[] = [
    profile({ user_id: "u-active" }),
    profile({ user_id: "u-suspended", email: "b@example.com" }),
  ];
  const result = classifyBulkWebScanCandidates(
    profiles,
    new Set(["u-active"]), // only u-active has an ACTIVE authorization
    new Set(["u-active", "u-suspended"]),
    [enrollment({ id: "e-active", user_id: "u-active" }) as unknown as EnrollmentRow],
  );

  assert.equal(result.authNotActiveExcluded, 1);
  assert.equal(result.plannedForScanning.length, 1);
  assert.equal(result.plannedForScanning[0].user_id, "u-active");
});

test("classify: duplicate emails keep exactly one account and exclude the rest", () => {
  const profiles: ClientProfileRow[] = [
    profile({ user_id: "u-z", email: "shared@example.com" }),
    profile({ user_id: "u-a", email: "Shared@Example.com" }),
  ];
  const allActive = new Set(["u-z", "u-a"]);
  const allHaveProfile = new Set(["u-z", "u-a"]);
  const enrollments = [
    enrollment({ id: "e-z", user_id: "u-z" }) as unknown as EnrollmentRow,
    enrollment({ id: "e-a", user_id: "u-a" }) as unknown as EnrollmentRow,
  ];

  const result = classifyBulkWebScanCandidates(profiles, allActive, allHaveProfile, enrollments);

  assert.equal(result.duplicateEmailExcluded.length, 1);
  assert.equal(
    result.duplicateEmailExcluded[0].user_id,
    "u-z",
    "lexicographically later user_id is excluded",
  );
  assert.equal(result.plannedForScanning.length, 1);
  assert.equal(result.plannedForScanning[0].user_id, "u-a");
});

test("classify: incomplete protection setup is reported, not silently dropped", () => {
  const profiles: ClientProfileRow[] = [
    profile({ user_id: "u-no-profile" }),
    profile({ user_id: "u-no-enrollment", email: "b@example.com" }),
    profile({ user_id: "u-module-disabled", email: "c@example.com" }),
  ];
  const allActive = new Set(profiles.map((p) => p.user_id));
  const hasProtectionProfile = new Set(["u-no-enrollment", "u-module-disabled"]); // u-no-profile lacks one
  const enrollments = [
    enrollment({
      id: "e-disabled",
      user_id: "u-module-disabled",
      eligible: false,
    }) as unknown as EnrollmentRow,
  ]; // u-no-enrollment has no row at all

  const result = classifyBulkWebScanCandidates(
    profiles,
    allActive,
    hasProtectionProfile,
    enrollments,
  );

  assert.deepEqual(result.noProtectionProfile, ["u-no-profile"]);
  assert.deepEqual(result.noEnrollmentRow, ["u-no-enrollment"]);
  assert.deepEqual(result.moduleNotEligible, ["u-module-disabled"]);
  assert.equal(result.plannedForScanning.length, 0);
});

test("classify: QUEUED/RUNNING enrollments are already-active, not planned", () => {
  const profiles: ClientProfileRow[] = [
    profile({ user_id: "u-queued" }),
    profile({ user_id: "u-running", email: "b@example.com" }),
    profile({ user_id: "u-waiting", email: "c@example.com" }),
  ];
  const allActive = new Set(profiles.map((p) => p.user_id));
  const hasProfile = new Set(profiles.map((p) => p.user_id));
  const enrollments = [
    enrollment({
      id: "e-q",
      user_id: "u-queued",
      current_status: "QUEUED",
    }) as unknown as EnrollmentRow,
    enrollment({
      id: "e-r",
      user_id: "u-running",
      current_status: "RUNNING",
    }) as unknown as EnrollmentRow,
    enrollment({
      id: "e-w",
      user_id: "u-waiting",
      current_status: "WAITING_FOR_NEXT_SCAN",
    }) as unknown as EnrollmentRow,
  ];

  const result = classifyBulkWebScanCandidates(profiles, allActive, hasProfile, enrollments);

  assert.equal(result.alreadyActive.length, 2);
  assert.deepEqual(result.alreadyActive.map((a) => a.user_id).sort(), ["u-queued", "u-running"]);
  assert.equal(result.plannedForScanning.length, 1);
  assert.equal(result.plannedForScanning[0].user_id, "u-waiting");
});

// ---------------------------------------------------------------------------
// 2. runBulkWebScanBatchCore
// ---------------------------------------------------------------------------

function seedTwoEligibleAccounts(): Record<string, Row[]> {
  return {
    client_profiles: [
      profile({ user_id: "user-1", email: "one@example.com" }),
      profile({ user_id: "user-2", email: "two@example.com" }),
    ] as unknown as Row[],
    client_authorizations: [
      { user_id: "user-1", status: "ACTIVE" },
      { user_id: "user-2", status: "ACTIVE" },
    ],
    protection_profiles: [{ user_id: "user-1" }, { user_id: "user-2" }],
    scan_module_enrollments: [
      enrollment({ id: "enr-1", user_id: "user-1" }),
      enrollment({ id: "enr-2", user_id: "user-2" }),
    ],
  };
}

test("runBulkWebScanBatchCore: dry run performs zero writes and never calls the scan runner", async () => {
  const supabase = createFakeSupabase(seedTwoEligibleAccounts());
  let scanCalls = 0;
  const runReputationWebScan = async () => {
    scanCalls++;
    return { status: "COMPLETED", candidates_found: 1, verified_findings: 0, blocked_reason: null };
  };

  const result = await runBulkWebScanBatchCore(
    supabase,
    { operationId: "op-1", batchSize: 10, dryRun: true },
    { runReputationWebScan },
  );

  assert.equal(scanCalls, 0, "dry run must never invoke the scan runner");
  assert.equal(result.claimed, 0);
  assert.equal(result.processed.length, 0);
  assert.equal(result.skipped.length, 2, "both planned accounts reported as would-be-claimed");

  const rows = supabase.db.get("scan_module_enrollments")!;
  assert.equal(
    rows[0].current_status,
    "WAITING_FOR_NEXT_SCAN",
    "dry run must not mutate enrollment rows",
  );
  assert.equal(rows[1].current_status, "WAITING_FOR_NEXT_SCAN");
  assert.equal(rows[0].current_run_id, null);
});

test("runBulkWebScanBatchCore: a real batch claims and processes eligible accounts, forcing skipFaceAnalysis", async () => {
  const supabase = createFakeSupabase(seedTwoEligibleAccounts());
  const seenOpts: Array<{ skipFaceAnalysis?: boolean }> = [];
  const runReputationWebScan = async (
    _supabaseAdmin: unknown,
    _userId: string,
    opts: { skipFaceAnalysis?: boolean },
  ) => {
    seenOpts.push(opts);
    return { status: "COMPLETED", candidates_found: 3, verified_findings: 1, blocked_reason: null };
  };

  const result = await runBulkWebScanBatchCore(
    supabase,
    { operationId: "op-1", batchSize: 10, dryRun: false },
    { runReputationWebScan },
  );

  assert.equal(result.claimed, 2);
  assert.equal(result.processed.length, 2);
  assert.ok(
    seenOpts.every((o) => o.skipFaceAnalysis === true),
    "face analysis must always be skipped here",
  );

  const rows = supabase.db.get("scan_module_enrollments")!;
  for (const row of rows) {
    assert.equal(row.current_status, "COMPLETED");
    assert.equal(row.current_run_id, "op-1");
    assert.equal(row.candidates_found, 3);
  }
  assert.equal(result.remainingAfterThisBatch, 0);
});

test("runBulkWebScanBatchCore: an already-active enrollment is skipped, not claimed, and never scanned", async () => {
  const seed = seedTwoEligibleAccounts();
  (seed.scan_module_enrollments[1] as Row).current_status = "RUNNING";
  const supabase = createFakeSupabase(seed);
  const scannedUserIds: string[] = [];
  const runReputationWebScan = async (_s: unknown, userId: string) => {
    scannedUserIds.push(userId);
    return { status: "COMPLETED", candidates_found: 0, verified_findings: 0, blocked_reason: null };
  };

  const result = await runBulkWebScanBatchCore(
    supabase,
    { operationId: "op-1", batchSize: 10, dryRun: false },
    { runReputationWebScan },
  );

  assert.deepEqual(scannedUserIds, ["user-1"], "the already-RUNNING account must never be scanned");
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /already running/);
  assert.equal(result.skipped[0].user_id, "user-2");

  const rows = supabase.db.get("scan_module_enrollments")!;
  const user2Row = rows.find((r) => r.user_id === "user-2")!;
  assert.equal(user2Row.current_status, "RUNNING", "skipped row must be left untouched");
  assert.equal(user2Row.current_run_id, null);
});

test("runBulkWebScanBatchCore: a scan/persist failure marks only that account FAILED and never throws", async () => {
  const supabase = createFakeSupabase(seedTwoEligibleAccounts());
  const runReputationWebScan = async (_s: unknown, userId: string) => {
    if (userId === "user-1") throw new Error("provider timeout");
    return { status: "COMPLETED", candidates_found: 2, verified_findings: 0, blocked_reason: null };
  };

  const result = await runBulkWebScanBatchCore(
    supabase,
    { operationId: "op-1", batchSize: 10, dryRun: false },
    { runReputationWebScan },
  );

  assert.equal(result.processed.length, 2);
  const user1Result = result.processed.find((p) => p.user_id === "user-1")!;
  const user2Result = result.processed.find((p) => p.user_id === "user-2")!;
  assert.equal(user1Result.status, "FAILED");
  assert.match(user1Result.blocked_reason ?? "", /provider timeout/);
  assert.equal(
    user2Result.status,
    "COMPLETED",
    "one account's failure must not affect another's outcome",
  );

  const rows = supabase.db.get("scan_module_enrollments")!;
  const user1Row = rows.find((r) => r.user_id === "user-1")!;
  assert.equal(user1Row.current_status, "FAILED");
  assert.equal(user1Row.retry_count, 1);
});

test("runBulkWebScanBatchCore: repeated calls with the same operationId page through without reprocessing", async () => {
  const supabase = createFakeSupabase(seedTwoEligibleAccounts());
  let scanCalls = 0;
  const runReputationWebScan = async () => {
    scanCalls++;
    return { status: "COMPLETED", candidates_found: 0, verified_findings: 0, blocked_reason: null };
  };

  const first = await runBulkWebScanBatchCore(
    supabase,
    { operationId: "op-1", batchSize: 1, dryRun: false },
    { runReputationWebScan },
  );
  assert.equal(first.claimed, 1);
  assert.equal(first.remainingAfterThisBatch, 1);

  const second = await runBulkWebScanBatchCore(
    supabase,
    { operationId: "op-1", batchSize: 1, dryRun: false },
    { runReputationWebScan },
  );
  assert.equal(second.claimed, 1);
  assert.equal(second.remainingAfterThisBatch, 0);

  const third = await runBulkWebScanBatchCore(
    supabase,
    { operationId: "op-1", batchSize: 1, dryRun: false },
    { runReputationWebScan },
  );
  assert.equal(third.claimed, 0, "nothing left for this operationId to claim");
  assert.equal(scanCalls, 2, "each account scanned exactly once across the whole operation");
});
