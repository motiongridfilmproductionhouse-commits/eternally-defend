/**
 * End-to-end automatic enforcement pipeline harness.
 *
 * Drives the REAL orchestrator + REAL worker + REAL connectors + REAL Resend
 * transport against an in-memory database and a mocked HTTP layer, proving:
 *  - an eligible, authorized copyright finding reaches the Resend transport;
 *  - unauthorized / unverified-route / kill-switched cases never reach it;
 *  - provider failures map to retryable status and durable audit rows.
 *
 * No real email is ever sent: global fetch is stubbed, so nothing leaves the
 * process. No safety gate is disabled anywhere in this file.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeSupabase, type FakeDb } from "./fake-supabase.test-util";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return holder.db;
  },
}));

const USER = "user-1";
const TARGET = "https://pirate-example-site.net/leaked/movie";
const DOMAIN = "pirate-example-site.net";

function seed(overrides: { routeStatus?: string; authStatus?: string } = {}) {
  return createFakeSupabase({
    client_profiles: [
      { user_id: USER, legal_name: "Test Rights Holder", email: "client@example.org" },
    ],
    client_authorizations: [
      {
        id: "auth-1",
        user_id: USER,
        status: overrides.authStatus ?? "ACTIVE",
        enforcement_enabled: true,
        version: 1,
        effective_date: "2026-01-01",
      },
    ],
    client_enforcement_settings: [
      {
        user_id: USER,
        automatic_enforcement_enabled: true,
        production_enforcement_approved: false,
        enforcement_basis_policies: { copyright: "AUTO" },
      },
    ],
    authorization_scopes: [
      { authorization_id: "auth-1", scope_key: "prepare_copyright", granted: true },
    ],
    digital_assets: [{ id: "asset-1", user_id: USER, verification_status: "VERIFIED" }],
    domain_enforcement_routes: [
      {
        domain: DOMAIN,
        route_type: "EMAIL_DMCA",
        verification_status: overrides.routeStatus ?? "VERIFIED",
        verification_method: "OPERATOR_AUTHORITATIVE",
        recipient_email: "dmca@pirate-example-site.net",
        verified_at: new Date().toISOString(),
        reverify_due_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        confidence: 1,
      },
    ],
    enforcement_suppressions: [],
    enforcement_recipient_allowlist: [],
  });
}

const finding = {
  id: "finding-1",
  source: "web",
  source_type: "website",
  canonical_url: TARGET,
  title: "Unauthorized full movie upload",
  risk_type: "copyright",
  threat_score: 96,
  protected_asset_id: null,
};

let fetchCalls: Array<{ url: string; body: unknown }> = [];

function stubFetch(response: { status: number; body: unknown }) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  });
}

async function runPipeline(db: FakeDb) {
  const { AutoEnforcementOrchestrator } = await import("./orchestrator");
  const { EnforcementWorkerRunner } = await import("./worker");
  const outcome = await AutoEnforcementOrchestrator.onVerifiedFinding(
    db as never,
    USER,
    finding as never,
  );
  const processed = await EnforcementWorkerRunner.processNextJob(db as never, "test-worker");
  return { outcome, processed };
}

const resendCalls = () => fetchCalls.filter((c) => c.url.includes("api.resend.com"));
const caseRow = (db: FakeDb) => db.tables["enforcement_cases"]?.[0] as Record<string, unknown>;
const eventTypes = (db: FakeDb) =>
  (db.tables["enforcement_events"] ?? []).map((e) => e["event_type"]);

describe("automatic enforcement pipeline (finding -> Resend)", () => {
  beforeEach(() => {
    fetchCalls = [];
    process.env.ENFORCEMENT_TEST_MODE = "true";
    process.env.ENFORCEMENT_LIVE_ENABLED = "false";
    process.env.CONTROLLED_PRODUCTION_MODE = "true";
    process.env.ENFORCEMENT_TEST_DESTINATION = "enforcement@eternasentinel.com";
    process.env.RESEND_API_KEY = "re_unit_test_key";
    delete process.env.DEMO_MODE;
    delete process.env.ENFORCEMENT_EMERGENCY_PAUSE;
    delete process.env.ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED;
    stubFetch({ status: 200, body: { id: "resend-msg-1" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("eligible authorized copyright finding reaches the Resend transport", async () => {
    const db = seed();
    holder.db = db;

    const { outcome, processed } = await runPipeline(db);

    expect(outcome.status).toBe("QUEUED");
    expect(processed).toBe(true);

    // The send actually reached the Resend API boundary.
    expect(resendCalls()).toHaveLength(1);
    const sent = resendCalls()[0]!.body as { to: string[]; subject: string };
    // Hard test-mode redirect: the third party is never addressed.
    expect(sent.to).toEqual(["enforcement@eternasentinel.com"]);
    expect(sent.subject).toMatch(/DMCA Takedown Notice/i);

    expect(caseRow(db)["status"]).toBe("SUBMITTED");
    expect(eventTypes(db)).toContain("SUBMISSION_ATTEMPTED");
    expect(eventTypes(db)).toContain("SUBMITTED");
    // Immutable pre-send audit snapshot + durable delivery log exist.
    expect(db.tables["production_submission_snapshots"]).toHaveLength(1);
    const delivery = db.tables["enforcement_email_deliveries"]?.[0] as Record<string, unknown>;
    expect(delivery["delivery_status"]).toBe("SENT");
    expect(delivery["test_mode"]).toBe(true);
  });

  test("unverified removal route never reaches Resend", async () => {
    const db = seed({ routeStatus: "DISCOVERED_UNVERIFIED" });
    holder.db = db;

    await runPipeline(db);

    expect(resendCalls()).toHaveLength(0);
    expect(caseRow(db)["status"]).toBe("ROUTE_DISCOVERY_REQUIRED");
  });

  test("inactive client authorization is not eligible and never reaches Resend", async () => {
    const db = seed({ authStatus: "EXPIRED" });
    holder.db = db;

    const { outcome } = await runPipeline(db);

    expect(outcome.status).toBe("NOT_ELIGIBLE");
    expect(db.tables["enforcement_jobs"] ?? []).toHaveLength(0);
    expect(resendCalls()).toHaveLength(0);
  });

  test("kill switch (live off, test off) blocks the transport", async () => {
    process.env.ENFORCEMENT_TEST_MODE = "false";
    process.env.ENFORCEMENT_LIVE_ENABLED = "false";
    const db = seed();
    holder.db = db;

    await runPipeline(db);

    expect(resendCalls()).toHaveLength(0);
    expect(caseRow(db)["status"]).toBe("KILL_SWITCH_ACTIVE");
  });

  test("Resend 429 maps to a retryable failure and requeues the job", async () => {
    stubFetch({ status: 429, body: { message: "Too many requests" } });
    const db = seed();
    holder.db = db;

    await runPipeline(db);

    expect(resendCalls()).toHaveLength(1);
    const job = db.tables["enforcement_jobs"]![0] as Record<string, unknown>;
    expect(job["status"]).toBe("queued");
    expect(String(job["error"])).toMatch(/Resend transient error \(429\)/);
    const delivery = db.tables["enforcement_email_deliveries"]?.[0] as Record<string, unknown>;
    expect(delivery["delivery_status"]).toBe("FAILED_RETRYABLE");
  });

  test("a QUEUED case whose job insert failed is surfaced and self-healed", async () => {
    const db = seed();
    holder.db = db;
    db.insertErrorTables.add("enforcement_jobs");

    const { AutoEnforcementOrchestrator } = await import("./orchestrator");
    const outcome = await AutoEnforcementOrchestrator.onVerifiedFinding(
      db as never,
      USER,
      finding as never,
    );
    expect(outcome.status).toBe("QUEUE_FAILED");
    expect(eventTypes(db)).toContain("QUEUE_FAILED");

    db.insertErrorTables.delete("enforcement_jobs");
    const repaired = await AutoEnforcementOrchestrator.requeueMissingJobs(db as never);
    expect(repaired).toBe(1);

    const { EnforcementWorkerRunner } = await import("./worker");
    await EnforcementWorkerRunner.processNextJob(db as never, "test-worker");
    expect(resendCalls()).toHaveLength(1);
    expect(caseRow(db)["status"]).toBe("SUBMITTED");
  });
});
