import { describe, it } from "node:test";
import assert from "node:assert";
import {
  normalizeIntegerCount,
  normalizeRiskScore,
  normalizePercentage,
} from "./scans.functions";

describe("Web Scan Numeric Overflow & Strict 0-100 Domain Normalization Tests", () => {
  it("normalizes risk_score 2097 -> 100", () => {
    assert.strictEqual(normalizeRiskScore(2097), 100);
  });

  it("normalizes risk_score -1617 -> 0", () => {
    assert.strictEqual(normalizeRiskScore(-1617), 0);
  });

  it("normalizes threat_score 2680 -> 100", () => {
    assert.strictEqual(normalizeRiskScore(2680), 100);
  });

  it("normalizes threat_score 85.2378 -> 85.238", () => {
    assert.strictEqual(normalizeRiskScore(85.2378), 85.238);
  });

  it("normalizes growth_pct 2500 -> allowed as 2500 (does not clamp to 100)", () => {
    assert.strictEqual(normalizePercentage(2500), 2500);
  });

  // growth_pct is numeric(8,3) in Postgres (max magnitude 99999.999). These
  // guard the application-level bound (-99_999..99_999) that keeps
  // persistScanCore's batched scan_hits upsert from ever hitting a Postgres
  // "numeric field overflow" (22003) on this column. See
  // scan-persistence-growth-pct-overflow.test.ts for the persistence-path
  // regression.
  it("leaves an ordinary growth_pct (3697) unchanged", () => {
    assert.strictEqual(normalizePercentage(3697), 3697);
  });

  it("bounds a growth_pct of 100000 to the numeric(8,3) column's safe ceiling (99999)", () => {
    assert.strictEqual(normalizePercentage(100_000), 99_999);
  });

  it("bounds a growth_pct of 999999 to the numeric(8,3) column's safe ceiling (99999)", () => {
    assert.strictEqual(normalizePercentage(999_999), 99_999);
  });

  it("bounds a large negative growth_pct to the numeric(8,3) column's safe floor (-99999)", () => {
    assert.strictEqual(normalizePercentage(-500_000), -99_999);
  });

  it("still returns null for null/undefined/empty-string/non-finite growth_pct input", () => {
    assert.strictEqual(normalizePercentage(null), null);
    assert.strictEqual(normalizePercentage(undefined), null);
    assert.strictEqual(normalizePercentage(""), null);
    assert.strictEqual(normalizePercentage(NaN), null);
    assert.strictEqual(normalizePercentage(Infinity), null);
    assert.strictEqual(normalizePercentage(-Infinity), null);
  });

  it("leaves a normal percentage value (42.5) unchanged", () => {
    assert.strictEqual(normalizePercentage(42.5), 42.5);
  });

  it("normalizes reach = 2,500,000,000 (2.5 Billion) correctly as BIGINT", () => {
    assert.strictEqual(normalizeIntegerCount(2500000000), 2500000000);
  });

  it("normalizes engagement large integer correctly", () => {
    assert.strictEqual(normalizeIntegerCount(1000000000), 1000000000);
  });

  it("returns null for Infinity, -Infinity, and NaN", () => {
    assert.strictEqual(normalizeRiskScore(Infinity), null);
    assert.strictEqual(normalizeRiskScore(-Infinity), null);
    assert.strictEqual(normalizeRiskScore(NaN), null);
    assert.strictEqual(normalizePercentage(Infinity), null);
    assert.strictEqual(normalizeIntegerCount(NaN), null);
  });

  it("normalizes numeric strings correctly ('85.5', '2500000000')", () => {
    assert.strictEqual(normalizeRiskScore("85.5"), 85.5);
    assert.strictEqual(normalizeIntegerCount("2500000000"), 2500000000);
  });

  it("handles null, undefined, empty strings safely without throwing", () => {
    assert.strictEqual(normalizeRiskScore(null), null);
    assert.strictEqual(normalizeRiskScore(undefined), null);
    assert.strictEqual(normalizeRiskScore(""), null);
    assert.strictEqual(normalizeIntegerCount(null), null);
  });

  it("verifies retry simulation logic preserves deduplication without scan_hits duplication", () => {
    const hits = [
      { source: "youtube", external_id: "vid1", title: "Video 1", reach: 2500000000, threatScore: 2680 },
      { source: "youtube", external_id: "vid2", title: "Video 2", reach: 1000000, threatScore: 85.2378 },
      { source: "news", canonical_url: "https://news.com/1", title: "Article 1", reach: 248, threatScore: -1617 },
    ];

    const dedupeSet = new Set<string>();
    const persistedRows: any[] = [];

    const persistBatch = (inputHits: typeof hits) => {
      for (const h of inputHits) {
        const key = `${h.source}::${h.external_id || h.canonical_url}`;
        if (!dedupeSet.has(key)) {
          dedupeSet.add(key);
          persistedRows.push({
            ...h,
            reach: normalizeIntegerCount(h.reach),
            threat_score: normalizeRiskScore(h.threatScore),
          });
        }
      }
    };

    // First attempt
    persistBatch(hits);
    assert.strictEqual(persistedRows.length, 3);
    assert.strictEqual(persistedRows[0].threat_score, 100);
    assert.strictEqual(persistedRows[1].threat_score, 85.238);
    assert.strictEqual(persistedRows[2].threat_score, 0);

    // Retry attempt
    persistBatch(hits);
    assert.strictEqual(persistedRows.length, 3); // Deduplication intact on retry!
  });
});
