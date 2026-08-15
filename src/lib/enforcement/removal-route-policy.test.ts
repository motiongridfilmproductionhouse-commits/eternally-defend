import { describe, expect, it } from "vitest";
import {
  decidePlatformRoute,
  effectiveRouteState,
  evaluateVerification,
  isGuessedAddress,
  nextReverifyDueAt,
} from "./removal-route-policy";

const operatorEvidence = {
  domain: "example-blog.com",
  routeType: "EMAIL_DMCA" as const,
  recipientEmail: "legal@example-blog.com",
  verificationMethod: "PUBLISHED_DMCA_PAGE",
  authoritativeSourceUrl: "https://example-blog.com/dmca",
  evidenceSnapshot: { excerpt: "Send DMCA notices to legal@example-blog.com" },
  actorIsOperator: true,
};

describe("explicit platform routing", () => {
  it("routes known social platforms to HUMAN_ACTION_REQUIRED, never guessed email", () => {
    for (const url of [
      "https://www.instagram.com/p/abc123/",
      "https://www.facebook.com/some.page/posts/1",
      "https://www.tiktok.com/@user/video/123",
      "https://x.com/user/status/123",
      "https://www.pinterest.com/pin/123/",
      "https://www.reddit.com/r/x/comments/1/a/",
      "https://www.amazon.in/dp/B000",
      "https://www.youtube.com/watch?v=abc",
    ]) {
      const d = decidePlatformRoute(url);
      expect(d.routeType, url).toBe("HUMAN_ACTION_REQUIRED");
      expect(d.emailEligible, url).toBe(false);
      expect(d.preparePackage, url).toBe(true);
    }
  });

  it("routes search surfaces to SEARCH_DELISTING, separate from source removal", () => {
    const d = decidePlatformRoute("https://www.google.com/search?q=leak");
    expect(d.routeType).toBe("SEARCH_DELISTING");
    expect(d.emailEligible).toBe(false);
    const b = decidePlatformRoute("https://www.bing.com/search?q=leak");
    expect(b.routeType).toBe("SEARCH_DELISTING");
  });

  it("never makes a CDN/proxy the recipient", () => {
    for (const url of [
      "https://d123.cloudfront.net/video.mp4",
      "https://scontent.cdninstagram.com/x.jpg",
      "https://foo.b-cdn.net/clip.mp4",
    ]) {
      const d = decidePlatformRoute(url);
      expect(d.routeType, url).toBe("HOST_ORIGIN_DISCOVERY_REQUIRED");
      expect(d.emailEligible, url).toBe(false);
    }
  });

  it("keeps independent websites email-eligible", () => {
    const d = decidePlatformRoute("https://example-blog.com/post/1");
    expect(d.routeType).toBe("EMAIL_DMCA");
    expect(d.emailEligible).toBe(true);
    expect(d.connectorId).toBe("website_copyright_connector");
  });
});

describe("guessed address detection", () => {
  it("flags generic same-domain mailboxes", () => {
    expect(isGuessedAddress("dmca@example.com", "example.com")).toBe(true);
    expect(isGuessedAddress("copyright@example.com", "example.com")).toBe(true);
    expect(isGuessedAddress("abuse@example.com", "example.com")).toBe(true);
    expect(isGuessedAddress("legal-team@example.com", "example.com")).toBe(false);
  });
});

describe("verification gate", () => {
  it("refuses a heuristic/guessed route promotion", () => {
    const d = evaluateVerification({
      ...operatorEvidence,
      recipientEmail: "dmca@example-blog.com",
      verificationMethod: "HEURISTIC_DISCOVERY",
      authoritativeSourceUrl: null,
      evidenceSnapshot: null,
    });
    expect(d.canVerify).toBe(false);
    expect(d.fallbackStatus).not.toBe("VERIFIED");
    expect(d.issues.join(" ")).toMatch(/not authoritative/i);
  });

  it("refuses verification by a non-operator", () => {
    const d = evaluateVerification({ ...operatorEvidence, actorIsOperator: false });
    expect(d.canVerify).toBe(false);
    expect(d.issues[0]).toMatch(/operator/i);
  });

  it("requires an authoritative source URL and evidence", () => {
    expect(
      evaluateVerification({ ...operatorEvidence, authoritativeSourceUrl: "not-a-url" }).canVerify,
    ).toBe(false);
    expect(evaluateVerification({ ...operatorEvidence, evidenceSnapshot: {} }).canVerify).toBe(false);
  });

  it("allows an operator with authoritative evidence", () => {
    const d = evaluateVerification(operatorEvidence);
    expect(d.canVerify).toBe(true);
    expect(d.issues).toEqual([]);
  });

  it("refuses verifying a non-email route as an auto-sendable recipient", () => {
    const d = evaluateVerification({ ...operatorEvidence, routeType: "HUMAN_ACTION_REQUIRED" });
    expect(d.canVerify).toBe(false);
  });

  it("is idempotent — verifying the same evidence twice yields the same decision", () => {
    expect(evaluateVerification(operatorEvidence)).toEqual(evaluateVerification(operatorEvidence));
  });
});

describe("effective route state", () => {
  const verifiedRow = {
    verification_status: "VERIFIED",
    recipient_email: "legal@example-blog.com",
    route_type: "EMAIL_DMCA",
    verified_at: new Date().toISOString(),
    reverify_due_at: nextReverifyDueAt(),
  };

  it("makes a verified independent-site route email-eligible", () => {
    const s = effectiveRouteState(verifiedRow);
    expect(s.canAutoSend).toBe(true);
    expect(s.status).toBe("VERIFIED");
  });

  it("blocks unverified, rejected and missing routes", () => {
    expect(effectiveRouteState(null).canAutoSend).toBe(false);
    expect(
      effectiveRouteState({ ...verifiedRow, verification_status: "DISCOVERED_UNVERIFIED" }).canAutoSend,
    ).toBe(false);
    expect(effectiveRouteState({ ...verifiedRow, verification_status: "REJECTED" }).canAutoSend).toBe(
      false,
    );
  });

  it("expires a verification past its re-verification date", () => {
    const s = effectiveRouteState({
      ...verifiedRow,
      reverify_due_at: new Date(Date.now() - 86400_000).toISOString(),
    });
    expect(s.status).toBe("STALE");
    expect(s.canAutoSend).toBe(false);
  });

  it("never auto-sends for a non-email route type even when VERIFIED", () => {
    expect(
      effectiveRouteState({ ...verifiedRow, route_type: "HUMAN_ACTION_REQUIRED" }).canAutoSend,
    ).toBe(false);
  });
});

describe("live-pilot recipient policy", () => {
  const base = {
    domain: "example-blog.com",
    routeType: "EMAIL_DMCA" as const,
    authoritativeSourceUrl: "https://example-blog.com/dmca",
    evidenceSnapshot: { excerpt: "Send DMCA notices to dmca@example-blog.com" },
    actorIsOperator: true,
  };

  it("verifies a recipient published on the host's own legal page", () => {
    const d = evaluateVerification({
      ...base,
      recipientEmail: "dmca@example-blog.com",
      verificationMethod: "PUBLISHED_DMCA_PAGE",
    });
    expect(d.canVerify, d.issues.join("; ")).toBe(true);
  });

  it("refuses a hosting-provider abuse channel as an email recipient", () => {
    const d = evaluateVerification({
      ...base,
      recipientEmail: "abuse@cloudflare.com",
      authoritativeSourceUrl: "https://www.cloudflare.com/trust-hub/abuse-approach/",
      verificationMethod: "HOSTING_PROVIDER_ABUSE_PAGE",
    });
    expect(d.canVerify).toBe(false);
    expect(d.issues.join(" ")).toMatch(/manual escalation/i);
  });

  it("refuses a registrar abuse record as an email recipient", () => {
    const d = evaluateVerification({
      ...base,
      recipientEmail: "abuse@registrar.example",
      verificationMethod: "REGISTRAR_ABUSE_RECORD",
    });
    expect(d.canVerify).toBe(false);
  });

  it("refuses a third-party mailbox even with a published-page method", () => {
    const d = evaluateVerification({
      ...base,
      recipientEmail: "dmca@some-agent.io",
      verificationMethod: "PUBLISHED_DMCA_PAGE",
    });
    expect(d.canVerify).toBe(false);
    expect(d.issues.join(" ")).toMatch(/not published on example-blog\.com/i);
  });

  it("refuses a source URL hosted off the infringing domain", () => {
    const d = evaluateVerification({
      ...base,
      recipientEmail: "dmca@example-blog.com",
      authoritativeSourceUrl: "https://third-party-directory.com/example-blog",
      verificationMethod: "PUBLISHED_DMCA_PAGE",
    });
    expect(d.canVerify).toBe(false);
    expect(d.issues.join(" ")).toMatch(/own official legal/i);
  });

  it("prepares a manual escalation package for CDN/registrar infrastructure hosts", () => {
    const d = decidePlatformRoute("https://cloudflare.com/abuse-target");
    expect(d.emailEligible).toBe(false);
    expect(d.requiresHuman).toBe(true);
    expect(d.preparePackage).toBe(true);
    expect(d.routeType).toBe("HOST_ORIGIN_DISCOVERY_REQUIRED");
  });
});
