import assert from "node:assert/strict";
import test from "node:test";

import {
  appendReferenceImages,
  extractReferenceImagesFromPage,
  normalizeReferenceImageUrl,
  parseReferenceImages,
  referenceImageFromDiscoveryCandidate,
  youtubeThumbnailFromPageUrl,
} from "./reference-images";
import { parseSourceActivity, SourceActivityRecorder } from "./source-activity";

test("appendReferenceImages dedupes by normalized image URL and caps at 20", () => {
  const base = referenceImageFromDiscoveryCandidate({
    pageUrl: "https://example.com/a",
    imageUrl: "https://cdn.example.com/poster.jpg?v=1",
    title: "A",
  })!;
  const dup = referenceImageFromDiscoveryCandidate({
    pageUrl: "https://example.com/b",
    imageUrl: "https://cdn.example.com/poster.jpg?v=2",
    title: "B",
  })!;
  const merged = appendReferenceImages([base], [dup]);
  assert.equal(merged.length, 1);
  assert.equal(
    normalizeReferenceImageUrl("https://CDN.example.com/poster.jpg?x=1"),
    normalizeReferenceImageUrl("https://cdn.example.com/poster.jpg"),
  );
});

test("parseReferenceImages reads persisted stats shape", () => {
  const stats = {
    reference_images: [
      {
        image_url: "https://cdn.example.com/1.jpg",
        page_url: "https://site.example/watch",
        source_domain: "site.example",
        source_type: "firecrawl_image",
        title: "Watch",
        provider: "firecrawl",
        status: "discovered",
        discovered_at: "2026-08-01T00:00:00.000Z",
      },
    ],
  };
  const rows = parseReferenceImages(stats);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.provider, "firecrawl");
});

test("extractReferenceImagesFromPage reads og:image and youtube thumbnail", () => {
  const yt = extractReferenceImagesFromPage({
    pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Trailer",
    metadata: {},
    html: null,
  });
  assert.ok(yt.some((img) => img.source_type === "youtube_thumbnail"));

  const meta = extractReferenceImagesFromPage({
    pageUrl: "https://piracy.example/watch",
    metadata: { "og:image": "https://piracy.example/poster.jpg" },
    html: '<meta property="twitter:image" content="https://piracy.example/twitter.jpg" />',
  });
  assert.ok(meta.some((img) => img.source_type === "og_image"));
  assert.ok(meta.some((img) => img.source_type === "twitter_image"));
});

test("SourceActivityRecorder upserts real providers only", () => {
  const recorder = new SourceActivityRecorder();
  recorder.upsert({ provider: "firecrawl", status: "searching", requests: 2 });
  recorder.upsert({
    provider: "firecrawl",
    status: "completed",
    requests: 4,
    candidates: 3,
  });
  const stats = recorder.mergeToStats({});
  const entries = parseSourceActivity(stats);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.status, "completed");
  assert.equal(entries[0]?.requests, 4);
  assert.equal(entries[0]?.candidates, 3);
});
