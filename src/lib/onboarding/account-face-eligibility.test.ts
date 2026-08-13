import { describe, it, expect } from "vitest";
import {
  faceProtectionApplies,
  isCompanyAccount,
  requiresFaceProtection,
  v2FlowForAccount,
} from "./v2-config";

describe("account-type face protection eligibility", () => {
  it("COMPANY accounts: no face enrollment banner or dependency", () => {
    for (const t of ["enterprise", "production_house"] as const) {
      expect(isCompanyAccount(t)).toBe(true);
      expect(faceProtectionApplies(t)).toBe(false);
      expect(requiresFaceProtection(t)).toBe(false);
      const stepKeys = v2FlowForAccount(t).map((s) => String(s.key));
      expect(stepKeys.some((k) => k.includes("face"))).toBe(false);
    }
  });

  it("CELEBRITY / individual accounts keep face protection available", () => {
    expect(isCompanyAccount("celebrity")).toBe(false);
    expect(faceProtectionApplies("celebrity")).toBe(true);
    expect(faceProtectionApplies("individual")).toBe(true);
    expect(requiresFaceProtection("individual")).toBe(true);
  });

  it("unknown account type keeps legacy behaviour", () => {
    expect(faceProtectionApplies(null)).toBe(true);
  });
});
