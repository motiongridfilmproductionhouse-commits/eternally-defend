import { describe, expect, it } from "vitest";
import { shouldShowRafmohNotice } from "./removal-status-notice";

describe("temporary account-specific removal notice", () => {
  it("is available to sijoj4464@gmail.com", () => {
    expect(shouldShowRafmohNotice("sijoj4464@gmail.com")).toBe(true);
    expect(shouldShowRafmohNotice("SIJOJ4464@gmail.com")).toBe(true);
  });
  it("is unavailable to other accounts and signed-out visitors", () => {
    for (const email of [undefined, null, "", "hellosreehari@gmail.com", "sijoj4464@gmail.com.attacker.example"]) {
      expect(shouldShowRafmohNotice(email)).toBe(false);
    }
  });
});