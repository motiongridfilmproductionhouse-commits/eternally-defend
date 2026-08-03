import assert from "node:assert/strict";
import test from "node:test";
import { expandIdentityVariants } from "./identity-variants.server";
import { explainNoDeepfakeResults } from "./scan-diagnostics";
import { assessReferenceImageQuality } from "./image-quality.server";

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
