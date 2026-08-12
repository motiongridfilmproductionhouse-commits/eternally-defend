import { describe, it, expect } from "vitest";
import {
  buildProtectionCertificateModel,
  buildFaceProtectionSummary,
  buildDigitalAssetSummary,
  containsForbiddenExportData,
  CERTIFICATE_FILENAME,
  BUNDLE_FILENAME,
} from "./final-package";

const certificate = {
  certificate_number: "ETC-2026-0042",
  score: 92,
  status: "ACTIVE",
  issued_at: "2026-08-12T10:00:00.000Z",
  expires_at: "2027-08-12T10:00:00.000Z",
  verification_badge: "VERIFIED_CELEBRITY",
  public_slug: "abc123",
};

const authorization = {
  auth_number: "ETA-2026-0042",
  status: "ACTIVE",
  effective_date: "2026-08-12",
  expiry_date: "2027-08-12",
};

const snapshot = {
  profile: {
    client_id: "ETC-CL-1001",
    legal_name: "Sarayu Mohan",
    display_name: "Sarayu",
    country: "IN",
  },
  face: { status: "ACTIVE" },
  signatures: [{ status: "SIGNED", signed_at: "2026-08-12T10:05:00.000Z" }],
};

const model = buildProtectionCertificateModel({
  snapshot,
  certificate,
  authorization,
  protectedFaceCount: 1,
  publicBaseUrl: "https://eternally-defend.lovable.app",
});

describe("final protection certificate model", () => {
  it("carries the real client, authorization and protection state", () => {
    expect(model.clientName).toBe("Sarayu Mohan");
    expect(model.clientId).toBe("ETC-CL-1001");
    expect(model.certificateNumber).toBe("ETC-2026-0042");
    expect(model.authorizationId).toBe("ETA-2026-0042");
    expect(model.signedStatus).toBe("SIGNED");
    expect(model.signedDate).toBe("2026-08-12");
    expect(model.faceProtectionStatus).toBe("ACTIVE");
    expect(model.effectiveDate).toBe("2026-08-12");
    expect(model.expiryDate).toBe("2027-08-12");
    expect(model.verifyUrl).toBe("https://eternally-defend.lovable.app/verify/abc123");
  });

  it("reports NOT ENROLLED / NOT SIGNED without fabricating data", () => {
    const bare = buildProtectionCertificateModel({
      snapshot: { profile: { client_id: "X" } },
      certificate: { ...certificate, public_slug: null },
      authorization,
      protectedFaceCount: 0,
    });
    expect(bare.faceProtectionStatus).toBe("NOT ENROLLED");
    expect(bare.signedStatus).toBe("NOT SIGNED");
    expect(bare.signedDate).toBeNull();
    expect(bare.verifyUrl).toBeNull();
  });

  it("uses safe filenames for both downloads", () => {
    expect(CERTIFICATE_FILENAME(model.certificateNumber)).toMatch(/\.pdf$/);
    expect(BUNDLE_FILENAME(model.certificateNumber)).toMatch(/\.zip$/);
  });
});

describe("bundle summaries", () => {
  const faceText = buildFaceProtectionSummary({
    model,
    faces: [{ label: null, status: "ACTIVE", created_at: "2026-08-11T09:00:00.000Z" }],
  });
  const assetText = buildDigitalAssetSummary({
    model,
    assets: [
      {
        kind: "youtube_channel",
        name: "Sarayu Official",
        handle: "@sarayu",
        channel_url: "https://youtube.com/@sarayu",
        verification_status: "VERIFIED",
        verified_at: "2026-08-11T09:00:00.000Z",
      },
    ],
  });

  it("includes the enrollment and asset state", () => {
    expect(faceText).toContain("FACE PROTECTION SUMMARY");
    expect(faceText).toContain("enrolled 2026-08-11");
    expect(assetText).toContain("DIGITAL ASSET SUMMARY");
    expect(assetText).toContain("Sarayu Official");
  });

  it("never leaks biometric, AWS, storage or debug internals", () => {
    for (const text of [faceText, assetText]) {
      expect(containsForbiddenExportData(text)).toBe(false);
    }
  });

  it("flags forbidden export data when present", () => {
    expect(containsForbiddenExportData("faceId: 1234-abcd")).toBe(true);
  });
});
