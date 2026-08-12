import { describe, expect, it } from "vitest";
import { buildStep1Payload, isStep1Valid, showsCompanyFields } from "./step1-profile-fields";
import type { Step1Form } from "./step1-profile-fields";

const base: Step1Form = {
  legal_name: "Asha Menon",
  display_name: "Asha",
  company_name: "",
  role_title: "",
  email: "asha@example.com",
  phone: "",
  country: "India",
  address: "",
  client_type: "celebrity",
};

describe("step 1 client-type conditional fields", () => {
  it("hides Company Name and Role / Title for celebrity", () => {
    expect(showsCompanyFields("celebrity")).toBe(false);
  });

  it("celebrity is valid without company or role values", () => {
    expect(isStep1Valid({ ...base, company_name: "", role_title: "" })).toBe(true);
  });

  it("does not persist stale hidden company/role values for celebrity", () => {
    const payload = buildStep1Payload({
      ...base,
      company_name: "Stale Talent LLP",
      role_title: "Manager",
    });
    expect(payload.company_name).toBe("");
    expect(payload.role_title).toBe("");
  });

  it("clears values when switching representative -> celebrity", () => {
    const asAgency: Step1Form = {
      ...base,
      client_type: "agency",
      company_name: "Stale Talent LLP",
      role_title: "Manager",
    };
    expect(buildStep1Payload(asAgency).company_name).toBe("Stale Talent LLP");
    const switched = { ...asAgency, client_type: "celebrity" };
    expect(isStep1Valid(switched)).toBe(true);
    expect(buildStep1Payload(switched)).toMatchObject({ company_name: "", role_title: "" });
  });

  it("shows company fields for representative/organization types", () => {
    for (const type of [
      "business",
      "corporate",
      "agency",
      "manager_agent",
      "pr_team",
      "legal_representative",
      "enterprise",
    ]) {
      expect(showsCompanyFields(type)).toBe(true);
    }
  });

  it("preserves existing behavior for other client types", () => {
    expect(showsCompanyFields("individual")).toBe(true);
    expect(showsCompanyFields("creator")).toBe(true);
    const org: Step1Form = {
      ...base,
      client_type: "business",
      company_name: "Motiongrid",
      role_title: "CEO",
    };
    expect(buildStep1Payload(org)).toMatchObject({
      company_name: "Motiongrid",
      role_title: "CEO",
    });
    expect(isStep1Valid({ ...org, email: "" })).toBe(false);
    expect(isStep1Valid({ ...base, country: "" })).toBe(false);
  });
});
