import { describe, expect, it } from "vitest";
import {
  completedStages,
  isShieldComplete,
  shieldProgress,
  shieldStatusLine,
  shieldTone,
  type ShieldSignals,
} from "./face-shield";

const base: ShieldSignals = {
  hasReferenceImage: false,
  meshResolved: false,
  protectedFaces: null,
  statusChecked: false,
};

const full: ShieldSignals = {
  hasReferenceImage: true,
  meshResolved: true,
  protectedFaces: 1,
  statusChecked: true,
};

describe("digital face shield progress", () => {
  it("starts at 0 with no real signals", () => {
    expect(shieldProgress(base)).toBe(0);
    expect(isShieldComplete(base)).toBe(false);
  });

  it("advances only in order as real signals resolve", () => {
    expect(shieldProgress({ ...base, hasReferenceImage: true })).toBe(25);
    expect(shieldProgress({ ...base, hasReferenceImage: true, meshResolved: true })).toBe(50);
    expect(shieldProgress({ ...full, statusChecked: false })).toBe(75);
    expect(shieldProgress(full)).toBe(100);
  });

  it("does not credit later stages when an earlier signal is missing", () => {
    expect(completedStages({ ...full, hasReferenceImage: false })).toEqual([]);
    expect(completedStages({ ...full, protectedFaces: 0 })).toEqual(["reference", "mesh"]);
  });
});

describe("digital face shield tone", () => {
  it("stays cyan while scanning and emerald when clear", () => {
    expect(shieldTone({ ...base, hasReferenceImage: true }, null)).toBe("cyan");
    expect(shieldTone(full, { confirmedThreats: 0, pendingReview: 0 })).toBe("emerald");
  });

  it("uses amber only for real pending review matches", () => {
    expect(shieldTone(full, { confirmedThreats: 0, pendingReview: 3 })).toBe("amber");
  });

  it("uses red only for real confirmed threats", () => {
    expect(shieldTone(full, { confirmedThreats: 1, pendingReview: 0 })).toBe("red");
  });
});

describe("digital face shield status copy", () => {
  it("never implies a threat when none exists", () => {
    const s = shieldStatusLine(full, { confirmedThreats: 0, pendingReview: 0 });
    expect(s.headline).toBe("FACE SHIELD ACTIVE");
    expect(s.detail).toBe("Your protected facial reference is ready for monitoring.");
  });

  it("reports the real reason when threats exist", () => {
    const s = shieldStatusLine(full, { confirmedThreats: 2, pendingReview: 0 });
    expect(s.headline).toBe("ACTIVE THREAT REVIEW");
    expect(s.detail).toContain("2 confirmed misuse cases");
  });

  it("shows the next real milestone while building", () => {
    expect(shieldStatusLine(base, null).detail).toBe("Building protected facial reference");
  });
});
