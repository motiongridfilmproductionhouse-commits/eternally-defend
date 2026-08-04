import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGoogleImagesMetaFromHtml,
  isUsableSourceWebsiteUrl,
  resolveGoogleImagesSourceWebsite,
} from "./google-images-source.server";
import { buildGoogleImagesInvestigationQueries } from "./google-images-queries.server";
import {
  emptyGoogleImagesDiagnostics,
  formatGoogleImagesDiagnosticLines,
  parseGoogleImagesDiagnostics,
} from "./google-images-diagnostics";
import { expandIdentityVariants } from "./identity-variants.server";
import { findingRowFromGoogleImagesCandidate } from "./google-images-investigation.server";

test("resolveGoogleImagesSourceWebsite prefers imgrefurl over imgurl", () => {
  const source = resolveGoogleImagesSourceWebsite({
    href: "https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fa.jpg&imgrefurl=https%3A%2F%2Fnews.example.com%2Fstory",
    imgurl: "https://cdn.example.com/a.jpg",
    imgrefurl: "https://news.example.com/story",
  });
  assert.equal(source, "https://news.example.com/story");
});

test("isUsableSourceWebsiteUrl rejects Google SERP hosts", () => {
  assert.equal(
    isUsableSourceWebsiteUrl("https://www.google.com/search?q=sarayu&tbm=isch"),
    false,
  );
  assert.equal(
    isUsableSourceWebsiteUrl("https://news.example.com/gallery/sarayu"),
    true,
  );
});

test("extractGoogleImagesMetaFromHtml reads ou/ru pairs", () => {
  const html = `{"ou":"https://cdn.example.com/x.jpg","ru":"https://site.example.com/post"}`;
  const rows = extractGoogleImagesMetaFromHtml(html);
  assert.ok(rows.some((r) => r.image_url.includes("cdn.example.com")));
  assert.ok(
    rows.some((r) => r.source_website_url === "https://site.example.com/post"),
  );
});

test("buildGoogleImagesInvestigationQueries covers Sarayu Mohan variants", () => {
  const queries = buildGoogleImagesInvestigationQueries({
    name: "Sarayu Mohan",
    aliases: ["Sarayu"],
  });
  const joined = queries.join("\n").toLowerCase();
  assert.match(joined, /sarayu mohan/);
  assert.match(joined, /deepfake/);
  assert.ok(queries.some((q) => /[\u0D00-\u0D7F]/.test(q)));
  assert.ok(queries.length >= 12);
});

test("expandIdentityVariants includes initials and native script for Sarayu Mohan", () => {
  const variants = expandIdentityVariants({ name: "Sarayu Mohan" });
  assert.ok(variants.some((v) => /[\u0D00-\u0D7F]/.test(v)));
  assert.ok(variants.some((v) => /^SM\b/i.test(v) || v.includes("SM")));
});

test("google images diagnostics include source pages and faces compared", () => {
  const parsed = parseGoogleImagesDiagnostics({
    google_images_diagnostic: {
      queries_executed: 12,
      images_discovered: 240,
      source_pages_discovered: 40,
      candidate_pages_crawled: 8,
      images_downloaded: 180,
      face_comparisons: 90,
      high_confidence_matches: 6,
      evidence_packages_created: 6,
      provider_status: "success",
      used_browser: true,
    },
  });
  assert.equal(parsed.source_pages_discovered, 40);
  const lines = formatGoogleImagesDiagnosticLines(parsed);
  assert.ok(lines.some((line) => /Source Pages Discovered: 40/.test(line)));
  assert.ok(lines.some((line) => /Faces Compared: 90/.test(line)));
  assert.ok(lines.some((line) => /Collection Mode: Browser/.test(line)));
  assert.equal(emptyGoogleImagesDiagnostics().source_pages_discovered, 0);
});

test("findingRowFromGoogleImagesCandidate requires crawled verified pages", () => {
  const rejected = findingRowFromGoogleImagesCandidate({
    scanId: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    candidate: {
      url: "https://www.google.com/search?q=x",
      query: "Sarayu Mohan deepfake",
      source: "google_images_investigation",
      url_verification_status: "URL_VERIFIED",
      finding_classification: "PROBABLE_DEEPFAKE",
      face_similarity: 92,
    },
  });
  assert.equal(rejected, null);

  const accepted = findingRowFromGoogleImagesCandidate({
    scanId: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    candidate: {
      url: "https://news.example.com/story",
      query: "Sarayu Mohan deepfake",
      source: "google_images_investigation",
      url_verification_status: "URL_VERIFIED",
      finding_classification: "VERIFIED_DEEPFAKE",
      face_similarity: 94,
      title: "Example",
    },
  });
  assert.ok(accepted);
  assert.equal(accepted?.finding_classification, "VERIFIED_DEEPFAKE");
  assert.equal(accepted?.url_verification_status, "URL_VERIFIED");
});
