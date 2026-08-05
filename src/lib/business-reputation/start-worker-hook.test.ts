/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { startBusinessReputationScanCore } from "../business-reputation.functions";
import { executeBusinessReputationScan } from "./scan-worker.server";
import { handleBusinessReputationWorkerRequest } from "../../routes/api/public/hooks/business-reputation-scan-execute";

const input = {
  query: "Acme Coffee",
  aliases: ["Acme Cafe"],
  variations: [],
  hashtags: [],
  handles: ["@acme"],
  site: "https://acmecoffee.com",
  country: "US",
  industry: "coffee",
  monthFilter: "12m" as const,
  sources: ["web", "youtube"],
};
const profile = {
  resolved: true,
  resolvedBrandName: "Acme Coffee",
  placeId: "place-1",
  website: "https://acmecoffee.com",
  formattedAddress: "Austin, TX",
  businessTypes: ["cafe"],
};

function fakeSupabase(scanId = "scan-1", status = "running") {
  const calls: Array<{ table: string; operation: string; payload?: any }> = [];
  const scan = {
    id: scanId,
    user_id: "user-a",
    status,
    scan_type: "business_reputation",
    scan_run_token: "00000000-0000-4000-8000-000000000001",
    query_plan: { subject: "Acme Coffee", aliases: [], handles: [] },
    brand_profile: { ...profile, scope: "brand", aliases: [] },
  };
  const client = {
    calls,
    from(table: string) {
      const state: any = { table, filters: {} };
      const chain: any = {
        insert: (payload: any) => {
          calls.push({ table, operation: "insert", payload });
          return chain;
        },
        update: (payload: any) => {
          calls.push({ table, operation: "update", payload });
          return chain;
        },
        select: () => chain,
        eq: (key: string, value: any) => {
          state.filters[key] = value;
          return chain;
        },
        maybeSingle: async () => ({ data: table === "scans" ? scan : null, error: null }),
        single: async () => ({ data: { id: scanId }, error: null }),
        upsert: (payload: any) => {
          calls.push({ table, operation: "upsert", payload });
          return chain;
        },
        then: (resolve: (value: any) => unknown) =>
          resolve({ data: state.operation === "update" ? [{ id: scanId }] : null, error: null }),
      };
      state.operation = "select";
      const originalUpdate = chain.update;
      chain.update = (payload: any) => {
        state.operation = "update";
        return originalUpdate(payload);
      };
      return chain;
    },
  };
  return client;
}

test("scan creation rejects an unconfirmed profile", async () =>
  await assert.rejects(
    () =>
      startBusinessReputationScanCore({
        supabase: fakeSupabase(),
        userId: "user-a",
        data: input,
        resolveProfile: async () => ({ resolved: false, error: "not confirmed" }),
        dispatch: async () => ({ dispatched: true, executionId: "x" }),
      }),
    /not confirmed/,
  ));
test("scan creation persists Business type, selected profile, query plan, token, and progress", async () => {
  const db = fakeSupabase();
  const result = await startBusinessReputationScanCore({
    supabase: db,
    userId: "user-a",
    data: input,
    resolveProfile: async () => profile,
    dispatch: async () => ({ dispatched: true, executionId: "exec-1" }),
    now: () => Date.parse("2026-08-05T00:00:00Z"),
  });
  const insert = db.calls.find((x) => x.operation === "insert")!.payload;
  assert.equal(insert.scan_type, "business_reputation");
  assert.deepEqual(insert.brand_profile, profile);
  assert.equal(insert.query_plan.subject, "Acme Coffee");
  assert.match(insert.scan_run_token, /^[0-9a-f-]{36}$/);
  assert.equal(insert.status, "running");
  assert.equal(insert.discovery_metrics.percent, 5);
  assert.equal(result.status, "running");
});
test("dispatch failure returns failed and gives a customer-safe reason", async () => {
  const db = fakeSupabase();
  const result = await startBusinessReputationScanCore({
    supabase: db,
    userId: "user-a",
    data: input,
    resolveProfile: async () => profile,
    dispatch: async () => ({
      dispatched: false,
      reason: "worker_url_not_configured",
      executionId: "exec-1",
    }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.dispatch.reason, "worker_url_not_configured");
});
test("a profile supplied by another user is not accepted by the start seam", async () =>
  await assert.rejects(
    () =>
      startBusinessReputationScanCore({
        supabase: fakeSupabase(),
        userId: "user-a",
        data: input,
        resolveProfile: async () => ({
          ...profile,
          user_id: "user-b",
          resolved: false,
          error: "profile owner mismatch",
        }),
        dispatch: async () => ({ dispatched: true, executionId: "x" }),
      }),
    /profile owner mismatch/,
  ));

test("worker rejects a mismatched run token before discovery", async () =>
  await assert.rejects(
    () =>
      executeBusinessReputationScan({
        supabase: fakeSupabase(),
        scanId: "scan-1",
        scanRunToken: "wrong",
        workerExecutionId: "worker-1",
      }),
    /does not match/,
  ));
test("worker persists findings incrementally and completes with provider warnings", async () => {
  const db = fakeSupabase();
  const result = await executeBusinessReputationScan(
    {
      supabase: db,
      scanId: "scan-1",
      scanRunToken: "00000000-0000-4000-8000-000000000001",
      workerExecutionId: "worker-1",
    },
    {
      discover: async () => ({
        status: "completed_with_warnings",
        results: [
          {
            url: "https://acmecoffee.com/news",
            title: "Acme Coffee Austin",
            description: "Acme Coffee Austin",
          },
        ],
        warnings: ["YouTube unavailable"],
        customerError: null,
      }),
    },
  );
  assert.equal(result.status, "completed_with_warnings");
  assert.ok(db.calls.some((x) => x.operation === "upsert" && x.table === "scan_hits"));
  assert.ok(db.calls.some((x) => x.operation === "update" && x.table === "scans"));
});
test("worker is idempotent for completed scans", async () => {
  const db = fakeSupabase();
  const scan = db.from("scans");
  void scan;
  const result = await executeBusinessReputationScan({
    supabase: {
      ...db,
      from: (table: string) => {
        const q: any = db.from(table);
        if (table === "scans")
          q.maybeSingle = async () => ({
            data: {
              id: "scan-1",
              user_id: "user-a",
              status: "completed",
              scan_type: "business_reputation",
            },
            error: null,
          });
        return q;
      },
    },
    scanId: "scan-1",
    workerExecutionId: "worker-1",
  });
  assert.equal(result.status, "completed");
});
test("worker does not execute cancelled or failed scans", async () => {
  for (const status of ["cancelled", "failed"]) {
    const result = await executeBusinessReputationScan({
      supabase: fakeSupabase("scan-1", status),
      scanId: "scan-1",
      workerExecutionId: "worker-1",
    });
    assert.equal(result.status, status);
  }
});
test("worker stops when lease ownership is lost", async () => {
  const db = fakeSupabase();
  const original = db.from;
  db.from = (table: string) => {
    const q: any = original(table);
    if (table === "scans")
      q.then = (resolve: (value: any) => unknown) => resolve({ data: [], error: null });
    return q;
  };
  await assert.rejects(
    () =>
      executeBusinessReputationScan(
        {
          supabase: db,
          scanId: "scan-1",
          scanRunToken: "00000000-0000-4000-8000-000000000001",
          workerExecutionId: "worker-1",
        },
        {
          discover: async () => ({
            status: "completed",
            results: [],
            warnings: [],
            customerError: null,
          }),
        },
      ),
    /lost scan lease/,
  );
});

test("hook rejects missing and invalid signatures", async () => {
  const request = new Request(
    "https://example.test/api/public/hooks/business-reputation-scan-execute",
    { method: "POST", body: JSON.stringify({}) },
  );
  assert.equal(
    (await handleBusinessReputationWorkerRequest(request, { verify: async () => ({ ok: false }) }))
      .status,
    401,
  );
  const invalid = new Request(request.url, {
    method: "POST",
    body: JSON.stringify({ scan_id: "bad" }),
  });
  assert.equal(
    (await handleBusinessReputationWorkerRequest(invalid, { verify: async () => ({ ok: true }) }))
      .status,
    400,
  );
});
test("hook rejects missing run token and accepts a valid signed request", async () => {
  const body = {
    scan_id: "00000000-0000-4000-8000-000000000001",
    scan_run_token: "00000000-0000-4000-8000-000000000002",
    worker_execution_id: "worker-123",
  };
  const missing = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ scan_id: body.scan_id }),
  });
  assert.equal(
    (await handleBusinessReputationWorkerRequest(missing, { verify: async () => ({ ok: true }) }))
      .status,
    400,
  );
  const accepted = await handleBusinessReputationWorkerRequest(
    new Request("https://example.test", { method: "POST", body: JSON.stringify(body) }),
    {
      verify: async () => ({ ok: true }),
      execute: async () => undefined,
      supabase: fakeSupabase(),
      schedule: () => ({ wait_until_used: false }),
    },
  );
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).accepted, true);
});
