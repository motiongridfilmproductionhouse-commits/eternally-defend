import { describe, expect, it } from "vitest";
import {
  COMPANY_FLOW,
  availableCompanyServices,
  companyCanEnforce,
  companyCanMonitor,
  deriveCompanyAuthorityStatus,
  emailMatchesCompanyDomain,
  normalizeDomain,
  scopesForCompanyServices,
} from "./company-config";

describe("company flow", () => {
  it("has six sequential steps ending in completion", () => {
    expect(COMPANY_FLOW.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(COMPANY_FLOW.at(-1)?.key).toBe("company_complete");
  });

  it("collects official social profiles before review", () => {
    const keys = COMPANY_FLOW.map((s) => s.key);
    expect(keys.indexOf("company_social")).toBeLessThan(keys.indexOf("company_review"));
  });

  it("never includes a Veriff identity or email OTP step", () => {
    expect(COMPANY_FLOW.some((s) => (s.key as string).includes("veriff"))).toBe(false);
    expect(COMPANY_FLOW.some((s) => (s.key as string).includes("otp"))).toBe(false);
  });
});

describe("domain matching", () => {
  it("normalizes urls to bare hostnames", () => {
    expect(normalizeDomain("https://www.Acme.com/about?x=1")).toBe("acme.com");
    expect(normalizeDomain("acme")).toBeNull();
  });

  it("matches work email against the official website", () => {
    expect(emailMatchesCompanyDomain("ceo@acme.com", "https://acme.com")).toBe(true);
    expect(emailMatchesCompanyDomain("ceo@mail.acme.com", "acme.com")).toBe(true);
    expect(emailMatchesCompanyDomain("ceo@gmail.com", "acme.com")).toBe(false);
    expect(emailMatchesCompanyDomain("", "acme.com")).toBe(false);
  });
});

describe("company authority status", () => {
  it("defaults to pending with no signals", () => {
    expect(
      deriveCompanyAuthorityStatus({
        businessEmailVerified: false,
        workEmailMatchesCompanyDomain: false,
        registrationNumberProvided: false,
      }),
    ).toBe("AUTHORITY_PENDING");
  });

  it("marks company verified once the business email is confirmed", () => {
    expect(
      deriveCompanyAuthorityStatus({
        businessEmailVerified: true,
        workEmailMatchesCompanyDomain: false,
        registrationNumberProvided: false,
      }),
    ).toBe("COMPANY_VERIFIED");
  });

  it("grants representative authority on domain + registration evidence", () => {
    expect(
      deriveCompanyAuthorityStatus({
        businessEmailVerified: true,
        workEmailMatchesCompanyDomain: true,
        registrationNumberProvided: true,
      }),
    ).toBe("AUTHORIZED_REPRESENTATIVE");
  });

  it("grants representative authority on an approved authority document", () => {
    expect(
      deriveCompanyAuthorityStatus({
        businessEmailVerified: false,
        workEmailMatchesCompanyDomain: false,
        registrationNumberProvided: false,
        authorityDocumentStatus: "APPROVED",
      }),
    ).toBe("AUTHORIZED_REPRESENTATIVE");
  });

  it("allows monitoring while pending but blocks enforcement", () => {
    expect(companyCanMonitor("AUTHORITY_PENDING")).toBe(true);
    expect(companyCanMonitor("COMPANY_VERIFIED")).toBe(true);
    expect(companyCanEnforce("AUTHORITY_PENDING")).toBe(false);
    expect(companyCanEnforce("COMPANY_VERIFIED")).toBe(false);
    expect(companyCanEnforce("AUTHORIZED_REPRESENTATIVE")).toBe(true);
  });
});

describe("protection services", () => {
  it("hides face/deepfake protection until a face is enrolled", () => {
    expect(availableCompanyServices(false).some((s) => s.key === "face_deepfake_protection")).toBe(
      false,
    );
    expect(availableCompanyServices(true).some((s) => s.key === "face_deepfake_protection")).toBe(
      true,
    );
  });

  it("maps selected services onto granular scopes", () => {
    const scopes = scopesForCompanyServices(["brand_reputation_monitoring"], false);
    expect(scopes["monitor_public"]).toBe(true);
    expect(scopes["monitoring_reports"]).toBe(true);
    expect(scopes["submit_final_after_approval"]).toBe(true);
    expect(scopes["detect_face_misuse"]).toBeUndefined();
  });

  it("ignores face scopes when no face is enrolled", () => {
    expect(scopesForCompanyServices(["face_deepfake_protection"], false)).toEqual({});
    expect(scopesForCompanyServices(["face_deepfake_protection"], true)["detect_face_misuse"]).toBe(
      true,
    );
  });
});
