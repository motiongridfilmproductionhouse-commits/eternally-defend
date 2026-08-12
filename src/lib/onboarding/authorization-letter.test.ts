import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_CATEGORIES,
  LETTER_TITLE,
  SERVICE_PROVIDER_NAME,
  authorizationLevel,
  authorizingParagraph,
  coveredAssets,
  footerText,
  limitationClauses,
  resolveClientParty,
  selectedCategories,
} from "./authorization-letter";

const scopes = (...granted: string[]) =>
  [
    "monitor_public",
    "monitor_verified_assets",
    "detect_face_misuse",
    "collect_evidence",
    "monitoring_reports",
    "prepare_copyright",
    "prepare_privacy",
    "prepare_impersonation",
    "prepare_hosting",
    "communicate_platforms",
    "track_enforcement",
    "follow_up_cases",
    "submit_final_after_approval",
  ].map((scope_key) => ({ scope_key, granted: granted.includes(scope_key) }));

describe("letter identity", () => {
  it("is issued to Eterna Sentinel Defence LLC with the required title", () => {
    expect(SERVICE_PROVIDER_NAME).toBe("ETERNA SENTINEL DEFENCE LLC");
    expect(LETTER_TITLE).toBe(
      "Digital Identity, Reputation & Content Protection Authorization",
    );
  });

  it("defines exactly the seven authorization categories", () => {
    expect(AUTHORIZATION_CATEGORIES.map((c) => c.title)).toEqual([
      "Reputation and public-web monitoring",
      "Impersonation and fraudulent-profile detection",
      "Face/image misuse and deepfake detection",
      "Copyright and unauthorized-content monitoring",
      "Campaign/asset monitoring",
      "Evidence collection and preservation",
      "Preparing/submitting platform reports or takedown requests when separately authorized",
    ]);
  });
});

describe("scope coverage is limited to client selections", () => {
  it("lists only categories backed by a granted scope", () => {
    const result = selectedCategories(scopes("monitor_public", "detect_face_misuse"));
    expect(result.map((c) => c.id)).toEqual(["reputation_monitoring", "face_misuse_detection"]);
  });

  it("covers nothing when the client granted nothing", () => {
    expect(selectedCategories(scopes())).toEqual([]);
    expect(selectedCategories(null)).toEqual([]);
  });

  it("includes all seven when every scope is granted", () => {
    const all = scopes(...scopes().map((s) => s.scope_key));
    expect(selectedCategories(all)).toHaveLength(7);
  });
});

describe("authorization level", () => {
  it("floors at monitoring only", () => {
    expect(authorizationLevel(scopes("monitor_public"))).toBe("MONITORING_ONLY");
  });

  it("escalates to preparation and submission based on real selections", () => {
    expect(authorizationLevel(scopes("prepare_copyright"))).toBe("REPORT_PREPARATION");
    expect(authorizationLevel(scopes("submit_final_after_approval"))).toBe("REPORT_SUBMISSION");
  });
});

describe("limitations", () => {
  const clauses = limitationClauses(scopes("monitor_public")).join(" ");

  it("keeps ownership with the client and grants no unlimited authority", () => {
    expect(clauses).toMatch(/remains solely with the Client/);
    expect(clauses).toMatch(/transfers no ownership/);
    expect(clauses.toLowerCase()).not.toContain("unlimited");
    expect(clauses.toLowerCase()).not.toContain("full power of attorney");
  });

  it("limits scope, bars unrelated contracts, gates enforcement and allows revocation", () => {
    expect(clauses).toMatch(/limited to the protection services expressly selected/);
    expect(clauses).toMatch(/may not enter into contracts/);
    expect(clauses).toMatch(/authorization level selected during onboarding/);
    expect(clauses).toMatch(/may be revoked by the Client/);
  });

  it("states the selected enforcement level inside the enforcement clause", () => {
    expect(limitationClauses(scopes("monitor_public"))[3]).toMatch(/no reports submitted/);
    expect(limitationClauses(scopes("submit_final_after_approval"))[3]).toMatch(
      /submission of platform reports/,
    );
  });
});

describe("real party and asset data", () => {
  it("uses the actual profile values, not placeholders", () => {
    const party = resolveClientParty({
      legal_name: "Sarayu Mohan",
      display_name: "Sarayu",
      client_type: "celebrity",
      country: "India",
    });
    expect(party).toEqual({
      legalName: "Sarayu Mohan",
      displayName: "Sarayu",
      clientType: "Celebrity",
      country: "India",
    });
    expect(authorizingParagraph(party)).toContain("Sarayu Mohan");
    expect(authorizingParagraph(party)).toContain("professionally known as Sarayu");
    expect(authorizingParagraph(party)).toContain(SERVICE_PROVIDER_NAME);
  });

  it("does not fabricate a display name when none exists", () => {
    const party = resolveClientParty({ legal_name: "Acme Films LLP" });
    expect(party.displayName).toBe("Acme Films LLP");
    expect(authorizingParagraph(party)).not.toContain("professionally known as");
  });

  it("covers only verified assets", () => {
    const list = coveredAssets([
      { kind: "youtube", name: "Motiongrid", verification_status: "VERIFIED", url: "u1" },
      { kind: "youtube", name: "Pending", verification_status: "PENDING" },
    ]);
    expect(list).toEqual([{ label: "YOUTUBE — Motiongrid", meta: "u1" }]);
  });
});

describe("footer", () => {
  it("carries the authorization id and document version", () => {
    expect(footerText("AUTH-2026-753952", 1)).toBe(
      "Authorization ID: AUTH-2026-753952  |  Document Version: v1  |  ETERNA SENTINEL DEFENCE LLC",
    );
  });
});
