import { describe, expect, it } from "vitest";
import {
  associateFinding,
  buildRadarFinding,
  colorFor,
  containsBiometricIdentifiers,
  countFindings,
  normalizeCopyright,
  normalizeDeepfake,
  normalizeFaceMatch,
  normalizeReputation,
  placeNode,
  type CampaignContext,
  type RawFinding,
} from "./radar-model";

const baseCampaign: CampaignContext = {
  id: "c1",
  name: "New Movie Launch",
  status: "ACTIVE",
  starts_at: "2026-01-01T00:00:00.000Z",
  ends_at: "2026-02-01T00:00:00.000Z",
  official_urls: ["https://youtube.com/watch?v=trailer"],
  approved_accounts: ["@officialstudio"],
  approved_media_urls: ["https://cdn.studio.com/poster.jpg"],
  hashtags: ["#NewMovieLaunch"],
};

function raw(partial: Partial<RawFinding> = {}): RawFinding {
  return {
    kind: "reputation",
    id: "f1",
    category: "Reputation mention",
    platform: "Web",
    title: null,
    url: "https://example.com/story",
    thumbnailUrl: null,
    confidence: 40,
    evidenceStatus: "Classified",
    pipelineVerified: false,
    pipelineSuspicious: false,
    reach: 100,
    detectedAt: "2026-01-15T00:00:00.000Z",
    ...partial,
  };
}

describe("campaign association", () => {
  it("treats approved campaign usage inside the window as AUTHORIZED", () => {
    const f = raw({ url: "https://youtube.com/watch?v=trailer" });
    const r = associateFinding(f, [baseCampaign], new Date("2026-01-15T00:00:00Z"));
    expect(r.association).toBe("AUTHORIZED");
    expect(r.campaignId).toBe("c1");
  });

  it("flags the same approved surface after expiry as POSSIBLE_UNAUTHORIZED_AD", () => {
    const f = raw({ url: "https://youtube.com/watch?v=trailer" });
    const r = associateFinding(f, [baseCampaign], new Date("2026-03-15T00:00:00Z"));
    expect(r.association).toBe("POSSIBLE_UNAUTHORIZED_AD");
  });

  it("flags ad-like campaign mentions after the window closes for review only", () => {
    const f = raw({
      title: "New Movie Launch endorsement banner",
      category: "Unauthorized advertisement",
      url: "https://randomads.example/x",
    });
    const r = associateFinding(f, [baseCampaign], new Date("2026-05-01T00:00:00Z"));
    expect(r.association).toBe("POSSIBLE_UNAUTHORIZED_AD");
  });

  it("retains the underlying finding even when AUTHORIZED", () => {
    const f = raw({ url: "https://youtube.com/watch?v=trailer", id: "keepme" });
    const node = buildRadarFinding(f, [baseCampaign], new Date("2026-01-15T00:00:00Z"));
    expect(node.id).toBe("keepme");
    expect(node.evidenceStatus).toBe("Classified");
    expect(node.color).toBe("green");
  });

  it("honours a stored association override", () => {
    const r = associateFinding(raw(), [baseCampaign], new Date(), {
      campaign_id: "c1",
      association: "MISUSE",
    });
    expect(r.association).toBe("MISUSE");
    expect(r.campaignName).toBe("New Movie Launch");
  });
});

describe("colour rules", () => {
  it("never makes a face similarity match red on match alone", () => {
    const f = normalizeFaceMatch({
      id: "fm1",
      source_url: "https://example.com/pic",
      source_type: "web",
      similarity: 99,
      threat_category: "Face Misuse",
      review_status: "pending",
      created_at: "2026-01-10T00:00:00Z",
    });
    expect(f.pipelineVerified).toBe(false);
    expect(colorFor(f, "REVIEW")).toBe("yellow");
  });

  it("turns red only for pipeline-verified / high-confidence findings", () => {
    const verified = normalizeDeepfake({
      id: "d1",
      url: "https://bad.example/x",
      canonical_url: null,
      page_title: "x",
      source_host: "bad.example",
      confidence: 96,
      risk_level: "critical",
      finding_classification: "verified_synthetic",
      content_category: "explicit",
      review_status: "pending",
      created_at: "2026-01-10T00:00:00Z",
    });
    expect(colorFor(verified, "REVIEW")).toBe("red");

    const probable = normalizeCopyright({
      id: "cp1",
      source_url: "https://pirate.example/x",
      page_title: null,
      platform: null,
      thumbnail_url: null,
      confidence: 75,
      confidence_band: "probable",
      detection_type: "frame_match",
      review_status: "pending",
      created_at: "2026-01-10T00:00:00Z",
    });
    expect(colorFor(probable, "REVIEW")).toBe("orange");
  });

  it("uses green for authorized usage and orange for possible unauthorized ad use", () => {
    expect(colorFor(raw(), "AUTHORIZED")).toBe("green");
    expect(colorFor(raw(), "POSSIBLE_UNAUTHORIZED_AD")).toBe("orange");
  });
});

describe("deterministic placement", () => {
  it("returns identical coordinates for the same finding", () => {
    const a = placeNode("deepfake", "abc-123");
    const b = placeNode("deepfake", "abc-123");
    expect(a).toEqual(b);
    expect(a.angle).toBeGreaterThanOrEqual(0);
    expect(a.angle).toBeLessThan(360);
    expect(a.radius).toBeGreaterThanOrEqual(20);
    expect(a.radius).toBeLessThanOrEqual(46);
  });

  it("differs across findings", () => {
    expect(placeNode("deepfake", "abc-123")).not.toEqual(placeNode("deepfake", "abc-124"));
  });
});

describe("payload safety", () => {
  it("normalized findings carry no biometric identifiers", () => {
    const node = buildRadarFinding(
      normalizeFaceMatch({
        id: "fm2",
        source_url: "https://example.com/p",
        source_type: "web",
        similarity: 0.9,
        threat_category: "Impersonation",
        review_status: "pending",
        created_at: "2026-01-10T00:00:00Z",
      }),
      [],
    );
    expect(containsBiometricIdentifiers(node)).toBe(false);
  });

  it("detects a leaked biometric identifier", () => {
    expect(containsBiometricIdentifiers({ face_id: "aws-face" })).toBe(true);
    expect(containsBiometricIdentifiers({ s3_key: "clients/x/y" })).toBe(true);
  });
});

describe("counters", () => {
  it("counts only real findings", () => {
    const nodes = [
      buildRadarFinding(raw({ kind: "reputation", id: "r1" }), []),
      buildRadarFinding(
        raw({ kind: "reputation", id: "r2", category: "Fake endorsement" }),
        [],
      ),
      buildRadarFinding(raw({ kind: "deepfake", id: "d1" }), []),
    ];
    const c = countFindings(nodes, { protectedFaces: 1, evidenceItems: 4 });
    expect(c.reputationFindings).toBe(2);
    expect(c.deepfakeAlerts).toBe(1);
    expect(c.fakeEndorsements).toBe(1);
    expect(c.protectedFaces).toBe(1);
    expect(c.evidenceItems).toBe(4);
    expect(c.impersonation).toBe(0);
  });
});

describe("normalization", () => {
  it("maps reputation severity to a category and evidence status", () => {
    const f = normalizeReputation({
      id: "r9",
      source: "News",
      title: "Story",
      permalink: "https://news.example/a",
      canonical_url: null,
      thumbnail_url: null,
      reach: 5000,
      severity: "critical",
      risk_type: "defamation",
      tags: null,
      threat_score: 9,
      risk_score: null,
      first_seen_at: "2026-01-11T00:00:00Z",
      published_at: null,
    });
    expect(f.category).toBe("Defamatory content");
    expect(f.pipelineVerified).toBe(true);
    expect(f.reach).toBe(5000);
  });
});
