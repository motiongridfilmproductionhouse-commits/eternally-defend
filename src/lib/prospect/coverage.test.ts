import { describe, expect, it } from "vitest";
import { computeCoverage, zeroFindingsLabel, type SourceRow } from "./coverage";
import { intendedFamilies, policyDisabledFamilies, platformForUrl } from "./source-registry";

function rows(states: Record<string, SourceRow["state"]>): SourceRow[] {
  return intendedFamilies().map((family) => ({
    family_key: family.key,
    state: states[family.key] ?? "unavailable",
    weight_class: family.weightClass,
    direct_access: family.directAccess,
  }));
}

describe("coverage model", () => {
  it("caps at PARTIAL while any major family is unavailable", () => {
    const all: Record<string, SourceRow["state"]> = {};
    for (const family of intendedFamilies()) all[family.key] = "results_found";
    all.instagram = "unavailable";
    const report = computeCoverage(rows(all));
    expect(report.state).toBe("PARTIAL");
    expect(report.majorUnavailable).toContain("instagram");
    expect(report.qualified).toBe(true);
  });

  it("reports COMPLETE only when every intended family succeeded", () => {
    const all: Record<string, SourceRow["state"]> = {};
    for (const family of intendedFamilies()) all[family.key] = "no_results";
    const report = computeCoverage(rows(all));
    expect(report.state).toBe("COMPLETE");
    expect(report.qualified).toBe(false);
  });

  it("reports INSUFFICIENT when core web discovery failed", () => {
    const report = computeCoverage(
      rows({ youtube: "results_found", news: "results_found", images: "results_found" }),
    );
    expect(report.state).toBe("INSUFFICIENT");
  });

  it("reports LIMITED between 30% and 60% success", () => {
    const report = computeCoverage(
      rows({ google_search: "results_found", web_general: "results_found", news: "results_found" }),
    );
    expect(report.state).toBe("LIMITED");
  });

  it("never phrases a zero-finding result as low risk", () => {
    expect(zeroFindingsLabel("PARTIAL")).toBe(
      "No relevant findings in scanned sources · Coverage: Partial",
    );
    expect(zeroFindingsLabel("PARTIAL")).not.toMatch(/low risk/i);
  });
});

describe("source registry", () => {
  it("keeps Reddit disabled by policy and out of the intended set", () => {
    expect(policyDisabledFamilies().map((f) => f.key)).toContain("reddit");
    expect(intendedFamilies().map((f) => f.key)).not.toContain("reddit");
  });

  it("attributes platform URLs without claiming the platform was scanned", () => {
    expect(platformForUrl("https://www.instagram.com/p/xyz")).toEqual({
      platform: "Instagram",
      familyKey: "instagram",
    });
    const instagram = intendedFamilies().find((f) => f.key === "instagram");
    expect(instagram?.directAccess).toBe(false);
  });
});
