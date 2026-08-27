/**
 * Regression tests for the Copyright Intelligence YouTube Monitoring
 * fail-visible fix: a discovered video whose AI classification never
 * actually completed (provider unavailable/error) must never be
 * indistinguishable from a confident "no relevant usage" result.
 *
 * decideVideoOutcome is a pure function — no network, no Supabase — so
 * every branch of the three-way outcome model can be exercised directly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decideVideoOutcome,
  analyzeYoutubeVideo,
  corroborateThumbnail,
  type AiClassificationOutcome,
  type RekognitionOutcome,
  type VideoIntel,
} from "./youtube-monitor.server";
import type { MovieFingerprint } from "./fingerprint.server";

function fakeIntel(overrides: Partial<VideoIntel> = {}): VideoIntel {
  return {
    contentCategory: "unrelated",
    copyrightUsage: "none",
    copyrightSignals: [],
    sentiment: "neutral",
    sentimentScore: 0,
    summary: "",
    reputationRisk: [],
    ...overrides,
  };
}

function classified(intel: VideoIntel): AiClassificationOutcome {
  return { status: "classified", intel };
}
const aiUnavailable: AiClassificationOutcome = { status: "unavailable", intel: null };
function aiError(message = "network error"): AiClassificationOutcome {
  return { status: "error", intel: null, errorMessage: message };
}

const rekUnavailable: RekognitionOutcome = {
  status: "unavailable",
  score: 0,
  signals: [],
  faceSimilarity: 0,
  celebrityMatches: [],
  sceneOverlap: 0,
  ocrTitleMatch: false,
};
function rekChecked(score: number): RekognitionOutcome {
  return { ...rekUnavailable, status: "checked", score };
}
function rekError(message = "rekognition error"): RekognitionOutcome {
  return { ...rekUnavailable, status: "error", errorMessage: message };
}

test("AI classified with copyright usage -> kept", () => {
  const outcome = decideVideoOutcome({
    ai: classified(fakeIntel({ copyrightUsage: "movie_footage" })),
    rek: rekUnavailable,
  });
  assert.equal(outcome, "kept");
});

test("AI classified with negative sentiment -> kept", () => {
  const outcome = decideVideoOutcome({
    ai: classified(fakeIntel({ sentiment: "negative" })),
    rek: rekUnavailable,
  });
  assert.equal(outcome, "kept");
});

test("AI classified with reputation risk signals -> kept", () => {
  const outcome = decideVideoOutcome({
    ai: classified(fakeIntel({ reputationRisk: ["defamation_claim"] })),
    rek: rekUnavailable,
  });
  assert.equal(outcome, "kept");
});

test("Rekognition strong match (score >= 40) alone -> kept, even with a confident AI 'none'", () => {
  const outcome = decideVideoOutcome({
    ai: classified(fakeIntel()),
    rek: rekChecked(65),
  });
  assert.equal(outcome, "kept");
});

test("a genuinely confident negative (AI classified none/neutral/no-risk, Rekognition unavailable) -> drop", () => {
  const outcome = decideVideoOutcome({ ai: classified(fakeIntel()), rek: rekUnavailable });
  assert.equal(outcome, "drop");
});

test("a genuinely confident negative with Rekognition checked but below threshold -> drop", () => {
  const outcome = decideVideoOutcome({ ai: classified(fakeIntel()), rek: rekChecked(12) });
  assert.equal(outcome, "drop");
});

test("REGRESSION: AI provider unavailable + Rekognition unavailable -> needs_review, never drop, never kept — this is the exact bug being fixed", () => {
  const outcome = decideVideoOutcome({ ai: aiUnavailable, rek: rekUnavailable });
  assert.equal(outcome, "needs_review");
});

test("REGRESSION: AI provider unavailable + Rekognition checked but below threshold -> still needs_review, not drop", () => {
  const outcome = decideVideoOutcome({ ai: aiUnavailable, rek: rekChecked(10) });
  assert.equal(
    outcome,
    "needs_review",
    "an inconclusive Rekognition score must not let a missing AI provider masquerade as a confident negative",
  );
});

test("REGRESSION: AI provider error (attempted, call failed) + Rekognition error -> needs_review, never silently dropped", () => {
  const outcome = decideVideoOutcome({ ai: aiError(), rek: rekError() });
  assert.equal(outcome, "needs_review");
});

test("AI unavailable but Rekognition itself finds a strong match -> kept (a real positive signal still counts)", () => {
  const outcome = decideVideoOutcome({ ai: aiUnavailable, rek: rekChecked(80) });
  assert.equal(outcome, "kept");
});

test("REGRESSION: needs_review is a genuinely distinct third bucket — never collapsed into kept or drop across every unavailable/error combination", () => {
  const failureAiStates: AiClassificationOutcome[] = [aiUnavailable, aiError()];
  const nonMatchingRekStates: RekognitionOutcome[] = [rekUnavailable, rekChecked(0), rekError()];
  for (const ai of failureAiStates) {
    for (const rek of nonMatchingRekStates) {
      const outcome = decideVideoOutcome({ ai, rek });
      assert.equal(
        outcome,
        "needs_review",
        `ai.status=${ai.status} + rek.status=${rek.status} must be needs_review, got ${outcome}`,
      );
    }
  }
});

test("analyzeYoutubeVideo: no LOVABLE_API_KEY configured -> status 'unavailable', never a fabricated classification", async () => {
  const original = process.env.LOVABLE_API_KEY;
  delete process.env.LOVABLE_API_KEY;
  try {
    const result = await analyzeYoutubeVideo({
      video: {
        videoId: "v1",
        videoUrl: "https://www.youtube.com/watch?v=v1",
        title: "t",
        description: "d",
        channelId: null,
        channelTitle: null,
        channelUrl: null,
        thumbnailUrl: null,
        publishedAt: null,
        viewCount: null,
        likeCount: null,
        commentCount: null,
        durationSeconds: null,
        matchedQuery: "q",
      },
      workTitle: "Some Work",
      referenceDataUrl: "data:image/png;base64,",
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.intel, null);
  } finally {
    if (original !== undefined) process.env.LOVABLE_API_KEY = original;
  }
});

test("corroborateThumbnail: fingerprint not available -> status 'unavailable', never attempted", async () => {
  const fp: MovieFingerprint = {
    available: false,
    frames: [],
    labels: [],
    sceneCategories: [],
    ocrLines: [],
    ocrTokens: [],
    celebrities: [],
    faceCount: 0,
    watermarkHints: [],
  };
  const result = await corroborateThumbnail(fp, "https://example.com/thumb.jpg");
  assert.equal(result.status, "unavailable");
  assert.equal(result.score, 0);
});

test("corroborateThumbnail: no thumbnail URL -> status 'unavailable', never attempted", async () => {
  const fp: MovieFingerprint = {
    available: true,
    frames: [new Uint8Array([1, 2, 3])],
    labels: [],
    sceneCategories: [],
    ocrLines: [],
    ocrTokens: [],
    celebrities: [],
    faceCount: 0,
    watermarkHints: [],
  };
  const result = await corroborateThumbnail(fp, null);
  assert.equal(result.status, "unavailable");
});
