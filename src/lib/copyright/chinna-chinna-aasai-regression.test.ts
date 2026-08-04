/**
 * Regression coverage for Chinna Chinna Aasai (2026) public distribution URLs.
 * Discovery must hunt these host families; classification must land actionable
 * categories with operator-facing threat labels.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildQueries, type ReferenceAnalysis } from "./discover.server";
import { classifyCopyrightPage } from "./page-classify.server";
import {
  classifyThreatCategory,
  severityFor,
  summarizeThreatIntelligence,
} from "./threat-results";

const TITLES = ["Chinna Chinna Aasai"];

const analysis: ReferenceAnalysis = {
  title: "Chinna Chinna Aasai",
  altTitles: ["Chinna Chinna Aasai Malayalam"],
  language: "malayalam",
  audienceLanguages: ["english", "tamil"],
  region: "India",
  actors: [],
  productionCompany: null,
  releaseDate: "2026-01-01",
  descriptors: [],
  ocrText: null,
  watermark: null,
  visualFeatures: [],
  mediaType: "poster",
};

const long = (s: string) =>
  `${s} ${"Exact crawled page body with enough text for identity and distribution evidence. ".repeat(4)}`;

test("Chinna Chinna Aasai queries cover download/stream/cloud/archive hosts", () => {
  const plans = buildQueries(analysis, "Chinna Chinna Aasai");
  const joined = plans.map((p) => p.query).join("\n");

  assert.ok(plans.some((p) => /ogomovies1\.com\.pk/i.test(p.query)));
  assert.ok(plans.some((p) => /bilibili/i.test(p.query)));
  assert.ok(plans.some((p) => /terabox/i.test(p.query)));
  assert.ok(plans.some((p) => /archive\.org/i.test(p.query)));
  assert.ok(plans.some((p) => /dailymotion/i.test(p.query)));
  assert.ok(/1080p|720p|HDRip|WEBRip|mkv|pdf|watch free|google drive/i.test(joined));
  assert.ok(plans.every((p) => /chinna[\s-]*chinna[\s-]*aasai/i.test(p.query)));
});

test("Ogomovies download page → Unauthorized Download / Critical", () => {
  const result = classifyCopyrightPage({
    url: "https://www.ogomovies1.com.pk/movies/chinna-chinna-aasai-2026/",
    pageTitle: "Chinna Chinna Aasai (2026) Full Movie Download",
    markdown: long(
      "Chinna Chinna Aasai 2026 Malayalam full movie download 1080p 720p HDRip. Click to download MKV.",
    ),
    html: '<html><body><a href="/download/chinna-chinna-aasai.mkv">Download Now</a><a href="/dl/full">Download HD</a></body></html>',
    links: [
      "https://www.ogomovies1.com.pk/download/chinna-chinna-aasai.mkv",
      "https://www.ogomovies1.com.pk/dl/full",
    ],
    titles: TITLES,
    pageInspected: true,
    releaseDate: "2026-01-01",
  });

  assert.equal(result.classification, "DOWNLOAD_PAGE");
  assert.equal(result.clientVisible, true);
  const category = classifyThreatCategory({
    domain: "ogomovies1.com.pk",
    url: "https://www.ogomovies1.com.pk/movies/chinna-chinna-aasai-2026/",
    classification: result.classification,
  });
  assert.equal(category, "download");
  assert.equal(
    severityFor(result.confidence, true, {
      categoryKey: category,
      classification: result.classification,
      domainRisk: result.domainRisk,
    }),
    "critical",
  );
});

test("Bilibili re-upload → Video Re-upload", () => {
  const result = classifyCopyrightPage({
    url: "https://www.bilibili.tv/en/video/4800404031282176",
    pageTitle: "Chinna Chinna Aasai full movie",
    markdown: long(
      "Watch Chinna Chinna Aasai full movie online. Uploaded copyrighted movie content.",
    ),
    html: '<html><body><video controls src="/play.mp4"></video><iframe src="https://www.bilibili.tv/player/embed/4800404031282176"></iframe></body></html>',
    links: [],
    titles: TITLES,
    pageInspected: true,
  });

  assert.equal(result.classification, "VIDEO_HOST_REUPLOAD");
  assert.equal(result.clientVisible, true);
  assert.equal(
    classifyThreatCategory({
      domain: "bilibili.tv",
      url: "https://www.bilibili.tv/en/video/4800404031282176",
      classification: result.classification,
    }),
    "video_reupload",
  );
});

test("Archive.org PDF → Archive/Document leak Critical", () => {
  const url =
    "https://ia903101.us.archive.org/28/items/china-china-aasai-boly4u/china-china-aasai-boly4u.pdf";
  const result = classifyCopyrightPage({
    url,
    pageTitle: "china-china-aasai-boly4u.pdf — Chinna Chinna Aasai",
    markdown: long(
      "Internet Archive item for Chinna Chinna Aasai boly4u PDF download of copyrighted material.",
    ),
    html: "<html><body><a href='china-china-aasai-boly4u.pdf'>PDF Download</a></body></html>",
    links: [url],
    titles: TITLES,
    pageInspected: true,
  });

  assert.ok(
    result.classification === "FILE_HOST_DISTRIBUTION" ||
      result.classification === "VIDEO_HOST_REUPLOAD" ||
      result.classification === "DOWNLOAD_PAGE",
  );
  assert.equal(result.clientVisible, true);
  const category = classifyThreatCategory({
    domain: "ia903101.us.archive.org",
    url,
    classification: result.classification,
  });
  assert.ok(category === "document" || category === "archive");
  assert.equal(
    severityFor(Math.max(result.confidence, 80), true, {
      categoryKey: category,
      classification: result.classification,
    }),
    "critical",
  );
});

test("Terabox sharing link → Cloud Storage Leak Critical", () => {
  const result = classifyCopyrightPage({
    url: "https://www.terabox.app/sharing/link?surl=V_Y7iz4bTqJepcsXMzkhow",
    pageTitle: "Chinna Chinna Aasai shared folder",
    markdown: long(
      "Terabox public sharing link for Chinna Chinna Aasai full movie file. Download the shared folder.",
    ),
    html: "<html><body><a href='/download'>Download</a><button>Download</button></body></html>",
    links: ["https://www.terabox.app/download/file"],
    titles: TITLES,
    pageInspected: true,
  });

  assert.equal(result.classification, "FILE_HOST_DISTRIBUTION");
  assert.equal(result.clientVisible, true);
  const category = classifyThreatCategory({
    domain: "terabox.app",
    url: "https://www.terabox.app/sharing/link?surl=V_Y7iz4bTqJepcsXMzkhow",
    classification: result.classification,
  });
  assert.equal(category, "cloud_storage");
  assert.equal(
    severityFor(result.confidence, true, {
      categoryKey: category,
      classification: result.classification,
    }),
    "critical",
  );
});

test("Dailymotion re-upload → Video Re-upload", () => {
  const result = classifyCopyrightPage({
    url: "https://www.dailymotion.com/video/xaswffu",
    pageTitle: "Chinna Chinna Aasai movie clip",
    markdown: long(
      "Chinna Chinna Aasai uploaded on Dailymotion. Watch the video online.",
    ),
    html: '<html><body><iframe src="https://www.dailymotion.com/embed/video/xaswffu"></iframe></body></html>',
    links: [],
    titles: TITLES,
    pageInspected: true,
  });

  assert.equal(result.classification, "VIDEO_HOST_REUPLOAD");
  assert.equal(result.clientVisible, true);
  const category = classifyThreatCategory({
    domain: "dailymotion.com",
    url: "https://www.dailymotion.com/video/xaswffu",
    classification: result.classification,
  });
  assert.equal(category, "video_reupload");
  const severity = severityFor(result.confidence, true, {
    categoryKey: category,
    classification: result.classification,
  });
  assert.ok(severity === "high" || severity === "medium");
});

test("Threat intelligence summary groups Chinna Chinna Aasai findings", () => {
  const summary = summarizeThreatIntelligence([
    {
      id: "1",
      domain: "ogomovies1.com.pk",
      url: "https://www.ogomovies1.com.pk/movies/chinna-chinna-aasai-2026/",
      title: "Ogomovies",
      classification: "DOWNLOAD_PAGE",
      categoryKey: "download",
      categoryLabel: "Unauthorized Download",
      severity: "critical",
      status: "active",
      confidence: 90,
      lastVerifiedAt: "2026-08-03T08:11:00.000Z",
      evidenceSummary: null,
      reason: null,
      discoveryQuery: null,
      screenshotUrl: null,
      pageExcerpt: null,
      additionalUrls: [],
      findingCount: 1,
      verified: true,
      sourceState: "new_confirmed",
      reviewStatus: null,
      evidence: null,
      contact: null,
      detectionType: "DOWNLOAD_PAGE",
    },
    {
      id: "2",
      domain: "terabox.app",
      url: "https://www.terabox.app/sharing/link?surl=V_Y7iz4bTqJepcsXMzkhow",
      title: "Terabox",
      classification: "FILE_HOST_DISTRIBUTION",
      categoryKey: "cloud_storage",
      categoryLabel: "Cloud Storage Leak",
      severity: "critical",
      status: "active",
      confidence: 88,
      lastVerifiedAt: "2026-08-03T08:12:00.000Z",
      evidenceSummary: null,
      reason: null,
      discoveryQuery: null,
      screenshotUrl: null,
      pageExcerpt: null,
      additionalUrls: [],
      findingCount: 1,
      verified: true,
      sourceState: "new_confirmed",
      reviewStatus: null,
      evidence: null,
      contact: null,
      detectionType: "FILE_HOST_DISTRIBUTION",
    },
  ]);

  assert.equal(summary.detected, 2);
  assert.equal(summary.critical, 2);
  assert.equal(summary.verified, 2);
  assert.equal(summary.distribution.download, 1);
  assert.equal(summary.distribution.cloud_storage, 1);
  assert.equal(summary.latest[0]?.domain, "terabox.app");
});
