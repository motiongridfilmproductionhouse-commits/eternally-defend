import { describe, expect, it } from "vitest";
import {
  buildDedupeKey,
  canonicalizeUrlForDedupe,
  classifyFindingForEnforcement,
  computeNextRunAt,
  describeEnforcementOutcome,
  MIN_AUTO_CONFIDENCE,
} from "./autopilot";

const verified = {
  identityVerified: true,
  mediaEvidenceConfirmed: true,
  ownershipVerified: true,
  actionableUrl: true,
  confidence: 96,
};

describe("protection autopilot cadence", () => {
  it("schedules the next recurring run from cadence", () => {
    const next = computeNextRunAt(new Date("2026-01-01T00:00:00.000Z"), 720);
    expect(next).toBe("2026-01-01T12:00:00.000Z");
  });

  it("backs off after consecutive failures", () => {
    const next = computeNextRunAt(new Date("2026-01-01T00:00:00.000Z"), 60, 2);
    expect(next).toBe("2026-01-01T03:00:00.000Z");
  });

  it("never schedules faster than 15 minutes", () => {
    const next = computeNextRunAt(new Date("2026-01-01T00:00:00.000Z"), 1);
    expect(next).toBe("2026-01-01T00:15:00.000Z");
  });
});

describe("dedupe", () => {
  it("canonicalizes tracking params, www, trailing slash and case", () => {
    expect(canonicalizeUrlForDedupe("https://WWW.Example.com/a/?utm_source=x#frag")).toBe(
      "https://example.com/a",
    );
  });

  it("produces the same key for the same URL + target", () => {
    const a = buildDedupeKey({ userId: "u1", url: "https://x.com/a", targetKind: "asset", targetRef: "r1" });
    const b = buildDedupeKey({ userId: "u1", url: "http://www.x.com/a/?ref=1", targetKind: "asset", targetRef: "r1" });
    expect(a).toBe(b);
  });

  it("separates tenants and targets", () => {
    const a = buildDedupeKey({ userId: "u1", url: "https://x.com/a", targetKind: "asset", targetRef: "r1" });
    expect(buildDedupeKey({ userId: "u2", url: "https://x.com/a", targetKind: "asset", targetRef: "r1" })).not.toBe(a);
    expect(buildDedupeKey({ userId: "u1", url: "https://x.com/a", targetKind: "identity" })).not.toBe(a);
  });
});

describe("verification gates", () => {
  it("passes a fully verified high-confidence finding", () => {
    expect(classifyFindingForEnforcement(verified).decision).toBe("VERIFIED");
  });

  it("holds similarity-only findings in review", () => {
    const out = classifyFindingForEnforcement({ ...verified, mediaEvidenceConfirmed: false });
    expect(out.decision).toBe("REVIEW");
    expect(out.blockingReason).toMatch(/Similarity alone is not infringement/);
  });

  it.each([
    ["identityVerified", /Identity match not verified/],
    ["ownershipVerified", /ownership/i],
    ["actionableUrl", /actionable target URL/],
  ])("holds review when %s is false", (key, pattern) => {
    const out = classifyFindingForEnforcement({ ...verified, [key]: false } as never);
    expect(out.decision).toBe("REVIEW");
    expect(out.blockingReason).toMatch(pattern);
  });

  it("holds low confidence below the verified policy threshold", () => {
    const out = classifyFindingForEnforcement({ ...verified, confidence: MIN_AUTO_CONFIDENCE - 1 });
    expect(out.decision).toBe("REVIEW");
    expect(out.blockingReason).toMatch(/below the 90% verified-policy threshold/);
  });
});

describe("enforcement kill switches", () => {
  const sw = (o: Partial<Record<string, boolean>>) => ({
    liveEnabled: false,
    testMode: true,
    emergencyPause: false,
    ...o,
  }) as never;

  it("blocks external send while the live kill switch is off", () => {
    const out = describeEnforcementOutcome({ caseStatus: "QUEUED", routeName: "email", switches: sw({}) });
    expect(out.externalSendAllowed).toBe(false);
    expect(out.blockingReason).toMatch(/ENFORCEMENT_LIVE_ENABLED=false/);
  });

  it("blocks on emergency pause first", () => {
    const out = describeEnforcementOutcome({ caseStatus: "QUEUED", routeName: "email", switches: sw({ emergencyPause: true, liveEnabled: true, testMode: false }) });
    expect(out.blockingReason).toMatch(/Emergency pause/);
  });

  it("blocks in test mode even when live is enabled", () => {
    const out = describeEnforcementOutcome({ caseStatus: "QUEUED", routeName: "email", switches: sw({ liveEnabled: true, testMode: true }) });
    expect(out.externalSendAllowed).toBe(false);
    expect(out.blockingReason).toMatch(/test mode/i);
  });

  it("requires a verified auto-sendable route", () => {
    const out = describeEnforcementOutcome({ caseStatus: "QUEUED", routeName: "manual_form", switches: sw({ liveEnabled: true, testMode: false }) });
    expect(out.blockingReason).toMatch(/HUMAN_ACTION_REQUIRED/);
  });

  it("keeps review cases from sending", () => {
    const out = describeEnforcementOutcome({ caseStatus: "UNDER_REVIEW", routeName: "email", switches: sw({ liveEnabled: true, testMode: false }) });
    expect(out.externalSendAllowed).toBe(false);
  });

  it("allows send only when every switch and route condition passes", () => {
    const out = describeEnforcementOutcome({ caseStatus: "QUEUED", routeName: "email", switches: sw({ liveEnabled: true, testMode: false }) });
    expect(out.externalSendAllowed).toBe(true);
    expect(out.blockingReason).toBeNull();
  });
});
