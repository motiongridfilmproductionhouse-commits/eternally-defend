import { describe, expect, it } from "vitest";
import {
  evaluatePreSendGate,
  outboundIdempotencyKey,
  type PreSendGateFacts,
} from "./pre-send-gate";

/** A fully-passing set of facts, used as the baseline for negative tests. */
function goFacts(): PreSendGateFacts {
  return {
    system: {
      liveEnabled: true,
      testMode: false,
      emergencyPause: false,
      demoMode: false,
      allowlistFlagEnabled: true,
    },
    client: {
      userId: "client-1",
      productionApproved: true,
      authorizationId: "auth-1",
      authorizationStatus: "ACTIVE",
      authorizationEnforcementEnabled: true,
      authorizationExpiresAt: "2099-01-01",
    },
    asset: {
      assetId: "asset-1",
      productionApproved: true,
      rightsEvidenceRef: "clients/client-1/rights/deed.pdf",
    },
    finding: {
      findingId: "finding-1",
      reviewed: true,
      enforcementGround: "COPYRIGHT_INFRINGEMENT",
      evidenceSnapshotRef: "clients/client-1/evidence/x.jpg",
    },
    route: {
      infringingHost: "example-piracy.com",
      recipient: "dmca@example-piracy.com",
      verificationStatus: "VERIFIED",
      verificationMethod: "PUBLISHED_DMCA_PAGE",
      authoritativeSourceUrl: "https://example-piracy.com/legal/dmca",
      verificationEvidencePreserved: true,
      verifiedAt: "2026-08-01T00:00:00Z",
      sameOrganisationPassed: true,
      recipientSource: "PUBLISHED_DMCA_PAGE",
      allowlisted: true,
      suppressed: false,
      emailEligible: true,
    },
    notice: {
      recipient: "dmca@example-piracy.com",
      subject: "DMCA Takedown Notice — Unauthorized use of protected content",
      evidenceReferenceCount: 2,
      clientIdentity: "Test Rights Holder",
      authorizedRepresentativeLanguagePresent: true,
      replyTo: "legal@eternasentinel.com",
      replyToVerified: true,
      testRecipientSubstitution: false,
      ccRecipients: [],
      bccRecipients: [],
    },
    limits: {
      globalCeilingPassed: true,
      clientCeilingPassed: true,
      domainCeilingPassed: true,
      duplicateSendProtectionPassed: true,
    },
  };
}

describe("final pre-send gate", () => {
  it("returns GO when every condition passes", () => {
    const d = evaluatePreSendGate(goFacts());
    expect(d.result).toBe("GO");
    expect(d.failedConditions).toEqual([]);
  });

  it("blocks while live enforcement is disabled and test mode is on", () => {
    const f = goFacts();
    f.system.liveEnabled = false;
    f.system.testMode = true;
    const d = evaluatePreSendGate(f);
    expect(d.result).toBe("NO_GO");
    expect(d.failedConditions).toContain("SYSTEM.LIVE_ENFORCEMENT_DISABLED");
    expect(d.failedConditions).toContain("SYSTEM.TEST_MODE_ACTIVE");
    expect(d.summary).toContain("SEND BLOCKED");
  });

  it("blocks an unverified Reply-To mailbox", () => {
    const f = goFacts();
    f.notice.replyToVerified = false;
    expect(evaluatePreSendGate(f).failedConditions).toContain("NOTICE.REPLY_TO_NOT_VERIFIED");
  });

  it("blocks when the client is not production-approved", () => {
    const f = goFacts();
    f.client.productionApproved = false;
    expect(evaluatePreSendGate(f).failedConditions).toContain("CLIENT.NOT_PRODUCTION_APPROVED");
  });

  it("blocks an expired or non-active authorization", () => {
    const f = goFacts();
    f.client.authorizationStatus = "EXPIRED";
    f.client.authorizationExpiresAt = "2020-01-01";
    const codes = evaluatePreSendGate(f).failedConditions;
    expect(codes).toContain("CLIENT.AUTHORIZATION_NOT_ACTIVE");
    expect(codes).toContain("CLIENT.AUTHORIZATION_EXPIRED");
  });

  it("blocks when the asset is not production-approved or lacks rights evidence", () => {
    const f = goFacts();
    f.asset.productionApproved = false;
    f.asset.rightsEvidenceRef = null;
    const codes = evaluatePreSendGate(f).failedConditions;
    expect(codes).toContain("ASSET.NOT_PRODUCTION_APPROVED");
    expect(codes).toContain("ASSET.RIGHTS_EVIDENCE_MISSING");
  });

  it("blocks an unreviewed finding or a missing evidence snapshot", () => {
    const f = goFacts();
    f.finding.reviewed = false;
    f.finding.evidenceSnapshotRef = null;
    const codes = evaluatePreSendGate(f).failedConditions;
    expect(codes).toContain("FINDING.NOT_REVIEWED");
    expect(codes).toContain("FINDING.EVIDENCE_SNAPSHOT_MISSING");
  });

  it("blocks registrar / WHOIS / CDN sourced recipients", () => {
    for (const source of ["WHOIS", "REGISTRAR_ABUSE_RECORD", "HOSTING_PROVIDER_ABUSE_PAGE", "CLOUDFLARE"]) {
      const f = goFacts();
      f.route.recipientSource = source;
      expect(evaluatePreSendGate(f).failedConditions).toContain(
        "ROUTE.RECIPIENT_SOURCE_NOT_AUTHORITATIVE",
      );
    }
  });

  it("blocks a verification method that is not email-eligible", () => {
    const f = goFacts();
    f.route.verificationMethod = "REGISTRAR_ABUSE_RECORD";
    expect(evaluatePreSendGate(f).failedConditions).toContain(
      "ROUTE.VERIFICATION_METHOD_NOT_EMAIL_ELIGIBLE",
    );
  });

  it("blocks when the authoritative source page is on a different organisation's host", () => {
    const f = goFacts();
    f.route.authoritativeSourceUrl = "https://abuse-directory.example.net/hosts/example-piracy";
    expect(evaluatePreSendGate(f).failedConditions).toContain("ROUTE.SOURCE_HOST_MISMATCH");
  });

  it("blocks when the same-organisation policy fails", () => {
    const f = goFacts();
    f.route.sameOrganisationPassed = false;
    expect(evaluatePreSendGate(f).failedConditions).toContain(
      "ROUTE.SAME_ORGANISATION_POLICY_FAILED",
    );
  });

  it("blocks a recipient that is not on the production allowlist", () => {
    const f = goFacts();
    f.route.allowlisted = false;
    expect(evaluatePreSendGate(f).failedConditions).toContain("ROUTE.RECIPIENT_NOT_ALLOWLISTED");
  });

  it("blocks origin-discovery-required routes from automated email", () => {
    const f = goFacts();
    f.route.emailEligible = false;
    expect(evaluatePreSendGate(f).failedConditions).toContain("ROUTE.NOT_EMAIL_ELIGIBLE");
  });

  it("blocks a notice addressed to anyone other than the verified recipient", () => {
    const f = goFacts();
    f.notice.recipient = "someone-else@other.com";
    expect(evaluatePreSendGate(f).failedConditions).toContain("NOTICE.RECIPIENT_MISMATCH");
  });

  it("blocks unintended CC/BCC recipients and test recipient substitution", () => {
    const f = goFacts();
    f.notice.ccRecipients = ["watcher@example.com"];
    f.notice.bccRecipients = ["silent@example.com"];
    f.notice.testRecipientSubstitution = true;
    const codes = evaluatePreSendGate(f).failedConditions;
    expect(codes).toContain("NOTICE.UNEXPECTED_CC_RECIPIENTS");
    expect(codes).toContain("NOTICE.UNEXPECTED_BCC_RECIPIENTS");
    expect(codes).toContain("NOTICE.TEST_RECIPIENT_SUBSTITUTION");
  });

  it("blocks missing authorized-representative language", () => {
    const f = goFacts();
    f.notice.authorizedRepresentativeLanguagePresent = false;
    expect(evaluatePreSendGate(f).failedConditions).toContain(
      "NOTICE.AUTHORIZED_REPRESENTATIVE_LANGUAGE_MISSING",
    );
  });

  it("blocks each exceeded rate ceiling and duplicate sends", () => {
    const f = goFacts();
    f.limits = {
      globalCeilingPassed: false,
      clientCeilingPassed: false,
      domainCeilingPassed: false,
      duplicateSendProtectionPassed: false,
    };
    const codes = evaluatePreSendGate(f).failedConditions;
    expect(codes).toContain("LIMITS.GLOBAL_CEILING_EXCEEDED");
    expect(codes).toContain("LIMITS.CLIENT_CEILING_EXCEEDED");
    expect(codes).toContain("LIMITS.DOMAIN_CEILING_EXCEEDED");
    expect(codes).toContain("LIMITS.DUPLICATE_SEND_DETECTED");
  });

  it("produces a stable idempotency key regardless of casing or repeat attempts", () => {
    const a = outboundIdempotencyKey({
      caseId: "case-1",
      enforcementRequestId: "req-1",
      recipient: "DMCA@Example-Piracy.com",
      targetUrl: "https://Example-Piracy.com/watch/1",
    });
    const b = outboundIdempotencyKey({
      caseId: "case-1",
      enforcementRequestId: "req-1",
      recipient: "dmca@example-piracy.com",
      targetUrl: "https://example-piracy.com/watch/1",
    });
    expect(a).toBe(b);
    expect(
      outboundIdempotencyKey({
        caseId: "case-2",
        enforcementRequestId: "req-1",
        recipient: "dmca@example-piracy.com",
        targetUrl: "https://example-piracy.com/watch/1",
      }),
    ).not.toBe(a);
  });
});
