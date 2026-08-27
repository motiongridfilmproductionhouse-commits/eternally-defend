/**
 * Regression tests for YouTube Monitoring's deterministic (non-AI)
 * pipeline: relevance is decided from YouTube Data API metadata plus the
 * existing AWS Rekognition corroboration only — no Gemini, no Lovable, no
 * external AI vision call of any kind. A discovered candidate must never
 * disappear just because no automatic category could be assigned.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreMetadataMatch,
  decideVideoOutcomeFromEvidence,
  discoverYoutubeVideos,
  type RekognitionOutcome,
  type YtVideo,
} from "./youtube-monitor.server";

const __dirname = dirname(fileURLToPath(import.meta.url));

function fakeVideo(overrides: Partial<YtVideo> = {}): YtVideo {
  return {
    videoId: "v1",
    videoUrl: "https://www.youtube.com/watch?v=v1",
    title: "Some video",
    description: "",
    channelId: "UC1",
    channelTitle: "Some Channel",
    channelUrl: "https://www.youtube.com/channel/UC1",
    thumbnailUrl: "https://i.ytimg.com/vi/v1/hqdefault.jpg",
    publishedAt: "2026-08-01T00:00:00.000Z",
    viewCount: 100,
    likeCount: 10,
    commentCount: 1,
    durationSeconds: 300,
    matchedQuery: "q",
    ...overrides,
  };
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
function rekError(): RekognitionOutcome {
  return { ...rekUnavailable, status: "error", errorMessage: "rekognition down" };
}

// ---------------------------------------------------------------------
// scoreMetadataMatch — pure, deterministic, no external calls
// ---------------------------------------------------------------------

test("scoreMetadataMatch: title literally contains the work title -> strong_match", () => {
  const result = scoreMetadataMatch({
    video: fakeVideo({ title: "Bigg Boss Malayalam Agnipareeksha - Episode 12 Highlights" }),
    workTitle: "Bigg Boss Malayalam Agnipareeksha",
  });
  assert.equal(result.status, "strong_match");
  assert.ok(result.matchedSignals.includes("title_contains_work_title"));
});

test("scoreMetadataMatch: description contains the work title -> strong_match", () => {
  const result = scoreMetadataMatch({
    video: fakeVideo({ title: "Unrelated title", description: "A clip from Some Great Movie" }),
    workTitle: "Some Great Movie",
  });
  assert.equal(result.status, "strong_match");
  assert.ok(result.matchedSignals.includes("description_contains_work_title"));
});

test("scoreMetadataMatch: a known name (e.g. Rekognition-recognised celebrity) mentioned in the title -> strong_match", () => {
  const result = scoreMetadataMatch({
    video: fakeVideo({ title: "Jane Doe's new interview clip" }),
    workTitle: "Some Movie Title That Does Not Appear",
    knownNames: ["Jane Doe"],
  });
  assert.equal(result.status, "strong_match");
  assert.ok(result.matchedSignals.includes("known_name_match"));
});

test("scoreMetadataMatch: partial token overlap only -> weak_match, never strong on its own", () => {
  const result = scoreMetadataMatch({
    video: fakeVideo({ title: "Random Malayalam comedy skit compilation" }),
    workTitle: "Bigg Boss Malayalam Agnipareeksha",
  });
  assert.equal(result.status, "weak_match");
});

test("scoreMetadataMatch: no textual overlap at all -> no_match", () => {
  const result = scoreMetadataMatch({
    video: fakeVideo({ title: "How to bake bread", description: "A baking tutorial" }),
    workTitle: "Bigg Boss Malayalam Agnipareeksha",
  });
  assert.equal(result.status, "no_match");
  assert.deepEqual(result.matchedSignals, []);
});

test("scoreMetadataMatch: an empty/blank work title never produces a fabricated match", () => {
  const result = scoreMetadataMatch({
    video: fakeVideo({ title: "Anything at all" }),
    workTitle: "   ",
  });
  assert.equal(result.status, "no_match");
});

// ---------------------------------------------------------------------
// decideVideoOutcomeFromEvidence — the deterministic three-way safety model
//
// SAFETY CORRECTION: metadata relevance alone (however strong) can never
// produce "kept". Title/description/known-name matching proves the video
// is RELEVANT to the protected work — it says nothing about whether the
// work's footage/likeness is actually REUSED, which is what "kept" means.
// Only an independent visual signal (the existing Rekognition threshold,
// score >= 40, unchanged) can produce "kept". A strong metadata match
// still isn't dropped — it always lands in needs_review, same as a weak
// match — so a logo/poster reference (no face for Rekognition to
// corroborate) can never auto-confirm a finding from text alone.
// ---------------------------------------------------------------------

test("SCENARIO: strong Rekognition match alone -> kept, even with no metadata overlap", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "no_match", matchedSignals: [] },
    rek: rekChecked(72),
  });
  assert.equal(outcome, "kept");
});

test("SCENARIO: exact work title in the YouTube title, no Rekognition -> needs_review, never kept on text alone", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "strong_match", matchedSignals: ["title_contains_work_title"] },
    rek: rekUnavailable,
  });
  assert.equal(outcome, "needs_review");
});

test("SCENARIO: exact work title in the description, no Rekognition -> needs_review, never kept on text alone", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "strong_match", matchedSignals: ["description_contains_work_title"] },
    rek: rekUnavailable,
  });
  assert.equal(outcome, "needs_review");
});

test("SCENARIO: known actor/name match only, no Rekognition -> needs_review, never kept on text alone", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "strong_match", matchedSignals: ["known_name_match"] },
    rek: rekUnavailable,
  });
  assert.equal(outcome, "needs_review");
});

test("SCENARIO: strong metadata match + Rekognition just below threshold (39) -> needs_review, not kept", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "strong_match", matchedSignals: ["title_contains_work_title"] },
    rek: rekChecked(39),
  });
  assert.equal(outcome, "needs_review");
});

test("SCENARIO: strong metadata match + Rekognition at threshold (40) -> kept", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "strong_match", matchedSignals: ["title_contains_work_title"] },
    rek: rekChecked(40),
  });
  assert.equal(outcome, "kept");
});

test("SCENARIO: weak metadata match -> needs_review, never dropped, never kept", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "weak_match", matchedSignals: ["title_token_overlap:1/3"] },
    rek: rekUnavailable,
  });
  assert.equal(outcome, "needs_review");
});

test("SCENARIO: weak metadata match + a Rekognition provider error -> still needs_review, never treated as a confirmed non-match", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "weak_match", matchedSignals: ["title_token_overlap:1/3"] },
    rek: rekError(),
  });
  assert.equal(outcome, "needs_review");
});

test("SCENARIO: logo/poster reference — a weak metadata match is preserved for review even though Rekognition never runs (no face to compare)", () => {
  // A logo reference yields no faces, so corroborateThumbnail always
  // reports "unavailable" for this kind of reference — the candidate must
  // still surface for human review whenever metadata gives any signal.
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "weak_match", matchedSignals: ["title_token_overlap:1/2"] },
    rek: rekUnavailable,
  });
  assert.equal(outcome, "needs_review");
});

test("SCENARIO: logo/poster reference — even a strong (exact title) metadata match persists as needs_review, never auto-kept, since Rekognition cannot corroborate a logo", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "strong_match", matchedSignals: ["title_contains_work_title"] },
    rek: rekUnavailable,
  });
  assert.equal(outcome, "needs_review");
});

test("SCENARIO: no metadata evidence and no Rekognition corroboration -> drop", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "no_match", matchedSignals: [] },
    rek: rekUnavailable,
  });
  assert.equal(outcome, "drop");
});

test("SCENARIO: no metadata evidence and Rekognition actively checked but below the match threshold -> drop", () => {
  const outcome = decideVideoOutcomeFromEvidence({
    metadata: { status: "no_match", matchedSignals: [] },
    rek: rekChecked(5),
  });
  assert.equal(outcome, "drop");
});

test("REGRESSION: the existing Rekognition 'kept' threshold (score >= 40) is unchanged", () => {
  assert.equal(
    decideVideoOutcomeFromEvidence({
      metadata: { status: "no_match", matchedSignals: [] },
      rek: rekChecked(39),
    }),
    "drop",
  );
  assert.equal(
    decideVideoOutcomeFromEvidence({
      metadata: { status: "no_match", matchedSignals: [] },
      rek: rekChecked(40),
    }),
    "kept",
  );
});

test("REGRESSION: metadata relevance alone (strong or weak) never produces 'kept' — only an independent Rekognition match can", () => {
  for (const status of ["strong_match", "weak_match"] as const) {
    for (const rek of [rekUnavailable, rekError(), rekChecked(0), rekChecked(39)]) {
      const outcome = decideVideoOutcomeFromEvidence({
        metadata: { status, matchedSignals: [] },
        rek,
      });
      assert.notEqual(
        outcome,
        "kept",
        `metadata=${status} + rek.status=${rek.status}/score=${rek.score} must never be "kept"`,
      );
    }
  }
});

// ---------------------------------------------------------------------
// discoverYoutubeVideos — existing YouTube Data API discovery, unchanged
// ---------------------------------------------------------------------

test("SCENARIO: zero search results -> discoverYoutubeVideos returns an empty list, no crash", async () => {
  const videos = await discoverYoutubeVideos([]);
  assert.deepEqual(videos, []);
});

test("SCENARIO: a total YouTube API/provider failure degrades to an empty result, never throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  try {
    const videos = await discoverYoutubeVideos(["some query"]);
    assert.deepEqual(videos, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------
// Structural regression: no Gemini/Lovable dependency anywhere in this path
// ---------------------------------------------------------------------

test("REGRESSION: runYoutubeMonitor's own source never references GEMINI_API_KEY, LOVABLE_API_KEY, or the vision-provider abstraction — monitoring is fully independent of any AI vision provider", () => {
  const source = readFileSync(join(__dirname, "youtube-monitor.functions.ts"), "utf8");
  // Isolate runYoutubeMonitor's handler specifically (runReleaseDayReviewAnalysis,
  // a separate unrelated feature further down this file, is intentionally
  // untouched and still uses Lovable directly).
  const start = source.indexOf("export const runYoutubeMonitor");
  const end = source.indexOf("export const listYoutubeMonitor");
  assert.ok(start >= 0 && end > start, "could not locate runYoutubeMonitor in the source");
  const handlerSource = source.slice(start, end);

  assert.doesNotMatch(handlerSource, /GEMINI_API_KEY/);
  assert.doesNotMatch(handlerSource, /LOVABLE_API_KEY/);
  assert.doesNotMatch(handlerSource, /getCopyrightVisionProvider/);
  assert.doesNotMatch(handlerSource, /analyzeYoutubeVideo/);
  assert.doesNotMatch(handlerSource, /analyzeReference/);
  assert.doesNotMatch(handlerSource, /vision-provider/);
});

test("REGRESSION: monitoring still functions normally with neither GEMINI_API_KEY nor LOVABLE_API_KEY set", async () => {
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalLovable = process.env.LOVABLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.LOVABLE_API_KEY;
  try {
    // The deterministic pipeline itself never reads either key — this
    // exercises the exact same pure functions runYoutubeMonitor calls.
    const metadata = scoreMetadataMatch({
      video: fakeVideo({ title: "Bigg Boss Malayalam Agnipareeksha clip" }),
      workTitle: "Bigg Boss Malayalam Agnipareeksha",
    });
    const outcome = decideVideoOutcomeFromEvidence({ metadata, rek: rekUnavailable });
    assert.equal(metadata.status, "strong_match");
    assert.equal(outcome, "needs_review");
  } finally {
    if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini;
    if (originalLovable !== undefined) process.env.LOVABLE_API_KEY = originalLovable;
  }
});
