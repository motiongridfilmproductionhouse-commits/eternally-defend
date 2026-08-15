import { describe, expect, it } from "vitest";
import {
  BLOCKED_RETRIEVAL_MESSAGE,
  blockedRetrievalMessage,
  deriveAssetStatus,
  SOCIAL_STATUS_LABEL,
} from "./status";

describe("deriveAssetStatus", () => {
  it("reports processing until a fingerprint exists", () => {
    const view = deriveAssetStatus({ fingerprinted: false, hasTarget: false, profileStatus: "ACTIVE" });
    expect(view.status).toBe("processing");
  });

  it("reports protection active only when a recurring target exists", () => {
    const view = deriveAssetStatus({ fingerprinted: true, hasTarget: true, profileStatus: "ACTIVE" });
    expect(view.status).toBe("protection_active");
    expect(view.reason).toBeNull();
  });

  it("never implies activation when authorization is not ACTIVE", () => {
    const view = deriveAssetStatus({
      fingerprinted: true,
      hasTarget: false,
      profileStatus: "PENDING_AUTHORIZATION",
    });
    expect(view.status).toBe("waiting_for_authorization");
    expect(view.reason).toContain("authorization is pending authorization");
  });

  it("explains a paused profile explicitly", () => {
    const view = deriveAssetStatus({
      fingerprinted: true,
      hasTarget: false,
      profileStatus: "ACTIVE",
      profilePaused: true,
    });
    expect(view.status).toBe("waiting_for_authorization");
    expect(view.reason).toContain("paused");
  });

  it("explains a missing profile", () => {
    const view = deriveAssetStatus({ fingerprinted: true, hasTarget: false, profileStatus: null });
    expect(view.status).toBe("waiting_for_authorization");
    expect(view.reason).toContain("no protection profile");
  });

  it("reports fingerprint ready when everything permits enrollment", () => {
    const view = deriveAssetStatus({
      fingerprinted: true,
      hasTarget: false,
      profileStatus: "ACTIVE",
      profilePaused: false,
      autoScanEnabled: true,
    });
    expect(view.status).toBe("fingerprint_ready");
  });

  it("never labels a public reference as connected or verified", () => {
    const labels = Object.values(SOCIAL_STATUS_LABEL).join(" ").toLowerCase();
    expect(labels).not.toContain("connected");
    expect(labels).not.toContain("verified");
    expect(SOCIAL_STATUS_LABEL.public_reference).toBe("Public reference");
  });
});

describe("blockedRetrievalMessage", () => {
  it("uses the approved non-alarming Instagram copy", () => {
    expect(blockedRetrievalMessage("instagram")).toBe(BLOCKED_RETRIEVAL_MESSAGE);
    expect(BLOCKED_RETRIEVAL_MESSAGE).toContain("Upload the original photo or video");
    expect(BLOCKED_RETRIEVAL_MESSAGE.toLowerCase()).not.toContain("error");
  });

  it("names other platforms without alarming language", () => {
    expect(blockedRetrievalMessage("tiktok")).toContain("Tiktok");
  });
});
