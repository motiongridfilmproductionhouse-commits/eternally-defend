import assert from "node:assert/strict";
import test from "node:test";
import {
  isCandidateDisabledForFeature,
  isHostDisabledForFeature,
  isProviderDisabledForFeature,
} from "./source-policy";

test("Reddit is disabled for the deepfake agent", () => {
  for (const url of [
    "https://www.reddit.com/r/x/comments/1",
    "https://old.reddit.com/r/x",
    "https://i.redd.it/abc.jpg",
    "REDDIT.COM",
  ]) {
    assert.equal(isHostDisabledForFeature("deepfake_intel", url), true, url);
  }
  assert.equal(isProviderDisabledForFeature("deepfake_intel", "reddit_api"), true);
});

test("Reddit is disabled for impersonation discovery", () => {
  assert.equal(isHostDisabledForFeature("impersonation_discovery", "reddit.com"), true);
  assert.equal(isProviderDisabledForFeature("impersonation_discovery", "reddit"), true);
});

test("Reddit is not removed globally — reputation web scan still allows it", () => {
  assert.equal(isHostDisabledForFeature("reputation_web_scan", "https://reddit.com/r/a"), false);
  assert.equal(isProviderDisabledForFeature("reputation_web_scan", "reddit"), false);
  assert.equal(isHostDisabledForFeature("copyright_intel", "reddit.com"), false);
});

test("unrelated hosts stay allowed and lookalikes are not over-blocked", () => {
  assert.equal(isHostDisabledForFeature("deepfake_intel", "notreddit.com.example.org"), false);
  assert.equal(isHostDisabledForFeature("deepfake_intel", "myreddit.com"), false);
  assert.equal(isHostDisabledForFeature("deepfake_intel", "youtube.com"), false);
  assert.equal(isHostDisabledForFeature("deepfake_intel", null), false);
});

test("candidate guard checks url, image, thumbnail and source", () => {
  assert.equal(
    isCandidateDisabledForFeature("deepfake_intel", { url: "https://example.com/a", thumbnail_url: "https://preview.redd.it/x.jpg" }),
    true,
  );
  assert.equal(
    isCandidateDisabledForFeature("deepfake_intel", { url: "https://example.com/a", source: "reddit_api" }),
    true,
  );
  assert.equal(
    isCandidateDisabledForFeature("deepfake_intel", { url: "https://example.com/a", source: "serpapi" }),
    false,
  );
});
