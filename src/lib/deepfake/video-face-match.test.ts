import assert from "node:assert/strict";
import test from "node:test";
import { compareVideoCandidateAgainstReferences } from "./video-face-match.server";

const originalCrawlerUrl = process.env.CRAWLER_SERVICE_URL;

function restore() {
  if (originalCrawlerUrl === undefined) {
    delete process.env.CRAWLER_SERVICE_URL;
  } else {
    process.env.CRAWLER_SERVICE_URL = originalCrawlerUrl;
  }
}

test("video candidate face match degrades to null (not a throw) when keyframe extraction is unconfigured", async () => {
  delete process.env.CRAWLER_SERVICE_URL;
  try {
    const result = await compareVideoCandidateAgainstReferences({
      videoUrl: "https://abuse.example/clip.mp4",
      referenceImages: [new Uint8Array([1, 2, 3])],
    });
    assert.equal(result, null);
  } finally {
    restore();
  }
});

test("video candidate face match returns null without any network call when there are no reference images", async () => {
  process.env.CRAWLER_SERVICE_URL = "https://crawler.example";
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called when there are no reference images");
  }) as typeof fetch;

  try {
    const result = await compareVideoCandidateAgainstReferences({
      videoUrl: "https://abuse.example/clip.mp4",
      referenceImages: [],
    });
    assert.equal(result, null);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
