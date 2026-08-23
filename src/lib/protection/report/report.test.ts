import { describe, expect, it } from "vitest";
import {
  normalizeCopyrightMatch,
  normalizeDeepfakeFinding,
  normalizeScanHit,
  normalizeYoutubeRemovalFinding,
} from "./normalize";
import { classifyDiscoveries, countByEligibility, type EligibilityContext } from "./eligibility";
import type { ReportDiscovery } from "./types";

function ctx(overrides: Partial<EligibilityContext> = {}): EligibilityContext {
  return {
    caseByUrl: new Map(),
    verifiedRouteDomains: new Set(),
    authorizationActive: true,
    assetOwnershipVerified: true,
    ...overrides,
  };
}

describe("normalizers", () => {
  it("marks only confirmed, non-rejected copyright matches as module-verified", () => {
    const base = {
      id: "c1",
      source_url: "https://pirate.example/movie",
      page_title: "Full movie",
      platform: "web",
      confidence: 95,
      detection_type: "phash",
      ocr_text: null,
      reason: "frame match",
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(
      normalizeCopyrightMatch({ ...base, confidence_band: "confirmed", review_status: "pending" })
        .moduleVerified,
    ).toBe(true);
    expect(
      normalizeCopyrightMatch({ ...base, confidence_band: "confirmed", review_status: "rejected" })
        .moduleVerified,
    ).toBe(false);
    expect(
      normalizeCopyrightMatch({ ...base, confidence_band: "possible", review_status: "pending" })
        .moduleVerified,
    ).toBe(false);
  });

  it("uses takedown_recommended as the deepfake verified bar", () => {
    const row = {
      id: "d1",
      url: "https://bad.example/x",
      canonical_url: "https://bad.example/x",
      page_title: "clip",
      snippet: null,
      source_host: "bad.example",
      content_category: "synthetic_intimate",
      risk_level: "critical",
      confidence: 92,
      is_synthetic: true,
      face_referenced: true,
      ai_reasoning: "swap artifacts",
      review_status: "pending",
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(normalizeDeepfakeFinding({ ...row, takedown_recommended: true }).moduleVerified).toBe(
      true,
    );
    expect(normalizeDeepfakeFinding({ ...row, takedown_recommended: false }).moduleVerified).toBe(
      false,
    );
  });

  it("mirrors the youtube actionable gate", () => {
    const row = {
      id: "y1",
      video_url: "https://youtube.com/watch?v=1",
      title: "vid",
      channel_title: "ch",
      subject_status: "confirmed",
      channel_class: "anonymous",
      risk_level: "high",
      recommended_action: "REMOVAL_REQUEST",
      assessment_reason: "impersonation",
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(normalizeYoutubeRemovalFinding(row).moduleVerified).toBe(true);
    expect(
      normalizeYoutubeRemovalFinding({ ...row, channel_class: "official_news" }).moduleVerified,
    ).toBe(false);
    expect(normalizeYoutubeRemovalFinding({ ...row, risk_level: "low" }).moduleVerified).toBe(false);
    expect(
      normalizeYoutubeRemovalFinding({ ...row, subject_status: "not_subject" }).moduleVerified,
    ).toBe(false);
  });

  it("treats only critical/high scan hits as verified", () => {
    const row = {
      id: "s1",
      canonical_url: "https://news.example/a",
      permalink: null,
      title: "story",
      description: null,
      source: "web",
      author: null,
      risk_type: "DEFAMATION",
      threat_score: 80,
      risk_score: null,
      detected_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
    };
    expect(normalizeScanHit({ ...row, severity: "critical" }).moduleVerified).toBe(true);
    expect(normalizeScanHit({ ...row, severity: "medium" }).moduleVerified).toBe(false);
  });
});

function discovery(overrides: Partial<ReportDiscovery> = {}): ReportDiscovery {
  return {
    id: "x",
    module: "copyright_intel",
    title: "t",
    sourceUrl: "https://pirate.example/movie",
    discoveredAt: null,
    confidence: 95,
    confidenceLabel: "Exact match",
    evidence: [],
    status: "pending",
    moduleVerified: true,
    ...overrides,
  };
}

describe("eligibility classifier", () => {
  it("classifies a similar-but-unconfirmed discovery as not eligible", () => {
    const [d] = classifyDiscoveries([discovery({ moduleVerified: false })], ctx());
    expect(d.eligibility).toBe("NOT_REMOVAL_ELIGIBLE");
    expect(d.eligibilityReasons.length).toBeGreaterThan(0);
  });

  it("requires review when no verified removal route exists", () => {
    const [d] = classifyDiscoveries([discovery()], ctx());
    expect(d.eligibility).toBe("REQUIRES_REVIEW");
    expect(d.eligibilityReasons.join(" ")).toContain("pirate.example");
  });

  it("requires review when authorization is not active", () => {
    const [d] = classifyDiscoveries(
      [discovery()],
      ctx({
        verifiedRouteDomains: new Set(["pirate.example"]),
        authorizationActive: false,
      }),
    );
    expect(d.eligibility).toBe("REQUIRES_REVIEW");
  });

  it("marks eligible only when every existing precondition is met", () => {
    const [d] = classifyDiscoveries(
      [discovery()],
      ctx({ verifiedRouteDomains: new Set(["pirate.example"]) }),
    );
    expect(d.eligibility).toBe("REMOVAL_ELIGIBLE");
  });

  it("defers to an existing enforcement case verdict", () => {
    const caseByUrl = new Map([
      ["https://pirate.example/movie", { status: "NOT_ELIGIBLE", details: "policy is MANUAL" }],
    ]);
    const [d] = classifyDiscoveries(
      [discovery()],
      ctx({ caseByUrl, verifiedRouteDomains: new Set(["pirate.example"]) }),
    );
    expect(d.eligibility).toBe("NOT_REMOVAL_ELIGIBLE");
    expect(d.eligibilityReasons[0]).toBe("policy is MANUAL");
  });

  it("counts by eligibility", () => {
    const classified = classifyDiscoveries(
      [discovery({ id: "a" }), discovery({ id: "b", moduleVerified: false })],
      ctx(),
    );
    expect(countByEligibility(classified)).toEqual({
      discovered: 2,
      eligible: 0,
      review: 1,
      notEligible: 1,
    });
  });
});

describe("report path is enforcement-free", () => {
  it("never writes enforcement tables when building a report", async () => {
    const writes: string[] = [];
    const table = (name: string) => {
      const chain: Record<string, unknown> = {};
      const ret = () => chain;
      Object.assign(chain, {
        select: ret,
        eq: ret,
        in: ret,
        gte: ret,
        order: ret,
        limit: ret,
        maybeSingle: async () =>
          name === "copyright_scans"
            ? { data: { id: "scan1", status: "completed", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:05:00Z" } }
            : { data: null },
        then: (resolve: (v: unknown) => void) => resolve({ data: [], count: 0 }),
        insert: (payload: unknown) => {
          writes.push(name);
          return { select: () => ({ single: async () => ({ data: payload }) }) };
        },
        update: () => {
          writes.push(name);
          return chain;
        },
      });
      return chain;
    };
    const supabase = { from: (name: string) => table(name) };

    const { buildScanReport } = await import("./build.server");
    await buildScanReport(supabase, {
      userId: "u1",
      moduleKey: "copyright_intel",
      scanId: "scan1",
    });

    expect(writes.filter((t) => t.startsWith("enforcement"))).toEqual([]);
    expect(writes).toContain("generated_reports");
  });
});
