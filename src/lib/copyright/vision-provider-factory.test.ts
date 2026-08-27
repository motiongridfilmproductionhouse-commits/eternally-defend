/**
 * Provider selection tests: getCopyrightVisionProvider must be
 * deterministic (Gemini preferred, then Lovable, then an explicit
 * unavailable no-op) and must never mix providers within one call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { getCopyrightVisionProvider, createNullVisionProvider } from "./vision-provider";

test("Gemini is selected when GEMINI_API_KEY is configured", async () => {
  const provider = await getCopyrightVisionProvider({
    hasGeminiKey: () => true,
    hasLovableKey: () => true, // both configured — Gemini must win
    createGemini: () => ({
      name: "gemini",
      isConfigured: () => true,
      analyzeReference: async () => {
        throw new Error("not used in this test");
      },
      analyzeYoutubeVideo: async () => ({ status: "classified", intel: null }),
    }),
    createLovable: () => {
      throw new Error("Lovable must not be constructed when Gemini is available");
    },
  });
  assert.equal(provider.name, "gemini");
});

test("Lovable is selected as a fallback when Gemini is not configured", async () => {
  const provider = await getCopyrightVisionProvider({
    hasGeminiKey: () => false,
    hasLovableKey: () => true,
    createGemini: () => {
      throw new Error("Gemini must not be constructed when its key is absent");
    },
    createLovable: () => ({
      name: "lovable",
      isConfigured: () => true,
      analyzeReference: async () => {
        throw new Error("not used in this test");
      },
      analyzeYoutubeVideo: async () => ({ status: "classified", intel: null }),
    }),
  });
  assert.equal(provider.name, "lovable");
});

test("an explicit unavailable provider is returned when neither key exists — never silently null/undefined", async () => {
  const provider = await getCopyrightVisionProvider({
    hasGeminiKey: () => false,
    hasLovableKey: () => false,
  });
  assert.equal(provider.isConfigured(), false);
  const result = await provider.analyzeYoutubeVideo({
    video: {
      videoId: "v",
      videoUrl: "https://www.youtube.com/watch?v=v",
      title: "t",
      description: "",
      channelId: null,
      channelTitle: null,
      channelUrl: null,
      thumbnailUrl: null,
      publishedAt: null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      durationSeconds: null,
      matchedQuery: "",
    },
    workTitle: "x",
    referenceDataUrl: "data:image/png;base64,",
  });
  assert.deepEqual(result, { status: "unavailable", intel: null });
});

test("REGRESSION: the null provider never reports 'safe'/'none'/'approved' — it is honestly unavailable", () => {
  const provider = createNullVisionProvider();
  assert.equal(provider.isConfigured(), false);
  assert.equal(provider.name, "none");
});
