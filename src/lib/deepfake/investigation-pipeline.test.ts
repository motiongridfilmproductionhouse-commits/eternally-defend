import assert from "node:assert/strict";
import test from "node:test";
import { classifyPageType } from "./filter.server";
import { calculateHostingConfidence, calculateThreatScore } from "./relevance-scorer.server";
import { categorizeFindingDisplayGroup, type ClientFinding } from "./results-dashboard";

test("1. classifyPageType categorizes URLs into allowed, secondary, collapsed, and rejected categories", () => {
  assert.equal(classifyPageType("https://wikipedia.org/wiki/Actor"), "WIKIPEDIA");
  assert.equal(classifyPageType("https://imdb.com/name/nm0000123/"), "IMDB");
  assert.equal(classifyPageType("https://harvard.edu/alumni"), "COLLEGE");
  assert.equal(classifyPageType("https://apps.apple.com/app/id1234"), "APP_STORE");
  assert.equal(classifyPageType("https://amazon.com/dp/B00000"), "SHOP");
  assert.equal(classifyPageType("https://t.me/s/deepfake_channel"), "DOWNLOAD_PAGE");
  assert.equal(classifyPageType("https://mrdeepfakes.com/video/123"), "HOSTING_PAGE");
  assert.equal(classifyPageType("https://reddit.com/r/deepfakes/comments/123"), "FORUM_THREAD");
});

test("2. calculateHostingConfidence detects media hosting, mirrors, downloads, and galleries", () => {
  const telegram = calculateHostingConfidence("https://t.me/s/explicit_ai_channel", "Download zip mirror gallery");
  assert.equal(telegram.isTelegram, true);
  assert.equal(telegram.isMirror, true);
  assert.equal(telegram.containsDownload, true);
  assert.equal(telegram.confidence, 100);

  const normalPage = calculateHostingConfidence("https://example.com/article", "Just text news");
  assert.equal(normalPage.isMirror, false);
  assert.equal(normalPage.confidence, 30);
});

test("3. Threat Scoring Formula computes 0-1000 score (MrDeepFakes=996, News=45)", () => {
  const mrDeepfakesScore = calculateThreatScore({
    faceSimilarity: 99, // 396
    syntheticConfidence: 100, // 300
    hostingConfidence: 100, // 200
    providerConfidence: 100, // 100
  });
  assert.equal(mrDeepfakesScore, 996);

  const sexCelebrityScore = calculateThreatScore({
    faceSimilarity: 98, // 392
    syntheticConfidence: 100, // 300
    hostingConfidence: 100, // 200
    providerConfidence: 100, // 100
  });
  assert.equal(sexCelebrityScore, 992);

  const newsArticleScore = calculateThreatScore({
    faceSimilarity: 0, // 0
    syntheticConfidence: 15, // 45
    hostingConfidence: 0, // 0
    providerConfidence: 0, // 0
  });
  assert.equal(newsArticleScore, 45);
});

test("4. categorizeFindingDisplayGroup groups findings into 10 display categories", () => {
  const verifiedExplicit: ClientFinding = {
    id: "f1",
    finding_classification: "VERIFIED_DEEPFAKE",
    snippet: "explicit AI nude face swap video",
  };
  assert.equal(categorizeFindingDisplayGroup(verifiedExplicit), "VERIFIED_EXPLICIT_DEEPFAKES");

  const downloadMirror: ClientFinding = {
    id: "f2",
    source_host: "t.me",
    page_type: "DOWNLOAD_PAGE",
  };
  assert.equal(categorizeFindingDisplayGroup(downloadMirror), "DOWNLOAD_MIRRORS");

  const newsFinding: ClientFinding = {
    id: "f3",
    page_type: "NEWS",
    page_title: "BBC News deepfake report",
  };
  assert.equal(categorizeFindingDisplayGroup(newsFinding), "NEWS");
});
