import { describe, expect, it } from "vitest";
import { triageRemovalRoute, triageAndSortRoutes, isGenericMailbox } from "./route-triage";
import type { RemovalRouteView } from "./removal-routes.functions";

function route(overrides: Partial<RemovalRouteView> = {}): RemovalRouteView {
  return {
    id: "r1",
    domain: "example.com",
    routeType: "EMAIL_DMCA",
    platformKind: null,
    recipientEmail: "dmca@example.com",
    status: "DISCOVERED_UNVERIFIED",
    effectiveStatus: "DISCOVERED_UNVERIFIED",
    verificationMethod: "AUTOMATED_ON_DOMAIN_DISCOVERY",
    authoritativeSourceUrl: null,
    evidenceSnapshot: {},
    verifiedAt: null,
    verifiedBy: null,
    lastCheckedAt: null,
    reverifyDueAt: null,
    rejectedReason: null,
    hostingProvider: null,
    notes: null,
    isGuessedCandidate: false,
    canAutoSend: false,
    createdAt: null,
    discoveredAt: null,
    discoveryFindingId: null,
    discoveryCaseId: null,
    discoveryFindingUrl: null,
    discoverySourceType: null,
    autoDiscovered: true,
    confidence: 0.5,
    authoritativePageKind: "DMCA",
    verificationMethodCandidate: "PUBLISHED_DMCA_PAGE",
    evidenceUrl: "https://example.com/dmca",
    ...overrides,
  };
}

const verified = () =>
  route({
    status: "VERIFIED",
    effectiveStatus: "VERIFIED",
    canAutoSend: true,
    verificationMethod: "PUBLISHED_DMCA_PAGE",
    authoritativeSourceUrl: "https://example.com/dmca",
    verifiedAt: "2026-09-01T00:00:00Z",
  });

describe("route triage (UI prioritisation only)", () => {
  it("puts a verified, auto-sendable, same-org route in HIGH", () => {
    const t = triageRemovalRoute(verified());
    expect(t.priority).toBe("HIGH");
    expect(t.label).toBe("READY FOR REMOVAL REVIEW");
  });

  it("never promotes a verified route whose gates say canAutoSend=false", () => {
    const t = triageRemovalRoute(route({ effectiveStatus: "VERIFIED", canAutoSend: false }));
    expect(t.priority).not.toBe("HIGH");
  });

  it("keeps a verified route out of HIGH when the recipient is off-domain", () => {
    const t = triageRemovalRoute(
      route({ effectiveStatus: "VERIFIED", canAutoSend: true, recipientEmail: "dmca@other.io" }),
    );
    expect(t.priority).toBe("LOW");
    expect(t.reasons.join(" ")).toContain("not on the target organisation");
  });

  it("classifies strong unverified evidence as MEDIUM / NEEDS VERIFICATION", () => {
    const t = triageRemovalRoute(route());
    expect(t.priority).toBe("MEDIUM");
    expect(t.label).toBe("NEEDS VERIFICATION");
    expect(t.reasons.join(" ")).toContain("Operator verification still required");
  });

  it("demotes generic support/info mailboxes", () => {
    for (const email of ["support@example.com", "info@example.com", "hr@example.com"]) {
      const t = triageRemovalRoute(route({ recipientEmail: email }));
      expect(t.priority).toBe("LOW");
    }
  });

  it("demotes routes with no authoritative page, guessed patterns or low confidence", () => {
    expect(triageRemovalRoute(route({ authoritativePageKind: null })).priority).toBe("LOW");
    expect(triageRemovalRoute(route({ isGuessedCandidate: true })).priority).toBe("LOW");
    expect(triageRemovalRoute(route({ confidence: 0.1 })).priority).toBe("LOW");
    expect(
      triageRemovalRoute(route({ verificationMethodCandidate: "HEURISTIC_DISCOVERY" })).priority,
    ).toBe("LOW");
  });

  it("demotes missing recipients, rejected and stale routes", () => {
    expect(triageRemovalRoute(route({ recipientEmail: null })).priority).toBe("LOW");
    expect(triageRemovalRoute(route({ effectiveStatus: "REJECTED" })).priority).toBe("LOW");
    expect(triageRemovalRoute(route({ effectiveStatus: "STALE" })).priority).toBe("LOW");
  });

  it("sorts HIGH before MEDIUM before LOW", () => {
    const sorted = triageAndSortRoutes([
      route({ id: "low", domain: "low.com", recipientEmail: "dmca@low.com", authoritativePageKind: null }),
      route({ id: "med", domain: "med.com", recipientEmail: "dmca@med.com" }),
      route({
        id: "high",
        domain: "high.com",
        recipientEmail: "dmca@high.com",
        effectiveStatus: "VERIFIED",
        canAutoSend: true,
      }),
    ]);
    expect(sorted.map((s) => s.triage.priority)).toEqual(["HIGH", "MEDIUM", "LOW"]);
  });

  it("treats a missing mailbox as generic", () => {
    expect(isGenericMailbox(null)).toBe(true);
    expect(isGenericMailbox("dmca@example.com")).toBe(false);
  });
});
