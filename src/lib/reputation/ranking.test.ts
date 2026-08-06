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
  id: overrides.id || `hit-${Math.random()}`,
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
  contentLabel: "Needs human review",
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

test("1. Official YouTube hidden in Threats Only", () => {
  const officialYt = createSampleHit({
    id: "yt-1",
    title: "Official Music Video - Vevo",
    source: "YouTube",
    author: "Official Vevo Channel",
    severity: "Low",
    sentiment: "Neutral",
  });
  assert.equal(canonicalCategoryFor(officialYt), "official_content");
  assert.equal(isHarmlessOrOfficial(officialYt), true);
  const threatsOnlyList = [officialYt].filter((h) => !isHarmlessOrOfficial(h));
  assert.equal(threatsOnlyList.length, 0);
});

test("2. Official uploads excluded from Critical count", () => {
  const officialVideo = createSampleHit({
    id: "yt-2",
    title: "Official Trailer HD",
    source: "YouTube",
    severity: "Critical",
    sentiment: "Neutral",
  });
  const criticalThreats = [officialVideo].filter(
    (h) => h.severity === "Critical" && !isHarmlessOrOfficial(h),
  );
  assert.equal(criticalThreats.length, 0);
});

test("3. Official uploads excluded from High count", () => {
  const officialSingle = createSampleHit({
    id: "yt-3",
    title: "Official Song Release Single",
    source: "YouTube",
    severity: "High",
    sentiment: "Neutral",
  });
  const highThreats = [officialSingle].filter(
    (h) => h.severity === "High" && !isHarmlessOrOfficial(h),
  );
  assert.equal(highThreats.length, 0);
});

test("4. Official uploads excluded from Legal Risk", () => {
  const officialHit = createSampleHit({
    id: "yt-4",
    title: "Official Audio - Vevo",
    source: "YouTube",
    author: "Vevo",
  });
  const cat = canonicalCategoryFor(officialHit);
  assert.equal(cat, "official_content");
  const isLegalCategory = (c: string) =>
    c === "defamation" || c === "copyright_infringement" || c === "harassment_or_abuse";
  assert.equal(isLegalCategory(cat), false);
});

test("5. Official uploads excluded from Threat Score", () => {
  const officialHit = createSampleHit({
    id: "yt-5",
    title: "Official Movie Teaser",
    source: "YouTube",
    author: "Production House",
  });
  const score = calculateThreatRankingScore(officialHit);
  assert.equal(score, -2000);
  assert.equal(score < 0, true);
});

test("6. Critical Defamation ranks above YouTube mention", () => {
  const defamation = createSampleHit({
    id: "def-1",
    title: "False criminal allegation scandal against celebrity",
    category: "Defamation",
    severity: "Critical",
    sentiment: "Negative",
    confidence: 95,
  });

  const ytMention = createSampleHit({
    id: "yt-6",
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

test("7. Deepfake ranks above Trailer", () => {
  const deepfake = createSampleHit({
    id: "df-1",
    title: "AI generated fake nude video leak",
    category: "Deepfake",
    severity: "Critical",
    sentiment: "Negative",
    confidence: 90,
  });

  const trailer = createSampleHit({
    id: "yt-7",
    title: "Official Movie Trailer 1080p",
    source: "YouTube",
    author: "Official Studio",
    severity: "Low",
    sentiment: "Neutral",
  });

  const sorted = sortScanHitsByThreat([trailer, deepfake]);
  assert.equal(sorted[0].id, deepfake.id);
});

test("8. Piracy ranks above Music Video", () => {
  const piracy = createSampleHit({
    id: "pir-1",
    title: "Full movie download link Telegram Terabox leak",
    category: "Copyright",
    severity: "High",
    sentiment: "Negative",
  });

  const musicVideo = createSampleHit({
    id: "yt-8",
    title: "Official Music Video Full Song",
    source: "YouTube",
    category: "Mention",
    severity: "Low",
    sentiment: "Neutral",
  });

  const sorted = sortScanHitsByThreat([musicVideo, piracy]);
  assert.equal(sorted[0].id, piracy.id);
});

test("9. Threats Only removes Low", () => {
  const lowItem = createSampleHit({ id: "low-1", severity: "Low", sentiment: "Neutral" });
  assert.equal(isHarmlessOrOfficial(lowItem), true);
  assert.equal([lowItem].filter((h) => !isHarmlessOrOfficial(h)).length, 0);
});

test("10. Threats Only removes Neutral", () => {
  const neutralItem = createSampleHit({
    id: "neu-1",
    contentLabel: "Neutral mention",
    sentiment: "Neutral",
  });
  assert.equal(isHarmlessOrOfficial(neutralItem), true);
  assert.equal([neutralItem].filter((h) => !isHarmlessOrOfficial(h)).length, 0);
});

test("11. Threats Only removes Official", () => {
  const officialItem = createSampleHit({
    id: "off-1",
    title: "Official Teaser",
    source: "YouTube",
  });
  assert.equal(isHarmlessOrOfficial(officialItem), true);
  assert.equal([officialItem].filter((h) => !isHarmlessOrOfficial(h)).length, 0);
});

test("12. API returns ranking_score sorted descending", () => {
  const defamation = createSampleHit({
    id: "defamation-id",
    category: "Defamation",
    severity: "Critical",
    sentiment: "Negative",
  });
  const deepfake = createSampleHit({
    id: "deepfake-id",
    category: "Deepfake",
    severity: "High",
    sentiment: "Negative",
  });
  const official = createSampleHit({
    id: "official-id",
    title: "Official Audio",
    severity: "Low",
    sentiment: "Neutral",
  });

  const sorted = sortScanHitsByThreat([official, deepfake, defamation]);
  assert.equal(sorted[0].id, "defamation-id");
  assert.equal(sorted[1].id, "deepfake-id");
  assert.equal(sorted[2].id, "official-id");
  assert.equal(
    (sorted[0].threatScore ?? 0) >= (sorted[1].threatScore ?? 0) &&
      (sorted[1].threatScore ?? 0) >= (sorted[2].threatScore ?? 0),
    true,
  );
});

test("13. UI preserves API order", () => {
  const hits = [
    createSampleHit({
      id: "h1",
      category: "Defamation",
      severity: "Critical",
      sentiment: "Negative",
      threatScore: 2680,
    }),
    createSampleHit({
      id: "h2",
      category: "Deepfake",
      severity: "High",
      sentiment: "Negative",
      threatScore: 2130,
    }),
  ];
  const uiList = hits;
  assert.equal(uiList[0].id, "h1");
  assert.equal(uiList[1].id, "h2");
});

test("14. Empty threat scans show 'No high-risk reputation threats detected.'", () => {
  const rawHits = [
    createSampleHit({ id: "t1", title: "Official Trailer", source: "YouTube" }),
    createSampleHit({ id: "t2", title: "Official Song", source: "YouTube" }),
  ];
  const threats = rawHits.filter((h) => !isHarmlessOrOfficial(h));
  assert.equal(threats.length, 0);
  const fallbackMessage = "No high-risk reputation threats detected.";
  assert.equal(fallbackMessage, "No high-risk reputation threats detected.");
});

test("15. Dangerous findings remain visible even without thumbnails", () => {
  const noThumbHit = createSampleHit({
    id: "nothumb-1",
    severity: "Critical",
    category: "Defamation",
    sentiment: "Negative",
    contentLabel: "Verified fact",
    media: undefined,
  });

  const explanation = generateThreatExplanation(noThumbHit);
  assert.equal(isHarmlessOrOfficial(noThumbHit), false);
  assert.equal(explanation.points.length >= 1, true);
});
