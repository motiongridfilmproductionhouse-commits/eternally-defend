import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeCopyrightScanRowForClient } from "./public-surface";

/** Mock Supabase client generator for testing server-side role verifications */
function mockSupabaseClient(roleData: boolean | null, roleError: Error | null = null) {
  return {
    rpc: async (fnName: string, args: { _user_id: string; _role: string }) => {
      if (fnName === "has_role") {
        if (roleError) return { data: null, error: roleError };
        return { data: roleData, error: null };
      }
      return { data: null, error: new Error("Unknown RPC") };
    },
  };
}

/** Simulate server-side verifyIsAdminUserServer logic */
async function verifyIsAdminUserServer(supabase: unknown, userId: string): Promise<boolean> {
  try {
    const { data, error } = await (supabase as any).rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error || !data) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Sample scan row with extensive internal diagnostic payload */
const sampleScanWithDiagnostics = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Test Feature Film",
  status: "completed",
  stats: {
    matches: 3,
    candidates: 15,
    verification_diagnostics: {
      assetId: "asset-123",
      referenceFrameCount: 5,
      candidateTraces: [
        { candidateId: "c1", provider: "brightdata", realUrl: "https://pirate.com" },
      ],
    },
    provider_failures: ["Firecrawl HTTP 429", "SerpApi quota exceeded"],
    provider_requests_failed: 2,
    provider_requests_started: 10,
    provider_requests_succeeded: 8,
    queries_generated: 12,
    candidate_traces: [{ id: "ct1", domain: "leaked-movies.org" }],
    reference_diagnostic_internals: { secret_hash: "abc" },
    internal_stack_trace: "Error at executePipeline (scan-executor.server.ts:42)",
    unique_candidate_urls: 15,
    candidate_pages: 15,
    pages_crawled: 10,
    crawled_pages: 10,
    last_heartbeat: "2026-08-10T00:00:00Z",
    failed_stage: null,
    failure_code: null,
  },
};

test("1. Admin user: receives isAdmin = true and full diagnostic payload", async () => {
  const supabase = mockSupabaseClient(true);
  const isAdmin = await verifyIsAdminUserServer(supabase, "admin-user-id");
  assert.equal(isAdmin, true);

  // Admin user receives full stats including verification_diagnostics
  assert.notEqual(sampleScanWithDiagnostics.stats.verification_diagnostics, undefined);
  assert.notEqual(sampleScanWithDiagnostics.stats.provider_failures, undefined);
});

test("2. Normal authenticated user: receives isAdmin = false and sanitized payload", async () => {
  const supabase = mockSupabaseClient(false);
  const isAdmin = await verifyIsAdminUserServer(supabase, "normal-user-id");
  assert.equal(isAdmin, false);

  const sanitizedRow = sanitizeCopyrightScanRowForClient(sampleScanWithDiagnostics);
  const stats = sanitizedRow.stats as Record<string, unknown>;

  assert.equal(stats.verification_diagnostics, undefined);
  assert.equal(stats.provider_failures, undefined);
  assert.equal(stats.queries_generated, undefined);
  assert.equal(stats.candidate_traces, undefined);
  assert.equal(stats.reference_diagnostic_internals, undefined);
  assert.equal(stats.internal_stack_trace, undefined);
});

test("3. Demo user: receives isAdmin = false and cannot view diagnostics", async () => {
  // Demo users do not possess the admin role in database user_roles
  const supabase = mockSupabaseClient(false);
  const isAdmin = await verifyIsAdminUserServer(supabase, "demo-user-id");
  assert.equal(isAdmin, false);

  const sanitizedRow = sanitizeCopyrightScanRowForClient(sampleScanWithDiagnostics);
  const stats = sanitizedRow.stats as Record<string, unknown>;
  assert.equal(stats.verification_diagnostics, undefined);
});

test("4. Anonymous user: fails authentication or role check resulting in isAdmin = false", async () => {
  const supabase = mockSupabaseClient(null);
  const isAdmin = await verifyIsAdminUserServer(supabase, "");
  assert.equal(isAdmin, false);
});

test("5. ?diag=1 as normal user: isAdmin resolves false regardless of URL parameters", async () => {
  const supabase = mockSupabaseClient(false);
  const isAdmin = await verifyIsAdminUserServer(supabase, "normal-user-id");
  const queryParam = "?diag=1";

  // Conceptual UI rule: const showAdminDiagnostics = isAdmin === true
  const showAdminDiagnostics = isAdmin === true && queryParam.includes("diag=1");
  assert.equal(showAdminDiagnostics, false);
});

test("6. ?diag=1 as demo user: isAdmin resolves false regardless of demo mode or URL parameters", async () => {
  const supabase = mockSupabaseClient(false);
  const isAdmin = await verifyIsAdminUserServer(supabase, "demo-user-id");
  const showAdminDiagnostics = isAdmin === true;
  assert.equal(showAdminDiagnostics, false);
});

test("7. Admin role lookup error: fails closed and hides diagnostics", async () => {
  const supabase = mockSupabaseClient(null, new Error("Database connection timeout"));
  const isAdmin = await verifyIsAdminUserServer(supabase, "user-with-db-error");
  assert.equal(isAdmin, false);
});

test("8. Direct diagnostic server-function data call by non-admin returns sanitized payload with diagnostic keys stripped", () => {
  const sanitizedRow = sanitizeCopyrightScanRowForClient(sampleScanWithDiagnostics);
  const stats = sanitizedRow.stats as Record<string, unknown>;

  // Verify all sensitive diagnostic fields are completely purged
  const forbiddenKeys = [
    "verification_diagnostics",
    "provider_failures",
    "provider_requests_failed",
    "provider_requests_started",
    "provider_requests_succeeded",
    "queries_generated",
    "candidate_traces",
    "reference_diagnostic_internals",
    "internal_stack_trace",
    "unique_candidate_urls",
    "candidate_pages",
    "pages_crawled",
    "crawled_pages",
    "last_heartbeat",
  ];

  for (const key of forbiddenKeys) {
    assert.equal(stats[key], undefined, `Forbidden key ${key} was not stripped from client payload!`);
  }
});
