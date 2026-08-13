import { describe, expect, it } from "vitest";
import {
  NOT_PROVIDED,
  buildSettingsProfileView,
  displayValue,
  showsOrganizationFields,
} from "./settings-profile";

const CELEBRITY_ROW = {
  legal_name: "Anjali Menon",
  display_name: "Anjali",
  email: "anjali@example.com",
  country: "India",
  client_type: "celebrity",
  onboarding_account_type: "celebrity",
  onboarding_completed: true,
  // Stale/irrelevant organizational values must never surface for a celebrity.
  company_name: "Eterna Labs",
  role_title: "Founder",
  social_profiles: { instagram: "https://instagram.com/anjali", x: "" },
};

const COMPANY_ROW = {
  legal_name: "Ravi Kumar",
  email: "ravi@motiongrid.com",
  client_type: "corporate",
  onboarding_account_type: "enterprise",
  company_name: "Motiongrid Film Production House",
  role_title: "Director",
};

describe("settings profile view", () => {
  it("shows a new celebrity's own persisted details", () => {
    const view = buildSettingsProfileView(CELEBRITY_ROW);
    expect(view.legalName).toBe("Anjali Menon");
    expect(view.displayName).toBe("Anjali");
    expect(view.email).toBe("anjali@example.com");
    expect(view.country).toBe("India");
    expect(view.clientType).toBe("celebrity");
    expect(view.isEmpty).toBe(false);
  });

  it("never shows company/role demo values for celebrity accounts", () => {
    const view = buildSettingsProfileView(CELEBRITY_ROW);
    expect(view.showsOrganizationFields).toBe(false);
    expect(view.companyName).toBe("");
    expect(view.roleTitle).toBe("");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("Eterna Labs");
    expect(serialized).not.toContain("Founder");
    expect(serialized).not.toContain("Sreehari");
  });

  it("keeps legitimate company and role for organization accounts", () => {
    const view = buildSettingsProfileView(COMPANY_ROW);
    expect(view.showsOrganizationFields).toBe(true);
    expect(view.companyName).toBe("Motiongrid Film Production House");
    expect(view.roleTitle).toBe("Director");
  });

  it("treats representative accounts as organizational", () => {
    for (const accountType of ["manager_agent", "pr_team", "legal_representative"]) {
      expect(showsOrganizationFields({ onboarding_account_type: accountType })).toBe(true);
    }
    expect(showsOrganizationFields({ onboarding_account_type: "individual" })).toBe(false);
  });

  it("leaves missing optional fields blank, never substituted", () => {
    const view = buildSettingsProfileView({
      legal_name: "New User",
      onboarding_account_type: "celebrity",
    });
    expect(view.displayName).toBe("");
    expect(view.phone).toBe("");
    expect(view.country).toBe("");
    expect(view.address).toBe("");
    expect(view.socialProfiles).toEqual([]);
    expect(displayValue(view.country)).toBe(NOT_PROVIDED);
  });

  it("returns a controlled empty state when no profile row exists", () => {
    const view = buildSettingsProfileView(null, "fresh@example.com");
    expect(view.isEmpty).toBe(true);
    expect(view.legalName).toBe("");
    expect(view.companyName).toBe("");
    // Only the authenticated session's own email may be used as a fallback.
    expect(view.email).toBe("fresh@example.com");
  });

  it("does not leak a previous account's values between views", () => {
    const first = buildSettingsProfileView(COMPANY_ROW);
    const second = buildSettingsProfileView(CELEBRITY_ROW);
    expect(second.companyName).toBe("");
    expect(second.legalName).not.toBe(first.legalName);
    expect(second.email).not.toBe(first.email);
  });

  it("ignores non-url social profile values", () => {
    const view = buildSettingsProfileView({
      onboarding_account_type: "celebrity",
      social_profiles: { instagram: "https://instagram.com/x", youtube: "not-a-url" },
    });
    expect(view.socialProfiles).toEqual([{ label: "Instagram", url: "https://instagram.com/x" }]);
  });
});
