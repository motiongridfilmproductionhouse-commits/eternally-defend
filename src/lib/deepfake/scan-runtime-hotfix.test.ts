import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  abortableSleep,
  assertNotAborted,
  boundTimeoutMs,
  createScanRuntime,
  createScanRunToken,
  isAbortError,
  mergeAbortSignals,
  readResponseText,
  ScanDeadlineError,
  ScanOwnershipLostError,
  SCAN_DEADLINE_BUFFER_MS,
} from "./scan-runtime.server";
import {
  createDiscoveryFunnelMetrics,
  decideTerminalStatus,
  finalizeScanStatus,
  hasValidScanProgress,
  recoverExpiredScanLease,
  touchScanProgress,
} from "./scan-ownership.server";
import {
  findActiveScanForIdentity,
  isUniqueViolation,
  normalizeProfileIdForIndex,
  normalizeScanTargetName,
  NULL_PROFILE_SENTINEL,
  sameActiveScanIdentity,
} from "./scan-concurrency.server";
import {
  findingPersistKey,
  upsertDiscoveriesBatch,
  upsertFindingsBatch,
} from "./scan-persist.server";
import { firecrawlSearch } from "./firecrawl.server";
import { resolveRedirectChain } from "./url-verification.server";
import { setTestDnsLookupAll } from "./url-safety.server";

type FakeRow = Record<string, unknown>;

function createFakeSupabase(initialRows: FakeRow[] = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  const calls: Array<{ op: string; patch?: FakeRow; filters?: FakeRow }> = [];

  function matches(row: FakeRow, filters: FakeRow): boolean {
    for (const [key, value] of Object.entries(filters)) {
      if (key.endsWith("__lt")) {
        const field = key.slice(0, -4);
        const left = row[field];
        if (typeof left !== "string" || left >= String(value)) return false;
        continue;
      }
      if (key.endsWith("__is")) {
        const field = key.slice(0, -4);
        if (value === null) {
          if (row[field] != null) return false;
        } else if (row[field] !== value) {
          return false;
        }
        continue;
      }
      if (row[key] !== value) return false;
    }
    return true;
  }

  function from(_table: string) {
    const state: {
      filters: FakeRow;
      patch?: FakeRow;
      op: "select" | "update" | "insert";
      limitN?: number;
      orderAsc?: boolean;
    } = {
      filters: {},
      op: "select",
    };

    const builder: any = {
      select(_cols?: string) {
        if (state.op !== "update" && state.op !== "insert") {
          state.op = "select";
        }
        return builder;
      },
      insert(payload: FakeRow | FakeRow[]) {
        state.op = "insert";
        const items = Array.isArray(payload) ? payload : [payload];
        for (const item of items) {
          const duplicate = rows.some(
            (row) =>
              row.status === "running" &&
              item.status === "running" &&
              row.user_id === item.user_id &&
              normalizeProfileIdForIndex(row.profile_id as string | null) ===
                normalizeProfileIdForIndex(item.profile_id as string | null) &&
              normalizeScanTargetName(String(item.target_name ?? "")) ===
                normalizeScanTargetName(String(row.target_name ?? "")),
          );
          if (duplicate) {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: {
                    code: "23505",
                    message:
                      "duplicate key value violates unique constraint deepfake_scans_one_active_per_target",
                  },
                }),
              }),
            };
          }
          const row = {
            id: item.id ?? crypto.randomUUID(),
            ...item,
          };
          rows.push(row);
        }
        return {
          select: () => ({
            single: async () => ({
              data: rows[rows.length - 1],
              error: null,
            }),
          }),
        };
      },
      update(patch: FakeRow) {
        state.op = "update";
        state.patch = patch;
        return builder;
      },
      eq(field: string, value: unknown) {
        state.filters[field] = value as never;
        return builder;
      },
      is(field: string, value: unknown) {
        state.filters[`${field}__is`] = value as never;
        return builder;
      },
      lt(field: string, value: unknown) {
        state.filters[`${field}__lt`] = value as never;
        return builder;
      },
      order(_field: string, opts?: { ascending?: boolean }) {
        state.orderAsc = opts?.ascending ?? true;
        return builder;
      },
      limit(n: number) {
        state.limitN = n;
        return builder;
      },
      maybeSingle: async () => {
        const matched = rows.filter((row) => matches(row, state.filters));
        return { data: matched[0] ?? null, error: null };
      },
      single: async () => {
        const matched = rows.filter((row) => matches(row, state.filters));
        return {
          data: matched[0] ?? null,
          error: matched[0] ? null : { message: "not found" },
        };
      },
      then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
        return Promise.resolve()
          .then(async () => {
            if (state.op === "update") {
              const matched = rows.filter((row) => matches(row, state.filters));
              for (const row of matched) {
                if (
                  (row.status === "completed" || row.status === "failed") &&
                  state.patch?.status === "running"
                ) {
                  throw new Error(
                    "deepfake_scans: terminal status cannot transition back to running",
                  );
                }
                if (
                  row.status === "partial" &&
                  state.patch?.status === "running" &&
                  state.filters.status !== "partial"
                ) {
                  throw new Error(
                    "deepfake_scans: partial → running is only allowed through continue_scan",
                  );
                }
                Object.assign(row, state.patch);
              }
              calls.push({
                op: "update",
                patch: state.patch,
                filters: { ...state.filters },
              });
              return { data: matched.map((row) => ({ id: row.id, status: row.status })), error: null };
            }

            let matched = rows.filter((row) => matches(row, state.filters));
            if (state.orderAsc === false) {
              matched = [...matched].reverse();
            }
            if (typeof state.limitN === "number") {
              matched = matched.slice(0, state.limitN);
            }
            calls.push({ op: "select", filters: { ...state.filters } });
            return { data: matched, error: null };
          })
          .then(resolve, reject);
      },
    };

    return builder;
  }

  return {
    from,
    rows,
    calls,
  };
}

test("terminal scan cannot be revived by late progress writes", async () => {
  const scanId = crypto.randomUUID();
  const token = createScanRunToken();
  const supabase = createFakeSupabase([
    {
      id: scanId,
      status: "failed",
      scan_run_token: null,
      user_id: "u1",
      target_name: "Honey Rose",
      profile_id: null,
    },
  ]);
  const runtime = createScanRuntime({
    hardTimeoutMs: 120_000,
    nowMs: Date.now(),
  });

  await assert.rejects(
    () =>
      touchScanProgress({
        supabase,
        ownership: { scanId, scanRunToken: token, runtime },
        patch: { total_queries: 56 },
      }),
    (error: unknown) => error instanceof ScanOwnershipLostError,
  );

  assert.equal(supabase.rows[0]?.status, "failed");
  assert.equal(supabase.rows[0]?.total_queries, undefined);
});

test("expired lease recovery marks only expired running scans failed", async () => {
  const expiredId = crypto.randomUUID();
  const freshId = crypto.randomUUID();
  const now = Date.now();
  const supabase = createFakeSupabase([
    {
      id: expiredId,
      status: "running",
      lease_expires_at: new Date(now - 1_000).toISOString(),
      scan_run_token: createScanRunToken(),
    },
    {
      id: freshId,
      status: "running",
      lease_expires_at: new Date(now + 60_000).toISOString(),
      scan_run_token: createScanRunToken(),
    },
  ]);

  const recovered = await recoverExpiredScanLease({
    supabase,
    scanId: expiredId,
    nowMs: now,
  });
  const skipped = await recoverExpiredScanLease({
    supabase,
    scanId: freshId,
    nowMs: now,
  });

  assert.equal(recovered.recovered, true);
  assert.equal(skipped.recovered, false);
  assert.equal(supabase.rows.find((r) => r.id === expiredId)?.status, "failed");
  assert.equal(supabase.rows.find((r) => r.id === freshId)?.status, "running");
});

test("valid heartbeat cannot be recovered", async () => {
  const scanId = crypto.randomUUID();
  const now = Date.now();
  const supabase = createFakeSupabase([
    {
      id: scanId,
      status: "running",
      heartbeat_at: new Date(now).toISOString(),
      lease_expires_at: new Date(now + 90_000).toISOString(),
      scan_run_token: createScanRunToken(),
    },
  ]);

  const result = await recoverExpiredScanLease({
    supabase,
    scanId,
    nowMs: now,
  });

  assert.equal(result.recovered, false);
  assert.equal(supabase.rows[0]?.status, "running");
});

test("Firecrawl retry aborts and does not continue after signal abort", async () => {
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.FIRECRAWL_API_KEY = "fc-test";

  let attempts = 0;
  const controller = new AbortController();

  globalThis.fetch = (async () => {
    attempts++;
    if (attempts === 1) {
      controller.abort(new ScanDeadlineError());
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "2" },
      });
    }
    throw new Error("should not retry after abort");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        firecrawlSearch("honey rose deepfake", 10, {
          signal: controller.signal,
          softDeadlineMs: Date.now() + 30_000,
        }),
      (error: unknown) => isAbortError(error),
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
  }
});

test("stalled response-body abort surfaces through readResponseText", async () => {
  const controller = new AbortController();
  let cancelCount = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(new TextEncoder().encode("partial"));
      // Intentionally never close — body stalls until cancelled.
      setTimeout(() => controller.abort(new ScanDeadlineError()), 10);
    },
    cancel() {
      cancelCount++;
    },
  });
  const response = new Response(stream);

  await assert.rejects(
    () => readResponseText(response, controller.signal),
    (error: unknown) => isAbortError(error),
  );
  assert.ok(cancelCount >= 1);
});

test("abort during URL verification does not retry after parent abort", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let attempts = 0;

  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  globalThis.fetch = (async () => {
    attempts++;
    controller.abort(new ScanDeadlineError());
    throw new DOMException("The operation was aborted.", "AbortError");
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        resolveRedirectChain("https://example.com/a", {
          signal: controller.signal,
          softDeadlineMs: Date.now() + 20_000,
          timeoutMs: 2_000,
        }),
      (error: unknown) => isAbortError(error),
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    setTestDnsLookupAll(null);
  }
});

test("abort during face/Hive/Gemini/evidence stages is detected by helpers", async () => {
  const runtime = createScanRuntime({ hardTimeoutMs: 120_000 });
  runtime.controller.abort(new ScanDeadlineError());

  assert.throws(
    () => assertNotAborted(runtime.signal),
    (error: unknown) => error instanceof ScanDeadlineError,
  );
  assert.equal(isAbortError(runtime.signal.reason), true);

  await assert.rejects(
    () => abortableSleep(1_000, runtime.signal),
    (error: unknown) => isAbortError(error),
  );
});

test("no retries after abort: abortableSleep rejects immediately", async () => {
  const controller = new AbortController();
  controller.abort(new ScanOwnershipLostError());
  const started = Date.now();
  await assert.rejects(
    () => abortableSleep(5_000, controller.signal),
    (error: unknown) => error instanceof ScanOwnershipLostError,
  );
  assert.ok(Date.now() - started < 500);
});

test("partial findings persist exactly once", async () => {
  const persisted = new Set<string>();
  const upserts: unknown[] = [];
  const supabase = {
    from() {
      return {
        upsert(rows: unknown[]) {
          upserts.push(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const row = {
    scan_id: "s1",
    url: "https://example.com/a",
    canonical_url: "https://example.com/a",
    final_url: "https://example.com/a",
  };

  const first = await upsertFindingsBatch({
    supabase,
    rows: [row, { ...row }],
    alreadyPersisted: persisted,
  });
  const second = await upsertFindingsBatch({
    supabase,
    rows: [row],
    alreadyPersisted: persisted,
  });

  assert.equal(first, 1);
  assert.equal(second, 0);
  assert.equal(upserts.length, 1);
  assert.equal(findingPersistKey(row), "https://example.com/a");
});

test("no-progress timeout becomes failed", () => {
  const decision = decideTerminalStatus({
    abortedByDeadline: true,
    hasValidProgress: false,
  });
  assert.equal(decision.status, "failed");
  assert.match(decision.reason ?? "", /deadline/i);

  const withProgress = decideTerminalStatus({
    abortedByDeadline: true,
    hasValidProgress: true,
  });
  assert.equal(withProgress.status, "partial");
});

test("concurrent insert race returns the correct active scan", async () => {
  const existingId = crypto.randomUUID();
  const supabase = createFakeSupabase([
    {
      id: existingId,
      user_id: "user-1",
      profile_id: null,
      target_name: "Honey Rose",
      status: "running",
      started_at: new Date().toISOString(),
    },
  ]);

  const active = await findActiveScanForIdentity({
    supabase,
    userId: "user-1",
    profileId: null,
    targetName: "  Honey Rose ",
  });
  assert.equal(active?.id, existingId);

  const insert = await supabase
    .from("deepfake_scans")
    .insert({
      user_id: "user-1",
      profile_id: null,
      target_name: "Honey Rose",
      status: "running",
    })
    .select()
    .single();

  assert.equal(isUniqueViolation(insert.error), true);

  const again = await findActiveScanForIdentity({
    supabase,
    userId: "user-1",
    profileId: null,
    targetName: "Honey Rose",
  });
  assert.equal(again?.id, existingId);
});

test("migration succeeds with duplicate RUNNING rows ranking logic", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260801070000_deepfake_scan_runtime_ownership.sql",
    ),
    "utf8",
  );

  assert.match(sql, /deepfake_scans_one_active_per_target/);
  assert.match(sql, /ROW_NUMBER\(\) OVER/);
  assert.match(sql, /lower\(btrim\(target_name\)\)/);
  assert.match(
    sql,
    /COALESCE\(profile_id, '00000000-0000-0000-0000-000000000000'::uuid\)/,
  );
  assert.match(sql, /WHERE status = 'running'/);
  assert.match(sql, /ranked\.rn > 1/);
  assert.match(sql, /prevent_terminal_revive/);
});

test("NULL profile_id normalization is sentinel-stable", () => {
  assert.equal(normalizeProfileIdForIndex(null), NULL_PROFILE_SENTINEL);
  assert.equal(normalizeProfileIdForIndex(undefined), NULL_PROFILE_SENTINEL);
  assert.equal(
    normalizeScanTargetName("  Honey  Rose "),
    "honey  rose",
  );
  assert.ok(
    sameActiveScanIdentity(
      { user_id: "u", profile_id: null, target_name: "Honey Rose" },
      { user_id: "u", profile_id: undefined, target_name: " honey rose " },
    ),
  );
  assert.equal(
    sameActiveScanIdentity(
      { user_id: "u", profile_id: null, target_name: "Honey Rose" },
      {
        user_id: "u",
        profile_id: "11111111-1111-1111-1111-111111111111",
        target_name: "Honey Rose",
      },
    ),
    false,
  );
});

test("two same-target scans cannot remain active in fake unique index", async () => {
  const supabase = createFakeSupabase([]);
  const first = await supabase
    .from("deepfake_scans")
    .insert({
      user_id: "u1",
      profile_id: null,
      target_name: "Honey Rose",
      status: "running",
    })
    .select()
    .single();
  assert.ok(first.data?.id);

  const second = await supabase
    .from("deepfake_scans")
    .insert({
      user_id: "u1",
      profile_id: null,
      target_name: "honey rose",
      status: "running",
    })
    .select()
    .single();

  assert.equal(isUniqueViolation(second.error), true);
  assert.equal(
    supabase.rows.filter((row) => row.status === "running").length,
    1,
  );
});

test("every execution path ends completed, partial or failed", async () => {
  const paths = [
    decideTerminalStatus({
      abortedByDeadline: false,
      hasValidProgress: true,
    }),
    decideTerminalStatus({
      abortedByDeadline: true,
      hasValidProgress: true,
    }),
    decideTerminalStatus({
      abortedByDeadline: true,
      hasValidProgress: false,
    }),
    decideTerminalStatus({
      abortedByDeadline: false,
      hasValidProgress: false,
      errorMessage: "provider down",
    }),
    decideTerminalStatus({
      abortedByDeadline: false,
      hasValidProgress: true,
      errorMessage: "provider down",
    }),
  ];

  for (const path of paths) {
    assert.ok(["completed", "partial", "failed"].includes(path.status));
  }

  const scanId = crypto.randomUUID();
  const token = createScanRunToken();
  const runtime = createScanRuntime({ hardTimeoutMs: 120_000 });
  const supabase = createFakeSupabase([
    {
      id: scanId,
      status: "running",
      scan_run_token: token,
    },
  ]);

  const finalized = await finalizeScanStatus({
    supabase,
    ownership: { scanId, scanRunToken: token, runtime },
    status: "partial",
    errorMessage: "deadline with progress",
  });
  assert.equal(finalized.applied, true);
  assert.equal(supabase.rows[0]?.status, "partial");
  assert.equal(supabase.rows[0]?.scan_run_token, null);

  const again = await finalizeScanStatus({
    supabase,
    ownership: { scanId, scanRunToken: token, runtime },
    status: "failed",
    errorMessage: "should stay idempotent",
  });
  assert.equal(again.applied, false);
  assert.equal(supabase.rows[0]?.status, "partial");
});

test("soft deadline leaves at least 60s before hard timeout", () => {
  const now = Date.now();
  const runtime = createScanRuntime({
    hardTimeoutMs: 300_000,
    nowMs: now,
  });
  assert.equal(
    runtime.hardDeadlineMs - runtime.softDeadlineMs,
    SCAN_DEADLINE_BUFFER_MS,
  );
  assert.ok(boundTimeoutMs(20_000, runtime.signal, runtime.softDeadlineMs, now) <= 20_000);
  assert.ok(
    mergeAbortSignals(runtime.signal, AbortSignal.timeout(1_000)).aborted ===
      false,
  );
});

test("hasValidScanProgress requires persisted discoveries or findings", async () => {
  const metrics = createDiscoveryFunnelMetrics();
  assert.equal(hasValidScanProgress({ metrics }), false);
  metrics.crawl_succeeded = 5;
  metrics.verified = 2;
  assert.equal(
    hasValidScanProgress({ metrics }),
    false,
    "in-memory crawl/classification alone must not grant PARTIAL",
  );
  assert.equal(
    hasValidScanProgress({ metrics, discoveryCount: 1 }),
    true,
  );
  assert.equal(
    hasValidScanProgress({ metrics, findingCount: 1 }),
    true,
  );

  const persisted = new Set<string>();
  const upserts: unknown[] = [];
  const supabase = {
    from() {
      return {
        upsert(rows: unknown[]) {
          upserts.push(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const first = await upsertDiscoveriesBatch({
    supabase,
    userId: "u1",
    scanId: "s1",
    targetName: "Honey Rose",
    hostOf: () => "example.com",
    alreadyPersisted: persisted,
    rows: [
      {
        canonical_url: "https://example.com/a",
        final_url: "https://example.com/a",
        query: "q",
        page_title: "t",
        page_description: "d",
      },
      {
        canonical_url: "https://example.com/a",
        final_url: "https://example.com/a",
        query: "q",
      },
    ],
  });
  const second = await upsertDiscoveriesBatch({
    supabase,
    userId: "u1",
    scanId: "s1",
    targetName: "Honey Rose",
    hostOf: () => "example.com",
    alreadyPersisted: persisted,
    rows: [
      {
        canonical_url: "https://example.com/a",
        final_url: "https://example.com/a",
        query: "q",
      },
    ],
  });

  assert.equal(first, 1);
  assert.equal(second, 0);
  assert.equal(upserts.length, 1);
});

test("migration ensures discoveries unique page index for batch upserts", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260801070000_deepfake_scan_runtime_ownership.sql",
    ),
    "utf8",
  );
  assert.match(sql, /deepfake_discoveries_unique_page/);
  assert.match(sql, /PARTITION BY scan_id, page_url/);
  assert.match(
    sql,
    /DELETE FROM public\.deepfake_discoveries AS discoveries/,
  );
  const deleteAt = sql.indexOf(
    "DELETE FROM public.deepfake_discoveries AS discoveries",
  );
  const indexAt = sql.indexOf("deepfake_discoveries_unique_page");
  assert.ok(deleteAt > 0 && indexAt > deleteAt);
});

test("scrape abort throws instead of soft-continuing", async () => {
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.FIRECRAWL_API_KEY = "fc-test";
  const controller = new AbortController();

  globalThis.fetch = (async () => {
    controller.abort(new ScanDeadlineError());
    throw new DOMException("The operation was aborted.", "AbortError");
  }) as typeof fetch;

  try {
    const { scrapeMediaFromPage } = await import("./media-discovery.server");
    await assert.rejects(
      () =>
        scrapeMediaFromPage(
          {
            url: "https://example.com/page",
            query: "q",
          },
          { signal: controller.signal, softDeadlineMs: Date.now() + 20_000 },
        ),
      (error: unknown) => isAbortError(error),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
  }
});

test("stale token cannot finalize after continuation issues a new token", async () => {
  const scanId = crypto.randomUUID();
  const oldToken = createScanRunToken();
  const newToken = createScanRunToken();
  const runtime = createScanRuntime({ hardTimeoutMs: 120_000 });
  const supabase = createFakeSupabase([
    {
      id: scanId,
      status: "running",
      scan_run_token: newToken,
      user_id: "u1",
      target_name: "Honey Rose",
    },
  ]);

  const stale = await finalizeScanStatus({
    supabase,
    ownership: { scanId, scanRunToken: oldToken, runtime },
    status: "failed",
    errorMessage: "stale invocation must not overwrite continued scan",
  });

  assert.equal(stale.applied, false);
  assert.equal(supabase.rows[0]?.status, "running");
  assert.equal(supabase.rows[0]?.scan_run_token, newToken);
  assert.equal(supabase.rows[0]?.error_message, undefined);

  await touchScanProgress({
    supabase,
    ownership: { scanId, scanRunToken: newToken, runtime },
    patch: { total_queries: 12 },
  }).catch(() => {
    /* heartbeat may still succeed */
  });

  await assert.rejects(
    () =>
      touchScanProgress({
        supabase,
        ownership: { scanId, scanRunToken: oldToken, runtime },
        patch: { total_queries: 99 },
      }),
    (error: unknown) => error instanceof ScanOwnershipLostError,
  );
  assert.notEqual(supabase.rows[0]?.total_queries, 99);
});

test("two continue-style acquires cannot both claim the same partial scan", async () => {
  const scanId = crypto.randomUUID();
  const supabase = createFakeSupabase([
    {
      id: scanId,
      status: "partial",
      scan_run_token: null,
      user_id: "u1",
      target_name: "Honey Rose",
      profile_id: null,
    },
  ]);

  const first = await supabase
    .from("deepfake_scans")
    .update({
      status: "running",
      scan_run_token: createScanRunToken(),
      finished_at: null,
    })
    .eq("id", scanId)
    .eq("status", "partial")
    .select("id");

  const second = await supabase
    .from("deepfake_scans")
    .update({
      status: "running",
      scan_run_token: createScanRunToken(),
      finished_at: null,
    })
    .eq("id", scanId)
    .eq("status", "partial")
    .select("id");

  assert.equal(first.data?.length, 1);
  assert.equal(second.data?.length, 0);
  assert.equal(supabase.rows[0]?.status, "running");
});
