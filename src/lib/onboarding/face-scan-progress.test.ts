import { describe, expect, it } from "vitest";
import {
  buildLandmarkMesh,
  hasRealLandmarks,
  isScanActive,
  milestoneProgress,
} from "./face-scan-progress";

describe("face scan milestone progress", () => {
  it("starts at 0 before anything real happens", () => {
    expect(milestoneProgress("idle")).toBe(0);
  });

  it("maps real milestones monotonically to 100", () => {
    const order = [
      "camera_ready",
      "session_created",
      "liveness_capturing",
      "liveness_analyzed",
      "indexing",
      "enrolled",
    ] as const;
    const values = order.map(milestoneProgress);
    expect(values).toEqual([10, 20, 40, 60, 80, 100]);
    expect(values.every((v, i) => i === 0 || v > values[i - 1])).toBe(true);
  });

  it("never reports success progress on failure", () => {
    expect(milestoneProgress("failed")).toBe(0);
  });

  it("marks only real in-flight AWS work as active", () => {
    expect(isScanActive("liveness_capturing")).toBe(true);
    expect(isScanActive("indexing")).toBe(true);
    expect(isScanActive("idle")).toBe(false);
    expect(isScanActive("enrolled")).toBe(false);
  });
});

describe("landmark handling", () => {
  it("rejects missing/invalid landmark payloads (no fabrication)", () => {
    expect(hasRealLandmarks(undefined)).toBe(false);
    expect(hasRealLandmarks([])).toBe(false);
    expect(hasRealLandmarks([{ type: "nose" }])).toBe(false);
    expect(hasRealLandmarks(null)).toBe(false);
  });

  it("accepts real AWS landmark coordinates", () => {
    expect(hasRealLandmarks([{ type: "nose", x: 0.5, y: 0.5 }])).toBe(true);
  });

  it("only builds edges whose endpoints both exist", () => {
    const mesh = buildLandmarkMesh([
      { type: "mouthLeft", x: 0.4, y: 0.7 },
      { type: "mouthUp", x: 0.5, y: 0.68 },
    ]);
    expect(mesh).toEqual([{ x1: 0.4, y1: 0.7, x2: 0.5, y2: 0.68 }]);
  });

  it("returns no mesh when landmarks are unrelated", () => {
    expect(buildLandmarkMesh([{ type: "nose", x: 0.5, y: 0.5 }])).toEqual([]);
  });
});
