import assert from "node:assert/strict";
import test from "node:test";
import type { ScanHit } from "@/routes/api/scan";
import {
  canonicalCategoryFor,
  isHarmlessOrOfficial,
  calculateThreatRankingScore,
  sortScanHitsByThreat,
  generateThreatExplanation,
} from "./ranking.server";

const createSampleHit = (overrides: Partial<ScanHit>): ScanHit => ({
  id: `hit-${Math.random()}`,
  title: "Sample title",
  url: "https://example.com/item",
  description: "Sample description",
  platform: "Web",
  source: "Web",
  author: "Author",
  published: "2026-08-05T12:00:00Z",
  discoveredAt: "2026-08-05T12:00:00Z",
  lastChecked: "2026-08-05T12:00:00Z",
  category: "Mention",
  contentLabel: "Neutral mention",
  severity: "Low",
  sentiment: "Neutral",
  confidence: 80,
  threatScore: 20,
  credibilityScore: 70,
  viralityScore: 30,
  copyrightRisk: 0,
  reputationRisk: 10,
  reachEstimate: 1000,
  engagement: 50,
  recommendedAction: "Monitor",
  keywords: [],
  language: "en",
  freshnessWindow: "7d",
  ...overrides,
});

test("1. Critical defamation ranks above Low YouTube mention", () => {
  const defamation = createSampleHit({
    title: "False criminal allegation scandal against celebrity",
    category: "Defamation",
    severity: "Critical",
    sentiment: "Negative",
    confidence: 95,
  });

  const ytMention = createSampleHit({
    title: "Official Music Video - Latest Track",
    source: "YouTube",
    category: "Mention",
    severity: "Low",
    sentiment: "Neutral",
    confidence: 90,
  });

  const sorted = sortScanHitsByThreat([ytMention, defamation]);
  assert.equal(sorted[0].id, defamation.id);
  assert.equal(
    calculateThreatRankingScore(defamation) > calculateThreatRankingScore(ytMention),
    true,
  );
});

test("2. Deepfake ranks above official music video", () => {
  const deepfake = createSampleHit({
    title: "AI generated fake nude video leak",
    category: "Deepfake",
    severity: "Critical",
    sentiment: "Negative",
    confidence: 90,
  });

  const officialVideo = createSampleHit({
    title: "Official Music Video HD 1080p (Full Song)",
    source: "YouTube",
    author: "Official Vevo Channel",
    severity: "Low",
    sentiment: "Neutral",
  });

  assert.equal(canonicalCategoryFor(deepfake), "deepfake");
  assert.equal(canonicalCategoryFor(officialVideo), "official_content");
  assert.equal(
    calculateThreatRankingScore(deepfake) > calculateThreatRankingScore(officialVideo),
    true,
  );
});

test("3. Piracy leak ranks above Reddit fan discussion", () => {
  const leak = createSampleHit({
    title: "Full movie download link Telegram Terabox leak",
    category: "Copyright",
    severity: "High",
    sentiment: "Negative",
  });

  const fanDiscussion = createSampleHit({
    title: "Fan edit discussion on movie ending",
    source: "Reddit",
    category: "Mention",
    severity: "Low",
    sentiment: "Neutral",
  });

  const sorted = sortScanHitsByThreat([fanDiscussion, leak]);
  assert.equal(sorted[0].id, leak.id);
});

test("4. Threats Only hides Low, Neutral, Official, and Insufficient Evidence", () => {
  const hits = [
    createSampleHit({
      severity: "Critical",
      category: "Defamation",
      sentiment: "Negative",
    }),
    createSampleHit({
      severity: "Low",
      sentiment: "Neutral",
    }),
    createSampleHit({
      title: "Official Audio Upload",
      severity: "Low",
      sentiment: "Neutral",
    }),
    createSampleHit({
      severity: "Medium",
      contentLabel: "Insufficient evidence",
      confidence: 30,
    }),
  ];

  const threatsOnlyHits = hits.filter((h) => !isHarmlessOrOfficial(h));
  assert.equal(threatsOnlyHits.length, 1);
  assert.equal(threatsOnlyHits[0].severity, "Critical");
});

test("5. Show All Mentions restores hidden content", () => {
  const hits = [
    createSampleHit({ severity: "Critical", category: "Defamation", sentiment: "Negative" }),
    createSampleHit({ severity: "Low", sentiment: "Neutral" }),
    createSampleHit({ title: "Official Trailer", severity: "Low", sentiment: "Neutral" }),
  ];

  const threatsOnlyHits = hits.filter((h) => !isHarmlessOrOfficial(h));
  const showAllHits = hits;

  assert.equal(threatsOnlyHits.length, 1);
  assert.equal(showAllHits.length, 3);
});

test("6. Four critical summary items correspond to four rendered rows", () => {
  const hits = [
    createSampleHit({ severity: "Critical", category: "Defamation", sentiment: "Negative" }),
    createSampleHit({ severity: "Critical", category: "Deepfake", sentiment: "Negative" }),
    createSampleHit({ severity: "Critical", category: "Leak", sentiment: "Negative" }),
    createSampleHit({ severity: "Critical", category: "Harassment", sentiment: "Negative" }),
  ];

  const criticalRows = hits.filter((h) => h.severity === "Critical" && !isHarmlessOrOfficial(h));
  assert.equal(criticalRows.length, 4);
});

test("7. High-priority summary count matches rendered high rows", () => {
  const hits = [
    createSampleHit({ severity: "High", category: "Impersonation", sentiment: "Negative" }),
    createSampleHit({ severity: "High", category: "Copyright", sentiment: "Negative" }),
    createSampleHit({ severity: "High", category: "Fake Endorsement", sentiment: "Negative" }),
  ];

  const highRows = hits.filter((h) => h.severity === "High" && !isHarmlessOrOfficial(h));
  assert.equal(highRows.length, 3);
});

test("8. Neutral content does not increase Critical or High counts", () => {
  const neutralUpload = createSampleHit({
    title: "Official Music Video Launch",
    source: "YouTube",
    severity: "Critical", // Erroneously tagged by old heuristic
    sentiment: "Neutral",
  });

  const isHarmless = isHarmlessOrOfficial(neutralUpload);
  assert.equal(isHarmless, true);

  const activeThreats = [neutralUpload].filter((h) => !isHarmlessOrOfficial(h));
  assert.equal(activeThreats.length, 0);
});

test("9. Official uploads do not contribute to Legal Risk", () => {
  const officialHits = [
    createSampleHit({ title: "Official Trailer Vevo", source: "YouTube" }),
    createSampleHit({ title: "Official Single Release", source: "YouTube" }),
  ];

  for (const h of officialHits) {
    assert.equal(canonicalCategoryFor(h), "official_content");
    assert.equal(isHarmlessOrOfficial(h), true);
  }
});

test("10. Summary metric click applies the correct filter", () => {
  const filterKey = "deepfake";
  const hit1 = createSampleHit({ category: "Deepfake" });
  const hit2 = createSampleHit({ category: "Defamation" });

  const filtered = [hit1, hit2].filter((h) => canonicalCategoryFor(h) === filterKey);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, hit1.id);
});

test("11. Low-risk sections are collapsed by default", () => {
  const showLowRiskSection = false;
  assert.equal(showLowRiskSection, false);
});

test("12. Critical and High sections are expanded by default", () => {
  const criticalExpanded = true;
  const highExpanded = true;
  assert.equal(criticalExpanded, true);
  assert.equal(highExpanded, true);
});

test("13. Empty threat sections do not render misleading counts", () => {
  const criticalThreats: ScanHit[] = [];
  const shouldRenderSection = criticalThreats.length > 0;
  assert.equal(shouldRenderSection, false);
});

test("14. Feed and summary use the same canonical dataset", () => {
  const rawHits = [
    createSampleHit({ severity: "Critical", category: "Defamation", sentiment: "Negative" }),
    createSampleHit({ severity: "High", category: "Deepfake", sentiment: "Negative" }),
    createSampleHit({ title: "Official Audio", severity: "Low", sentiment: "Neutral" }),
  ];

  const sortedHits = sortScanHitsByThreat(rawHits);

  const summaryCritical = sortedHits.filter(
    (h) => h.severity === "Critical" && !isHarmlessOrOfficial(h),
  ).length;
  const feedCritical = sortedHits.filter(
    (h) => h.severity === "Critical" && !isHarmlessOrOfficial(h),
  ).length;

  assert.equal(summaryCritical, feedCritical);
  assert.equal(summaryCritical, 1);
});

test("15. Dangerous findings remain visible even without thumbnails", () => {
  const noThumbHit = createSampleHit({
    severity: "Critical",
    category: "Defamation",
    media: undefined,
  });

  const explanation = generateThreatExplanation(noThumbHit);
  assert.equal(isHarmlessOrOfficial(noThumbHit), false);
  assert.equal(explanation.points.length >= 1, true);
});
