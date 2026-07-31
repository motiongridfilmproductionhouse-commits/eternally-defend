import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPageEvidence,
  detectPageType,
  finalizeDeepfakeFinding,
  isClientVisibleClassification,
  shouldPersistFinding,
} from "./page-evidence.server";
import { filterDeepfakeCandidates } from "./filter.server";

const actress = {
  name: "Maya Kapoor",
  aliases: ["Maya K"],
  handles: [],
};

test("detectPageType excludes search, tag, category, performer-index and listing URLs", () => {
  assert.equal(
    detectPageType("https://adult.example/search?q=Maya+Kapoor"),
    "search",
  );
  assert.equal(
    detectPageType("https://adult.example/tags/maya-kapoor"),
    "tag",
  );
  assert.equal(
    detectPageType("https://adult.example/category/celebrities"),
    "category",
  );
  assert.equal(
    detectPageType("https://adult.example/pornstar/maya-kapoor"),
    "performer_index",
  );
  assert.equal(
    detectPageType("https://adult.example/browse/newest"),
    "listing",
  );
  assert.equal(
    detectPageType(
      "https://adult.example/video/maya-kapoor-deepfake-face-swap-123",
      "Maya Kapoor deepfake face swap",
    ),
    "content",
  );
});

test("adult search pages mentioning an actress are not deepfake findings", () => {
  const result = classifyPageEvidence({
    url: "https://tube.example/search?q=Maya+Kapoor+nude",
    title: "Search results for Maya Kapoor nude",
    description: "Find Maya Kapoor porn videos",
    page_text:
      "Search results for Maya Kapoor. Filter by duration. Page 1 of 40 celebrity porn videos.",
    target: actress,
  });

  assert.equal(result.page_type, "search");
  assert.equal(result.finding_classification, "ADULT_NAME_MENTION");
  assert.equal(result.client_visible, false);
  assert.equal(isClientVisibleClassification(result.finding_classification), false);
});

test("name-only adult pages are never classified as deepfake", () => {
  const result = classifyPageEvidence({
    url: "https://forum.example/threads/maya-kapoor-photoshoot",
    title: "Maya Kapoor latest photoshoot",
    description: "Gallery discussion about Maya Kapoor red carpet photos",
    page_text:
      "Fans posted links about Maya Kapoor. Just celebrity gossip, nude rumour jokes, and paparazzi stills. Nothing claiming the images are AI-made or digitally impersonating her.",
    target: actress,
  });

  assert.equal(result.finding_classification, "ADULT_NAME_MENTION");
  assert.ok(result.identity_confidence >= 40);
  assert.ok(result.synthetic_media_confidence < 40);
  assert.equal(shouldPersistFinding(result.finding_classification), false);
});

test("unrelated adult performer pages are not attributed to the actress", () => {
  const result = classifyPageEvidence({
    url: "https://tube.example/video/other-performer-ai-nude-999",
    title: "Other Performer AI nude deepfake",
    description: "Synthetic adult video of a different person",
    page_text:
      "Other Performer starring in an AI nude deepfake face swap clip. No mention of the protected actress anywhere on this page body.",
    target: actress,
  });

  assert.equal(result.finding_classification, "UNRELATED_ADULT_CONTENT");
  assert.equal(result.client_visible, false);
});

test("probable deepfake requires identity and synthetic evidence on a content page", () => {
  const result = classifyPageEvidence({
    url: "https://abuse.example/watch/maya-kapoor-fake-nude-clip",
    title: "Maya Kapoor AI nude deepfake",
    description: "Face swap deepfake of Maya Kapoor",
    page_text:
      "This page hosts a Maya Kapoor deepfake face swap and AI nude video. Users uploaded synthetic media impersonating the actress.",
    target: actress,
  });

  assert.equal(result.page_type, "content");
  assert.equal(result.finding_classification, "PROBABLE_DEEPFAKE");
  assert.equal(result.client_visible, true);
  assert.ok(result.identity_confidence >= 50);
  assert.ok(result.synthetic_media_confidence >= 50);
  assert.ok(result.matched_evidence.some((item) => item.startsWith("identity:")));
  assert.ok(result.matched_evidence.some((item) => item.startsWith("synthetic:")));
});

test("verified deepfake requires strong identity plus media confirmation", () => {
  const result = finalizeDeepfakeFinding({
    url: "https://abuse.example/watch/maya-kapoor-verified-deepfake",
    title: "Maya Kapoor deepfake face swap",
    description: "Confirmed AI nude deepfake of Maya Kapoor",
    page_text:
      "Maya Kapoor deepfake face swap video with AI generated nude frames hosted on this content page.",
    target: actress,
    hive_deepfake_score: 0.96,
    hive_ai_generated_score: 0.93,
    target_face_match: true,
    face_similarity: 93,
    is_synthetic: true,
    content_category: "deepfake",
    existing_confidence: 96,
    existing_reasoning: "Hive media analysis completed.",
  });

  assert.equal(result.finding_classification, "VERIFIED_DEEPFAKE");
  assert.equal(result.client_visible, true);
  assert.equal(result.risk_level, "CRITICAL");
  assert.equal(result.page_type, "content");
  assert.ok(result.identity_confidence >= 70);
  assert.ok(result.synthetic_media_confidence >= 70);
  assert.ok(
    result.matched_evidence.includes("synthetic:hive-deepfake") ||
      result.matched_evidence.includes("identity:face-match"),
  );
});

test("candidate pre-filter rejects adult search listing URLs before crawl", () => {
  const filtered = filterDeepfakeCandidates(
    [
      {
        url: "https://tube.example/search?q=Maya+Kapoor+porn",
        title: "Maya Kapoor porn - Search results",
        description: "Maya Kapoor nude videos",
        query: '"Maya Kapoor" porn',
      },
      {
        url: "https://abuse.example/video/maya-kapoor-deepfake-ai-nude",
        title: "Maya Kapoor deepfake AI nude",
        description: "Face swap deepfake of Maya Kapoor",
        query: '"Maya Kapoor" deepfake',
      },
    ],
    actress,
  );

  assert.equal(filtered.accepted.length, 1);
  assert.equal(
    filtered.accepted[0]?.url,
    "https://abuse.example/video/maya-kapoor-deepfake-ai-nude",
  );
  assert.ok(
    filtered.rejected.some((item) =>
      /listing page excluded/i.test(item.rejection_reason ?? ""),
    ),
  );
});

test("explicit name mention without synthetic signal goes to triage, not accept", () => {
  const filtered = filterDeepfakeCandidates(
    [
      {
        url: "https://gossip.example/posts/maya-kapoor-nude-rumour",
        title: "Maya Kapoor nude rumour spreads online",
        description: "Tabloid claims about Maya Kapoor leaked photos",
        query: '"Maya Kapoor" nude',
      },
    ],
    actress,
  );

  assert.equal(filtered.accepted.length, 0);
  assert.equal(filtered.triage.length, 1);
  assert.match(
    filtered.triage[0]?.rejection_reason ?? "",
    /without synthetic/i,
  );
});
