/**
 * Contract test: Gemini and Lovable are wire-incompatible (OpenAI-chat-
 * completions vs. Gemini generateContent), but business logic must never
 * see that difference. Both providers, given equivalent underlying model
 * output, must produce the exact same normalized AiClassificationOutcome
 * shape.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiVisionProvider } from "./providers/gemini-vision-provider";
import { createLovableVisionProvider } from "./providers/lovable-vision-provider";
import type { YtVideo } from "./vision-provider";

const video: YtVideo = {
  videoId: "abc123",
  videoUrl: "https://www.youtube.com/watch?v=abc123",
  title: "Some video",
  description: "desc",
  channelId: "UC1",
  channelTitle: "Some Channel",
  channelUrl: "https://www.youtube.com/channel/UC1",
  thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
  publishedAt: "2026-08-01T00:00:00.000Z",
  viewCount: 100,
  likeCount: 10,
  commentCount: 1,
  durationSeconds: 300,
  matchedQuery: "q",
};
const referenceDataUrl = "data:image/png;base64," + Buffer.from("ref").toString("base64");

const MODEL_INTEL = {
  contentCategory: "full_movie",
  copyrightUsage: "movie_footage",
  copyrightSignals: ["scene_frame_used"],
  sentiment: "negative",
  sentimentScore: -60,
  reputationRisk: ["spoiler_leak"],
  summary: "Full movie reuploaded.",
};

function geminiFetch(): typeof fetch {
  return (async (url: string) => {
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(MODEL_INTEL) }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(new Uint8Array(1024).fill(1), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  }) as typeof fetch;
}

function lovableFetch(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(MODEL_INTEL) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

test("CONTRACT: Gemini and Lovable normalize equivalent model output into the identical AiClassificationOutcome shape", async () => {
  const gemini = createGeminiVisionProvider({
    apiKey: () => "gk",
    sleepImpl: async () => {},
    fetchImpl: geminiFetch(),
  });
  const lovable = createLovableVisionProvider({
    apiKey: () => "lk",
    fetchImpl: lovableFetch(),
  });

  const geminiResult = await gemini.analyzeYoutubeVideo({
    video,
    workTitle: "x",
    referenceDataUrl,
  });
  const lovableResult = await lovable.analyzeYoutubeVideo({
    video,
    workTitle: "x",
    referenceDataUrl,
  });

  assert.equal(geminiResult.status, "classified");
  assert.equal(lovableResult.status, "classified");
  assert.deepEqual(geminiResult.intel, lovableResult.intel);
});

test("CONTRACT: both providers report the identical 'unavailable' shape when unconfigured", async () => {
  const gemini = createGeminiVisionProvider({ apiKey: () => undefined });
  const lovable = createLovableVisionProvider({ apiKey: () => undefined });

  const geminiResult = await gemini.analyzeYoutubeVideo({
    video,
    workTitle: "x",
    referenceDataUrl,
  });
  const lovableResult = await lovable.analyzeYoutubeVideo({
    video,
    workTitle: "x",
    referenceDataUrl,
  });

  assert.deepEqual(geminiResult, { status: "unavailable", intel: null });
  assert.deepEqual(lovableResult, { status: "unavailable", intel: null });
});

test("CONTRACT: both providers report status 'error' (never 'classified' or a fabricated 'none') on a provider failure", async () => {
  const gemini = createGeminiVisionProvider({
    apiKey: () => "gk",
    sleepImpl: async () => {},
    fetchImpl: (async () => new Response("boom", { status: 500 })) as typeof fetch,
    maxRetries: 0,
  });
  const lovable = createLovableVisionProvider({
    apiKey: () => "lk",
    fetchImpl: (async () => new Response("boom", { status: 500 })) as typeof fetch,
  });

  const geminiResult = await gemini.analyzeYoutubeVideo({
    video,
    workTitle: "x",
    referenceDataUrl,
  });
  const lovableResult = await lovable.analyzeYoutubeVideo({
    video,
    workTitle: "x",
    referenceDataUrl,
  });

  assert.equal(geminiResult.status, "error");
  assert.equal(lovableResult.status, "error");
  assert.equal(geminiResult.intel, null);
  assert.equal(lovableResult.intel, null);
});
