import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyManualEvidenceUrl,
  extractGoogleUrlHints,
  manualLeadInitialDedupeKey,
  manualLeadResolvedDedupeKey,
  splitManualEvidenceUrls,
} from "./manual-evidence.server";

const FUNCTIONS_PATH = resolve(process.cwd(), "src/lib/deepfake-intel.functions.ts");
const UI_PATH = resolve(process.cwd(), "src/routes/_app.deepfake-intel.tsx");
const SERVER_PATH = resolve(process.cwd(), "src/lib/deepfake/manual-evidence.server.ts");
const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260804120000_deepfake_manual_evidence_leads.sql",
);

test("Google Images search URL imports as manual evidence", () => {
  const parsed = classifyManualEvidenceUrl("https://www.google.com/search?q=Sarayu+Mohan&tbm=isch");
  assert.equal(parsed.kind, "google_images_search");
  assert.equal(parsed.selectedResultFragment, null);
});

test("Google Images #sv viewer URL imports and preserves selected fragment", () => {
  const parsed = classifyManualEvidenceUrl(
    "https://www.google.com/search?q=Sarayu+Mohan&tbm=isch#sv=abc123",
  );
  assert.equal(parsed.kind, "google_images_viewer");
  assert.equal(parsed.selectedResultFragment, "sv=abc123");
});

test("multiple #sv fragments remain separate before resolution", () => {
  const a = "https://www.google.com/search?q=Sarayu+Mohan&tbm=isch#sv=selected-a";
  const b = "https://www.google.com/search?q=Sarayu+Mohan&tbm=isch#sv=selected-b";
  assert.notEqual(manualLeadInitialDedupeKey(a), manualLeadInitialDedupeKey(b));
});

test("Google source URL extraction handles imgrefurl and ru", () => {
  const source = "https://source.example/gallery/sarayu-mohan";
  const image = "https://cdn.example/sarayu.jpg";
  const imgref = extractGoogleUrlHints(
    `https://www.google.com/imgres?imgurl=${encodeURIComponent(image)}&imgrefurl=${encodeURIComponent(source)}`,
  );
  assert.equal(imgref.sourcePageUrl, source);
  assert.equal(imgref.imageUrl, image);

  const ru = extractGoogleUrlHints(
    `https://www.google.com/search?q=Sarayu+Mohan&tbm=isch#sv=1&ru=${encodeURIComponent(source)}`,
  );
  assert.equal(ru.sourcePageUrl, source);
});

test("direct source-page and direct image URLs are accepted", () => {
  assert.equal(
    classifyManualEvidenceUrl("https://news.example/story/sarayu-mohan").kind,
    "source_page",
  );
  assert.equal(
    classifyManualEvidenceUrl("https://cdn.example/image/sarayu-mohan.webp").kind,
    "direct_image",
  );
});

test("duplicate source pages merge only after resolution key exists", () => {
  assert.equal(
    manualLeadResolvedDedupeKey({
      sourcePageUrl: "https://www.Example.com/story?utm_source=x#frag",
    }),
    "source:https://example.com/story",
  );
  assert.equal(
    manualLeadResolvedDedupeKey({
      imageUrl: "https://cdn.example/sarayu.jpg",
      perceptualHash: "sha256-prefix:abc",
    }),
    "phash:sha256-prefix:abc",
  );
});

test("manual evidence subsystem keeps unresolved Google leads visible", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  const server = readFileSync(SERVER_PATH, "utf8");
  const ui = readFileSync(UI_PATH, "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.deepfake_manual_leads/);
  assert.match(migration, /processing_status IN \(/);
  assert.match(migration, /selected_result_fragment TEXT/);
  assert.match(server, /Source page could not be resolved automatically\./);
  assert.match(ui, /MANUAL EVIDENCE LEADS/);
  assert.match(ui, /manual-evidence-leads/);
  assert.match(ui, /Source page could not be resolved automatically\./);
});

test("manual lead processing is separate from the full scan pipeline", () => {
  const functions = readFileSync(FUNCTIONS_PATH, "utf8");
  const submitStart = functions.indexOf("export const submitManualEvidenceUrls");
  const processStart = functions.indexOf("export const processManualEvidenceUrlsNow");
  assert.ok(submitStart >= 0);
  assert.ok(processStart > submitStart);
  const submitBlock = functions.slice(submitStart, processStart);
  assert.match(submitBlock, /deepfake_manual_leads/);
  assert.match(submitBlock, /dispatchManualEvidenceWorker/);
  assert.doesNotMatch(submitBlock, /executeInterleavedDeepfakePipeline/);
  assert.doesNotMatch(submitBlock, /max_queries/);
});

test("face mismatch is rejected and plausible matches create review items", () => {
  const server = readFileSync(SERVER_PATH, "utf8");
  assert.match(server, /Face comparison rejected/);
  assert.match(server, /processing_status: "rejected"/);
  assert.match(server, /processing_status: finalState/);
  assert.match(server, /"review_required"/);
  assert.match(server, /\.from\("deepfake_findings"\)/);
});

test("evidence package fields persist for every resolved lead", () => {
  const server = readFileSync(SERVER_PATH, "utf8");
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  for (const field of [
    "submitted_url",
    "selected_result_fragment",
    "source_page_url",
    "original_image_url",
    "google_result_screenshot_path",
    "source_page_screenshot_path",
    "capture_timestamp",
    "media_sha256",
    "perceptual_hash",
    "face_similarity_score",
    "identity_confidence_score",
    "discovery_path",
    "error_reason",
  ]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(server, /captureEvidenceCandidate/);
  assert.match(server, /perceptualHashFromSha256/);
});

test("no manually supplied lead is silently dropped during URL splitting", () => {
  const urls = splitManualEvidenceUrls(`
    https://www.google.com/search?q=Sarayu+Mohan&tbm=isch#sv=a
    https://www.google.com/search?q=Sarayu+Mohan&tbm=isch#sv=b
    https://source.example/story
    https://cdn.example/image.jpg
  `);
  assert.equal(urls.length, 4);
});
