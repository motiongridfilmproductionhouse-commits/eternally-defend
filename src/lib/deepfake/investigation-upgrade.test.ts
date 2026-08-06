import assert from "node:assert/strict";
import test from "node:test";
import { expandIdentityVariants } from "./identity-variants.server";
import { explainNoDeepfakeResults } from "./scan-diagnostics";
import { assessReferenceImageQuality } from "./image-quality.server";
import { isBraveImageSearchConfigured, searchBraveImagesForQuery } from "./brave-images.server";
import {
  mergeCollectedIntoEmbeddingLibrary,
  topReferenceImageUrls,
} from "./reference-embedding-library.server";
import { isReferenceFaceDetectionConfigured } from "./reference-face-detect.server";
import type { CollectedReferenceImage } from "./reference-images";

test("expandIdentityVariants generates Dulquer Salmaan aliases automatically", () => {
  const variants = expandIdentityVariants({ name: "Dulquer Salmaan" });
  const joined = variants.join("\n").toLowerCase();
  assert.match(joined, /dulquer salmaan/);
  assert.match(joined, /dulquer salman/);
  assert.match(joined, /\bdq\b/);
  assert.ok(variants.some((v) => /[\u0D00-\u0D7F]/.test(v)));
});

test("expandIdentityVariants never returns only the bare name", () => {
  const variants = expandIdentityVariants({ name: "Nayanthara", aliases: ["Lady Superstar"] });
  assert.ok(variants.length >= 3);
});

test("explainNoDeepfakeResults explains missing reference images", () => {
  const explained = explainNoDeepfakeResults(
    { queries_generated: 40, crawl_succeeded: 0, reference_images_count: 0 },
    "completed",
  );
  assert.match(explained.headline, /No verified/i);
  assert.ok(explained.reasons.some((r) => /reference images/i.test(r)));
});

test("image quality rejects tracking pixels and tiny images", () => {
  assert.equal(
    assessReferenceImageQuality({ url: "https://cdn.example/pixel.gif", width: 1, height: 1 })
      .accepted,
    false,
  );
  assert.equal(
    assessReferenceImageQuality({
      url: "https://photos.example/portrait.jpg",
      width: 800,
      height: 600,
      faceDetected: true,
      faceConfidence: 92,
    }).accepted,
    true,
  );
});

test("reference embedding library deduplicates and ranks by quality", () => {
  const sample: CollectedReferenceImage[] = [
    {
      image_url: "https://cdn.example/a.jpg",
      page_url: "https://example.com/a",
      source_provider: "google_images",
      title: "A",
      width: 800,
      height: 600,
      quality_score: 70,
      sha256: "aaa",
      perceptual_hash: "phash-a",
      face_detected: true,
      face_confidence: 90,
      embedding_indexed: true,
      collected_at: new Date().toISOString(),
    },
    {
      image_url: "https://cdn.example/b.jpg",
      page_url: "https://example.com/b",
      source_provider: "bing_images",
      title: "B",
      width: 900,
      height: 700,
      quality_score: 95,
      sha256: "bbb",
      perceptual_hash: "phash-b",
      face_detected: true,
      face_confidence: 96,
      embedding_indexed: true,
      collected_at: new Date().toISOString(),
    },
  ];

  const merged = mergeCollectedIntoEmbeddingLibrary({
    celebrityName: "Dulquer Salmaan",
    images: sample,
  });
  assert.equal(merged.length, 2);
  assert.equal(merged[0].sha256, "bbb");
  assert.equal(topReferenceImageUrls("Dulquer Salmaan", 1)[0], "https://cdn.example/b.jpg");
});

test("brave image search reports skipped when unconfigured", async () => {
  const original = process.env.BRAVE_API_KEY;
  delete process.env.BRAVE_API_KEY;
  assert.equal(isBraveImageSearchConfigured(), false);
  const result = await searchBraveImagesForQuery({ query: '"Dulquer Salmaan" photos' });
  assert.equal(result.skipped, true);
  assert.equal(result.hits.length, 0);
  if (original) process.env.BRAVE_API_KEY = original;
});

test("reference face detection falls back when AWS is unconfigured", () => {
  const originalKey = process.env.AWS_ACCESS_KEY_ID;
  const originalSecret = process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  assert.equal(isReferenceFaceDetectionConfigured(), false);
  if (originalKey) process.env.AWS_ACCESS_KEY_ID = originalKey;
  if (originalSecret) process.env.AWS_SECRET_ACCESS_KEY = originalSecret;
});
