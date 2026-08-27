/**
 * GeminiVisionProvider tests. No real network calls — fetchImpl and
 * sleepImpl are injected, so retry/backoff tests run instantly and every
 * scenario is deterministic.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiVisionProvider } from "./gemini-vision-provider";
import type { YtVideo } from "../vision-provider";

const GEMINI_URL_PREFIX = "https://generativelanguage.googleapis.com/";
const THUMB_URL = "https://i.ytimg.com/vi/abc123/hqdefault.jpg";
const REFERENCE_DATA_URL =
  "data:image/png;base64," + Buffer.from("fake-reference-bytes").toString("base64");

function fakeVideo(overrides: Partial<YtVideo> = {}): YtVideo {
  return {
    videoId: "abc123",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
    title: "Some video",
    description: "desc",
    channelId: "UC1",
    channelTitle: "Some Channel",
    channelUrl: "https://www.youtube.com/channel/UC1",
    thumbnailUrl: THUMB_URL,
    publishedAt: "2026-08-01T00:00:00.000Z",
    viewCount: 100,
    likeCount: 10,
    commentCount: 1,
    durationSeconds: 300,
    matchedQuery: "q",
    ...overrides,
  };
}

function geminiJsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function thumbnailImageResponse(
  opts: { contentType?: string; bytes?: number; status?: number } = {},
): Response {
  const bytes = new Uint8Array(opts.bytes ?? 1024).fill(1);
  return new Response(bytes, {
    status: opts.status ?? 200,
    headers: { "content-type": opts.contentType ?? "image/jpeg" },
  });
}

function noSleep() {
  return async () => {};
}

test("successful classification: usage found -> status classified, intel mapped correctly", async () => {
  let calls = 0;
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      calls += 1;
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        return geminiJsonResponse({
          contentCategory: "full_movie",
          copyrightUsage: "movie_footage",
          copyrightSignals: ["scene_frame_used"],
          sentiment: "negative",
          sentimentScore: -60,
          reputationRisk: ["spoiler_leak"],
          summary: "Full movie reuploaded.",
        });
      }
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "Some Movie",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "classified");
  assert.equal(result.intel?.copyrightUsage, "movie_footage");
  assert.equal(result.intel?.sentiment, "negative");
  assert.equal(result.intel?.sentimentScore, -60);
  assert.deepEqual(result.intel?.reputationRisk, ["spoiler_leak"]);
  assert.equal(calls, 2, "one thumbnail fetch + one Gemini call");
});

test("negative classification: AI confidently finds nothing relevant -> status classified, usage none", async () => {
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        return geminiJsonResponse({
          contentCategory: "unrelated",
          copyrightUsage: "none",
          copyrightSignals: [],
          sentiment: "neutral",
          sentimentScore: 0,
          reputationRisk: [],
          summary: "Unrelated content.",
        });
      }
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "Some Movie",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "classified");
  assert.equal(result.intel?.copyrightUsage, "none");
});

test("missing API key -> status unavailable, no fetch attempted at all", async () => {
  let fetchCalled = false;
  const provider = createGeminiVisionProvider({
    apiKey: () => undefined,
    fetchImpl: (async () => {
      fetchCalled = true;
      return geminiJsonResponse({});
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.deepEqual(result, { status: "unavailable", intel: null });
  assert.equal(fetchCalled, false);
});

test("provider unavailable is a distinct shape from a provider error", async () => {
  const provider = createGeminiVisionProvider({ apiKey: () => undefined });
  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });
  assert.equal(result.status, "unavailable");
  assert.equal("errorMessage" in result, false);
});

test("HTTP 429 then a successful retry -> eventually classified, exactly 2 Gemini attempts, one sleep", async () => {
  let geminiCalls = 0;
  let sleepCalls = 0;
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: async () => {
      sleepCalls += 1;
    },
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        geminiCalls += 1;
        if (geminiCalls === 1) return new Response("rate limited", { status: 429 });
        return geminiJsonResponse({
          contentCategory: "review",
          copyrightUsage: "none",
          sentiment: "neutral",
          sentimentScore: 0,
          reputationRisk: [],
          summary: "ok",
        });
      }
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "classified");
  assert.equal(geminiCalls, 2);
  assert.equal(sleepCalls, 1);
});

test("persistent HTTP 429 -> status error after exhausting retries, never dropped, never classified", async () => {
  let geminiCalls = 0;
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    maxRetries: 2,
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        geminiCalls += 1;
        return new Response("rate limited", { status: 429 });
      }
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /429/);
  assert.equal(geminiCalls, 3, "maxRetries=2 -> 3 total attempts");
});

test("HTTP 500 is retried and can succeed", async () => {
  let geminiCalls = 0;
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        geminiCalls += 1;
        if (geminiCalls === 1) return new Response("server error", { status: 500 });
        return geminiJsonResponse({
          contentCategory: "review",
          copyrightUsage: "none",
          sentiment: "neutral",
          sentimentScore: 0,
          reputationRisk: [],
          summary: "ok",
        });
      }
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "classified");
  assert.equal(geminiCalls, 2);
});

test("HTTP 400 is NEVER retried -> status error after exactly one attempt", async () => {
  let geminiCalls = 0;
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        geminiCalls += 1;
        return new Response("bad request", { status: 400 });
      }
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "error");
  assert.equal(geminiCalls, 1, "400 must never be retried");
});

test("HTTP 401/403 are also never retried", async () => {
  for (const status of [401, 403]) {
    let geminiCalls = 0;
    const provider = createGeminiVisionProvider({
      apiKey: () => "test-key",
      sleepImpl: noSleep(),
      fetchImpl: (async (url: string) => {
        if (url.startsWith(GEMINI_URL_PREFIX)) {
          geminiCalls += 1;
          return new Response("unauthorized", { status });
        }
        return thumbnailImageResponse();
      }) as typeof fetch,
    });
    const result = await provider.analyzeYoutubeVideo({
      video: fakeVideo(),
      workTitle: "x",
      referenceDataUrl: REFERENCE_DATA_URL,
    });
    assert.equal(result.status, "error");
    assert.equal(geminiCalls, 1, `status ${status} must never be retried`);
  }
});

test("a persistent network-level failure (e.g. timeout) is retried, then reported as error, never dropped", async () => {
  let geminiCalls = 0;
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    maxRetries: 2,
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        geminiCalls += 1;
        throw new Error("The operation was aborted due to timeout");
      }
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /timeout/);
  assert.equal(geminiCalls, 3, "network failures are retried up to maxRetries");
});

test("malformed JSON in the classification response -> status error, not thrown, not classified", async () => {
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "{not valid json" }] } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /malformed/);
});

test("malformed/unsupported thumbnail content-type -> status error, Gemini is never even called", async () => {
  let geminiCalled = false;
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) {
        geminiCalled = true;
        return geminiJsonResponse({});
      }
      return thumbnailImageResponse({ contentType: "text/html" });
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /content-type/);
  assert.equal(geminiCalled, false);
});

test("oversized thumbnail response -> status error, never treated as safe", async () => {
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) return geminiJsonResponse({});
      return new Response(new Uint8Array(1), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(50 * 1024 * 1024) },
      });
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /size/);
});

test("REGRESSION: thumbnail host outside the allowlist is never fetched — SSRF defense in depth", async () => {
  const fetchedUrls: string[] = [];
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      fetchedUrls.push(url);
      if (url.startsWith(GEMINI_URL_PREFIX)) return geminiJsonResponse({});
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo({ thumbnailUrl: "https://evil.example.com/thumb.jpg" }),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "error");
  assert.ok(
    fetchedUrls.every((u) => !u.includes("evil.example.com")),
    "an off-allowlist host must never be fetched",
  );
});

test("a malformed reference data URL -> status error, never classified", async () => {
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async () => geminiJsonResponse({})) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: "not-a-data-url",
  });

  assert.equal(result.status, "error");
});

test("no thumbnail URL at all -> still classifies using only the reference image", async () => {
  let geminiCalls = 0;
  const provider = createGeminiVisionProvider({
    apiKey: () => "test-key",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      geminiCalls += 1;
      assert.ok(
        url.startsWith(GEMINI_URL_PREFIX),
        "only the Gemini endpoint should ever be called",
      );
      return geminiJsonResponse({
        contentCategory: "unrelated",
        copyrightUsage: "none",
        sentiment: "neutral",
        sentimentScore: 0,
        reputationRisk: [],
        summary: "ok",
      });
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo({ thumbnailUrl: null }),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(result.status, "classified");
  assert.equal(geminiCalls, 1);
});

test("the Gemini API key is never present in the returned outcome or error message", async () => {
  const provider = createGeminiVisionProvider({
    apiKey: () => "super-secret-key-value",
    sleepImpl: noSleep(),
    fetchImpl: (async (url: string) => {
      if (url.startsWith(GEMINI_URL_PREFIX)) return new Response("unauthorized", { status: 401 });
      return thumbnailImageResponse();
    }) as typeof fetch,
  });

  const result = await provider.analyzeYoutubeVideo({
    video: fakeVideo(),
    workTitle: "x",
    referenceDataUrl: REFERENCE_DATA_URL,
  });

  assert.equal(JSON.stringify(result).includes("super-secret-key-value"), false);
});
