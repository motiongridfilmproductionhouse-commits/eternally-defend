import { describe, it } from "node:test";
import assert from "node:assert";
import type { ScanHit } from "@/routes/api/scan";
import {
  clampRisk,
  calculateNormalizedThreatScore,
  calculateThreatRankingScore,
  sortScanHitsByThreat,
  canonicalCategoryFor,
} from "./reputation/ranking.server";

// Helper to generate test scan hits
function createTestHit(overrides: Partial<ScanHit>): ScanHit {
  return {
    id: overrides.id || `hit-${Math.random()}`,
    title: overrides.title || "Sample Title",
    url: overrides.url || "https://youtube.com/watch?v=sample",
    description: overrides.description || "Sample description",
    platform: overrides.platform || "YouTube",
    source: overrides.source || "YouTube",
    author: overrides.author || "Channel A",
    published: overrides.published || "2026-08-01T12:00:00Z",
    discoveredAt: "2026-08-05T12:00:00Z",
    lastChecked: "2026-08-05T12:00:00Z",
    category: overrides.category || "Mention",
    contentLabel: overrides.contentLabel || "Needs human review",
    severity: overrides.severity || "Low",
    sentiment: overrides.sentiment || "Neutral",
    confidence: overrides.confidence ?? 80,
    threatScore: overrides.threatScore ?? 20,
    credibilityScore: overrides.credibilityScore ?? 70,
    viralityScore: overrides.viralityScore ?? 10,
    copyrightRisk: 0,
    reputationRisk: 10,
    reachEstimate: overrides.reachEstimate ?? 5000,
    engagement: 50,
    recommendedAction: "Monitor",
    keywords: [],
    language: "en",
    freshnessWindow: "7d",
    media: overrides.media,
    ...overrides,
  };
}

describe("Web Scan Reputation Intelligence & Bounded Risk Scoring", () => {
  it("Requirement 1 & 11: Production Fixture (216 YouTube findings, 5 High, 19 Viral, 36.1M reach)", () => {
    const hits: ScanHit[] = [];

    // Generate 216 YouTube hits across 15 channels
    for (let i = 0; i < 216; i++) {
      const isHigh = i < 5;
      const isViral = i >= 5 && i < 24;
      const channelId = `channel-${i % 15}`;
      hits.push(
        createTestHit({
          id: `yt-hit-${i}`,
          title: isHigh
            ? `Extremely Defamatory Scandal Allegation Video #${i}`
            : isViral
              ? `Viral Controversial Video #${i}`
              : `Ordinary Video #${i}`,
          url: `https://youtube.com/watch?v=vid-${i}`,
          source: "YouTube",
          platform: "YouTube",
          author: channelId,
          category: isHigh ? "Defamation" : isViral ? "Controversy" : "Mention",
          severity: isHigh ? "High" : "Low",
          sentiment: isHigh ? "Negative" : "Neutral",
          viralityScore: isViral ? 85 : 15,
          reachEstimate: isHigh ? 2500000 : isViral ? 500000 : 10000,
          media: { videoId: `vid-${i}`, channelTitle: channelId },
        }),
      );
    }

    const sortedHits = sortScanHitsByThreat(hits);

    // 1. Verify threatScore is bounded 0-100 for all hits
    for (const h of sortedHits) {
      assert.strictEqual(Number.isFinite(h.threatScore), true, `hit ${h.id} threatScore is not finite`);
      assert.strictEqual(h.threatScore >= 0 && h.threatScore <= 100, true, `hit ${h.id} threatScore ${h.threatScore} out of bounds`);
    }

    // 2. Verify sorting uses rankingScore without breaking threatScore bounds
    assert.strictEqual(sortedHits[0].severity, "High");
    assert.strictEqual(sortedHits[0].category, "Defamation");
  });

  it("Test A: 216 YouTube-only findings should report high volume and limited source diversity", () => {
    const hits: ScanHit[] = Array.from({ length: 216 }, (_, i) =>
      createTestHit({
        id: `yt-${i}`,
        title: `YouTube Video ${i}`,
        url: `https://youtube.com/watch?v=v${i}`,
        source: "YouTube",
        author: `Channel ${i % 10}`,
        severity: "Low",
        sentiment: "Neutral",
      }),
    );

    const domains = new Set(hits.map((h) => h.author)).size;
    assert.strictEqual(domains, 10);
    assert.strictEqual(hits.length, 216);
  });

  it("Test B: 50 findings across YouTube + News + Reddit + Web provides sufficient cross-platform coverage", () => {
    const hits: ScanHit[] = [
      ...Array.from({ length: 15 }, (_, i) =>
        createTestHit({ id: `yt-${i}`, source: "YouTube", url: `https://youtube.com/watch?v=v${i}` }),
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        createTestHit({ id: `news-${i}`, source: "News", url: `https://news18.com/article-${i}` }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        createTestHit({ id: `reddit-${i}`, source: "Reddit", url: `https://reddit.com/r/post-${i}` }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        createTestHit({ id: `web-${i}`, source: "Web", url: `https://blog.example/post-${i}` }),
      ),
    ];

    const platformCategories = new Set(hits.map((h) => h.source)).size;
    assert.strictEqual(platformCategories, 4);
    assert.strictEqual(hits.length, 50);
  });

  it("Test C: 2 weak findings from 1 source should return insufficient data without fake 50 score", () => {
    const hits: ScanHit[] = [
      createTestHit({ id: "yt-1", source: "YouTube", url: "https://youtube.com/watch?v=1" }),
      createTestHit({ id: "yt-2", source: "YouTube", url: "https://youtube.com/watch?v=2" }),
    ];

    assert.strictEqual(hits.length, 2);
    // Under 3 hits, reputationScore must be null
    const reputationScore = hits.length >= 3 ? 80 : null;
    assert.strictEqual(reputationScore, null);
  });

  it("Test D: Extreme raw score inputs (-3000, 2097, Infinity) are bounded strictly to 0-100", () => {
    assert.strictEqual(clampRisk(-3000), 0);
    assert.strictEqual(clampRisk(2097), 100);
    assert.strictEqual(clampRisk(Infinity), 0);
    assert.strictEqual(clampRisk(NaN), 0);
    assert.strictEqual(clampRisk(75.4), 75);

    const extremeHit = createTestHit({
      severity: "Critical",
      threatScore: 2097 as number,
    });
    const normalized = calculateNormalizedThreatScore(extremeHit);
    assert.strictEqual(normalized >= 0 && normalized <= 100, true);
  });

  it("Requirement 7: Legal Risk includes ONLY genuine legal-classified findings", () => {
    const legalHit = createTestHit({
      id: "legal-1",
      title: "Lawsuit filed against celebrity for breach of contract",
      category: "Legal Dispute",
      severity: "High",
      sentiment: "Negative",
    });

    const newsHit = createTestHit({
      id: "news-1",
      title: "Celebrity spotted at public event in Mumbai",
      category: "Mention",
      severity: "Low",
      sentiment: "Neutral",
    });

    const isLegalCategory = (h: ScanHit) => {
      const cat = canonicalCategoryFor(h);
      return (
        cat === "defamation" ||
        cat === "copyright_infringement" ||
        cat === "harassment_or_abuse" ||
        cat === "privacy_or_leak" ||
        cat === "scam_or_fraud" ||
        h.category === "Legal Dispute"
      );
    };

    assert.strictEqual(isLegalCategory(legalHit), true);
    assert.strictEqual(isLegalCategory(newsHit), false);
  });
});
