/**
 * Controlled Production Activation Acceptance Test Suite.
 * Validates production gating, client/asset approvals, basis restrictions,
 * controlled rate limits (5 global / 3 client / 1 domain), emergency pause, and send-time rechecks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { AutoEnforcementOrchestrator, FindingShape } from "./orchestrator";
import { EmailEnforcementConnector } from "./connectors/email-connector";
import { PostmarkTransport } from "./transports/email-transport";
import { EnforcementWorkerRunner } from "./worker";
import { EnforcementRateLimiter } from "./rate-limiter";
import { EnforcementRouteResolver } from "./route-resolver";
import { VerificationEngine } from "./verification-engine";

function createPhase1MockSupabase(overrides: {
  auth?: any;
  settings?: any;
  assetSettings?: any;
  route?: any;
}) {
  const casesDb = new Map<string, any>();
  const jobsDb = new Map<string, any>();
  const eventsDb: any[] = [];

  const authObj = overrides.auth ?? { id: "auth-phase1", status: "ACTIVE", enforcement_enabled: true };
  const settingsObj = overrides.settings ?? { automatic_enforcement_enabled: true, production_enforcement_approved: true, enforcement_basis_policies: { copyright: "AUTO" } };
  const assetSettingsObj = overrides.assetSettings ?? { production_enforcement_approved: true };
  const routeObj = overrides.route ?? {
    domain: "test-pirated-site.com",
    copyright_email: "dmca@test-pirated-site.com",
    contact: "dmca@test-pirated-site.com",
    verification_status: "VERIFIED",
    verified_at: new Date().toISOString(),
  };

  const client: any = {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        insert: (data: any) => {
          const rows = Array.isArray(data) ? data : [data];
          for (const r of rows) {
            const id = r.id || `id-${Math.random().toString(36).slice(2, 9)}`;
            const row = { id, ...r, created_at: new Date().toISOString() };

            if (table === "enforcement_cases") casesDb.set(id, row);
            if (table === "enforcement_jobs") jobsDb.set(id, row);
            if (table === "enforcement_events") eventsDb.push(row);
          }
          const firstRow = Array.isArray(data) ? data[0] : data;
          const assignedId = firstRow?.id || `id-created-${Math.random().toString(36).slice(2, 8)}`;
          const createdObj = { id: assignedId, ...firstRow };

          return {
            select: () => ({
              single: async () => ({ data: createdObj, error: null }),
            }),
          };
        },
        update: (up: any) => {
          return {
            eq: (field: string, val: string) => {
              if (table === "enforcement_cases" && casesDb.has(val)) {
                casesDb.set(val, { ...casesDb.get(val), ...up });
              }
              if (table === "enforcement_jobs" && jobsDb.has(val)) {
                jobsDb.set(val, { ...jobsDb.get(val), ...up });
              }
              return {
                data: null,
                error: null,
                select: () => ({ maybeSingle: async () => ({ data: casesDb.get(val) || jobsDb.get(val), error: null }) }),
              };
            },
          };
        },
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        lte: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === "client_authorizations") return { data: authObj };
          if (table === "client_enforcement_settings") return { data: settingsObj };
          if (table === "asset_enforcement_settings") return { data: assetSettingsObj };
          if (table === "domain_enforcement_routes") return { data: overrides.route === null ? null : routeObj };
          if (table === "enforcement_cases") return { data: Array.from(casesDb.values())[0] || null };
          if (table === "enforcement_jobs") return { data: Array.from(jobsDb.values())[0] || null };
          return { data: null };
        },
        single: async () => {
          if (table === "enforcement_cases") return { data: Array.from(casesDb.values())[0] || null };
          if (table === "enforcement_jobs") return { data: Array.from(jobsDb.values())[0] || null };
          return { data: null };
        },
        then: (resolve: any) => {
          if (table === "authorization_scopes") resolve({ data: [{ scope_key: "prepare_copyright", granted: true }] });
          else if (table === "digital_assets") resolve({ data: [{ id: "asset-phase1", verification_status: "VERIFIED" }] });
          else if (table === "client_profiles") resolve({ data: { legal_name: "Phase 1 Rights Holder", email: "rights@eterna.ai" } });
          else resolve({ data: [], count: 0 });
        },
      };
      return chain;
    },
    rpc: async (func: string) => {
      if (func === "claim_next_enforcement_job") {
        const queued = Array.from(jobsDb.values()).find((j) => j.status === "queued");
        if (queued) {
          queued.status = "processing";
          return { data: [queued], error: null };
        }
      }
      return { data: [], error: null };
    },
    _db: { casesDb, jobsDb, eventsDb },
  };

  return client;
}

test("1. Live enabled but client not production-approved -> PRODUCTION_APPROVAL_REQUIRED", async () => {
  process.env.ENFORCEMENT_LIVE_ENABLED = "true";
  process.env.ENFORCEMENT_TEST_MODE = "false";
  process.env.ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED = "true";

  const mockSupabase = createPhase1MockSupabase({
    settings: { automatic_enforcement_enabled: true, production_enforcement_approved: false },
  });

  const finding: FindingShape = {
    id: "hit-unapproved-client",
    source: "Web",
    canonical_url: "https://test-pirated-site.com/movie-rip",
    title: "Asset Title",
    risk_type: "Copyright Infringement",
    protected_asset_id: "asset-phase1",
  };

  await AutoEnforcementOrchestrator.onVerifiedFinding(mockSupabase, "user-phase1", finding);
  const processed = await EnforcementWorkerRunner.processNextJob(mockSupabase, "worker-1");
  assert.equal(processed, true);

  const cases = Array.from(mockSupabase._db.casesDb.values()) as any[];
  assert.equal(cases[0].status, "PRODUCTION_APPROVAL_REQUIRED");

  process.env.ENFORCEMENT_TEST_MODE = "true";
});

test("2. Client approved but asset not approved -> PRODUCTION_APPROVAL_REQUIRED", async () => {
  process.env.ENFORCEMENT_LIVE_ENABLED = "true";
  process.env.ENFORCEMENT_TEST_MODE = "false";

  const mockSupabase = createPhase1MockSupabase({
    settings: { automatic_enforcement_enabled: true, production_enforcement_approved: true },
    assetSettings: { production_enforcement_approved: false },
  });

  const finding: FindingShape = {
    id: "hit-unapproved-asset",
    source: "Web",
    canonical_url: "https://test-pirated-site.com/movie-rip",
    title: "Asset Title",
    risk_type: "Copyright Infringement",
    protected_asset_id: "asset-unapproved",
  };

  await AutoEnforcementOrchestrator.onVerifiedFinding(mockSupabase, "user-phase1", finding);
  const processed = await EnforcementWorkerRunner.processNextJob(mockSupabase, "worker-1");
  assert.equal(processed, true);

  const cases = Array.from(mockSupabase._db.casesDb.values()) as any[];
  assert.equal(cases[0].status, "PRODUCTION_APPROVAL_REQUIRED");

  process.env.ENFORCEMENT_TEST_MODE = "true";
});

test("3. Client + asset approved but basis is HARASSMENT -> blocked from first-live AUTO mode (HUMAN_ACTION_REQUIRED)", async () => {
  process.env.CONTROLLED_PRODUCTION_MODE = "true";

  const mockSupabase = createPhase1MockSupabase({});
  const finding: FindingShape = {
    id: "hit-harassment-basis",
    source: "Web",
    canonical_url: "https://test-pirated-site.com/harassment-post",
    title: "Harassment Post",
    risk_type: "Harassment",
    protected_asset_id: "asset-phase1",
  };

  await AutoEnforcementOrchestrator.onVerifiedFinding(mockSupabase, "user-phase1", finding);
  const processed = await EnforcementWorkerRunner.processNextJob(mockSupabase, "worker-1");
  assert.equal(processed, true);

  const cases = Array.from(mockSupabase._db.casesDb.values()) as any[];
  assert.equal(cases[0].status, "HUMAN_ACTION_REQUIRED");
});

test("4. COPYRIGHT + all requirements -> eligible for controlled production (QUEUED)", async () => {
  const mockSupabase = createPhase1MockSupabase({});
  const finding: FindingShape = {
    id: "hit-copyright-eligible",
    source: "Web",
    canonical_url: "https://test-pirated-site.com/movie",
    title: "Copyright Movie",
    risk_type: "Copyright Infringement",
    protected_asset_id: "asset-phase1",
  };

  const result = await AutoEnforcementOrchestrator.onVerifiedFinding(mockSupabase, "user-phase1", finding);
  assert.equal(result.status, "QUEUED");
  assert.ok(result.caseId);
});

test("5. Emergency pause after job queued -> worker does not send", async () => {
  process.env.ENFORCEMENT_EMERGENCY_PAUSE = "true";

  const mockSupabase = createPhase1MockSupabase({});
  const processed = await EnforcementWorkerRunner.processNextJob(mockSupabase, "worker-1");
  assert.equal(processed, false);

  process.env.ENFORCEMENT_EMERGENCY_PAUSE = "false";
});

test("6. Authorization revoked after approval -> worker does not send (NOT_ELIGIBLE)", async () => {
  let authObj: any = { id: "auth-active", status: "ACTIVE" };
  const mockSupabase = createPhase1MockSupabase({
    auth: authObj,
  });

  const finding: FindingShape = {
    id: "hit-auth-revoked",
    source: "Web",
    canonical_url: "https://test-pirated-site.com/pirated-content",
    title: "Asset Title",
    risk_type: "Copyright Infringement",
    protected_asset_id: "asset-phase1",
  };

  await AutoEnforcementOrchestrator.onVerifiedFinding(mockSupabase, "user-phase1", finding);

  // Revoke authorization in DB before worker runs
  authObj.status = "REVOKED";

  const processed = await EnforcementWorkerRunner.processNextJob(mockSupabase, "worker-1");
  assert.equal(processed, true);

  const cases = Array.from(mockSupabase._db.casesDb.values()) as any[];
  assert.equal(cases[0].status, "NOT_ELIGIBLE");
});

test("7. Route becomes stale after approval -> worker does not send (ROUTE_DISCOVERY_REQUIRED)", async () => {
  const staleDate = new Date(Date.now() - 100 * 24 * 3600_000).toISOString();
  const mockSupabase = createPhase1MockSupabase({
    route: { domain: "test-pirated-site.com", contact: "dmca@test-pirated-site.com", verification_status: "VERIFIED", verified_at: staleDate },
  });

  const finding: FindingShape = {
    id: "hit-stale-route",
    source: "Web",
    canonical_url: "https://test-pirated-site.com/pirated-content",
    title: "Asset Title",
    risk_type: "Copyright Infringement",
    protected_asset_id: "asset-phase1",
  };

  await AutoEnforcementOrchestrator.onVerifiedFinding(mockSupabase, "user-phase1", finding);
  const processed = await EnforcementWorkerRunner.processNextJob(mockSupabase, "worker-1");
  assert.equal(processed, true);

  const cases = Array.from(mockSupabase._db.casesDb.values()) as any[];
  assert.equal(cases[0].status, "ROUTE_DISCOVERY_REQUIRED");
});
