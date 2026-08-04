import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canGenerateInterimReport } from "../../lib/deepfake/report-ui";

describe("canGenerateInterimReport", () => {
  it("allows interim for partial scans even without loaded findings count", () => {
    assert.equal(
      canGenerateInterimReport({ scanStatus: "partial", findingCount: 0 }),
      true,
    );
  });

  it("allows interim for running and completed scans", () => {
    assert.equal(
      canGenerateInterimReport({ scanStatus: "running", findingCount: 0 }),
      true,
    );
    assert.equal(
      canGenerateInterimReport({ scanStatus: "completed", findingCount: 2 }),
      true,
    );
  });

  it("blocks failed scans without findings", () => {
    assert.equal(
      canGenerateInterimReport({ scanStatus: "failed", findingCount: 0 }),
      false,
    );
  });
});
