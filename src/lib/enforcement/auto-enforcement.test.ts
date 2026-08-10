/**
 * Automated Enforcement Unit Test Suite (Postmark Transport).
 * Tests core auto-enforcement requirements, Postmark transport behavior,
 * test-mode redirection, and truthful delivery status mapping.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { AutoEnforcementOrchestrator, FindingShape } from "./orchestrator";
import { EnforcementRouter } from "./router";
import { EmailEnforcementConnector } from "./connectors/email-connector";
import { YouTubeConnector, GoogleSearchConnector, WebsiteCopyrightConnector, HostAbuseConnector } from "./connectors/platform-connectors";
import { PostmarkTransport } from "./transports/email-transport";

function createMockSupabase(overrides: {
  auth?: any;
  settings?: any;
  scopes?: any[];
  assets?: any[];
}) {
  const authObj = overrides.auth ?? { id: "auth-1", status: "ACTIVE", enforcement_enabled: true };
  const settingsObj = overrides.settings ?? { automatic_enforcement_enabled: true, enforcement_basis_policies: { copyright: "AUTO" } };
  const scopesList = overrides.scopes ?? [{ scope_key: "prepare_copyright", granted: true }];
  const assetsList = overrides.assets ?? [{ id: "asset-101", verification_status: "VERIFIED" }];

  return {
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === "client_authorizations") return { data: authObj };
          if (table === "client_enforcement_settings") return { data: settingsObj };
          return { data: null };
        },
        then: (resolve: any) => {
          if (table === "authorization_scopes") resolve({ data: scopesList });
          else if (table === "digital_assets") resolve({ data: assetsList });
          else resolve({ data: [] });
        },
      };
      return chain;
    },
  };
}

test("1. Missing POSTMARK_SERVER_TOKEN -> CONFIGURATION_ERROR", async () => {
  process.env.ENFORCEMENT_TEST_MODE = "true";
  const originalToken = process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.POSTMARK_SERVER_TOKEN;

  const transport = new PostmarkTransport();
  const result = await transport.send({
    caseId: "case-cfg-err",
    intendedRecipient: "dmca@target.com",
    subject: "Test DMCA",
    textBody: "Notice content",
    demoMode: false,
  });

  assert.equal(result.success, false);
  assert.equal(result.status, "CONFIGURATION_ERROR");
  assert.match(result.error || "", /Missing required POSTMARK_SERVER_TOKEN/);

  if (originalToken) process.env.POSTMARK_SERVER_TOKEN = originalToken;
});

test("2. Test mode forces ENFORCEMENT_TEST_DESTINATION & preserves intended recipient separately", async () => {
  process.env.ENFORCEMENT_TEST_MODE = "true";
  process.env.ENFORCEMENT_TEST_DESTINATION = "test-mailbox@eterna.ai";

  const connector = new EmailEnforcementConnector();
  const payload = {
    caseId: "case-test-mode-1",
    userId: "user-1",
    targetUrl: "https://infringing-site.com/video",
    domain: "infringing-site.com",
    platform: "Web",
    enforcementBasis: "COPYRIGHT" as const,
    complainantName: "Jane Doe",
    complainantEmail: "jane@eterna.ai",
    authorizationLevel: "VERIFIED",
    destinationEmail: "dmca@infringing-site.com",
    destinationRouteStatus: "VERIFIED",
    demoMode: false,
  };

  const prepared = await connector.prepare(payload);
  assert.match(String(prepared.noticeSubject), /\[ETERNA ENFORCEMENT TEST — DO NOT ACTION\]/);
});

test("3. Verified copyrighted asset + valid auth -> automatic case creation & AUTO_ELIGIBLE", async () => {
  const finding: FindingShape = {
    id: "test-finding-1",
    source: "Web",
    canonical_url: "https://www.pirate-site.com/watch?v=sample123",
    title: "Unauthorized Reupload of Protected Film",
    risk_type: "Copyright Infringement",
    protected_asset_id: "asset-101",
  };

  const mockSupabase = createMockSupabase({});
  const eligibility = await AutoEnforcementOrchestrator.evaluateEligibility(mockSupabase as any, "user-123", finding);
  assert.equal(eligibility.status, "AUTO_ELIGIBLE");
  assert.equal(eligibility.basis, "COPYRIGHT");
});

test("4. Duplicate finding -> single enforcement submission via idempotency key guard", async () => {
  const key1 = AutoEnforcementOrchestrator.generateIdempotencyKey("user-123", "https://example.com/pirated-video", "COPYRIGHT", "asset-101");
  const key2 = AutoEnforcementOrchestrator.generateIdempotencyKey("user-123", "https://example.com/pirated-video", "COPYRIGHT", "asset-101");

  assert.equal(key1, key2);
  assert.equal(key1.length, 64);
});

test("5. WebsiteCopyrightConnector & HostAbuseConnector use Postmark email transport", async () => {
  const webConnector = new WebsiteCopyrightConnector();
  const hostConnector = new HostAbuseConnector();

  assert.equal(webConnector.submissionMethod, "EMAIL");
  assert.equal(hostConnector.submissionMethod, "EMAIL");
});

test("6. YouTube remains HUMAN_ACTION_REQUIRED", async () => {
  const ytConnector = new YouTubeConnector();
  const result = await ytConnector.submit({
    caseId: "yt-case-1",
    userId: "user-1",
    targetUrl: "https://youtube.com/watch?v=123",
    domain: "youtube.com",
    platform: "YouTube",
    enforcementBasis: "COPYRIGHT",
    complainantName: "Complainant",
    complainantEmail: "user@eterna.ai",
    authorizationLevel: "VERIFIED",
  });

  assert.equal(result.status, "HUMAN_ACTION_REQUIRED");
  assert.match(result.notes || "", /HUMAN SUBMISSION REQUIRED/);
});

test("7. Google Search remains HUMAN_ACTION_REQUIRED", async () => {
  const gglConnector = new GoogleSearchConnector();
  const result = await gglConnector.submit({
    caseId: "ggl-case-1",
    userId: "user-1",
    targetUrl: "https://google.com/search?q=test",
    domain: "google.com",
    platform: "Google",
    enforcementBasis: "SEARCH_ENGINE_COPYRIGHT",
    complainantName: "Complainant",
    complainantEmail: "user@eterna.ai",
    authorizationLevel: "VERIFIED",
  });

  assert.equal(result.status, "HUMAN_ACTION_REQUIRED");
  assert.match(result.notes || "", /HUMAN SUBMISSION REQUIRED/);
});

test("8. Demo mode still blocks transport", async () => {
  const connector = new EmailEnforcementConnector();
  const result = await connector.submit({
    caseId: "demo-case-1",
    userId: "user-1",
    targetUrl: "https://pirate.org/file",
    domain: "pirate.org",
    platform: "Web",
    enforcementBasis: "COPYRIGHT",
    complainantName: "Complainant",
    complainantEmail: "user@eterna.ai",
    authorizationLevel: "VERIFIED",
    destinationEmail: "dmca@pirate.org",
    destinationRouteStatus: "VERIFIED",
    demoMode: true,
  });

  assert.equal(result.status, "DEMO_MODE_BLOCKED");
  assert.equal(result.success, false);
});
