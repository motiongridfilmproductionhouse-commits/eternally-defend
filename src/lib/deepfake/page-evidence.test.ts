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

const longPageBody = (text: string) =>
  `${text} ${"Additional page body content confirming this is a full crawled article page with enough text for exact-page evidence requirements. ".repeat(2)}`;

test("detectPageType excludes search, tag, category, performer-index and listing URLs", () => {
  assert.equal(detectPageType("https://adult.example/search?q=Maya+Kapoor"), "search");
  assert.equal(detectPageType("https://adult.example/tags/maya-kapoor"), "tag");
  assert.equal(detectPageType("https://adult.example/category/celebrities"), "category");
  assert.equal(detectPageType("https://adult.example/pornstar/maya-kapoor"), "performer_index");
  assert.equal(detectPageType("https://adult.example/browse/newest"), "listing");
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
    page_text: longPageBody(
      "Search results for Maya Kapoor. Filter by duration. Page 1 of 40 celebrity porn videos.",
    ),
    page_inspected: true,
    target: actress,
  });

  assert.equal(result.page_type, "search");
  assert.equal(result.finding_classification, "ADULT_NAME_MENTION");
  assert.equal(result.client_visible, false);
  assert.equal(isClientVisibleClassification(result.finding_classification), false);
  assert.equal(shouldPersistFinding(result.finding_classification), false);
});

test("name-only adult pages are never classified as deepfake", () => {
  const result = classifyPageEvidence({
    url: "https://forum.example/threads/maya-kapoor-photoshoot",
    title: "Maya Kapoor latest photoshoot",
    description: "Gallery discussion about Maya Kapoor red carpet photos",
    page_text: longPageBody(
      "Fans posted links about Maya Kapoor. Just celebrity gossip, nude rumour jokes, and paparazzi stills. Nothing claiming the images are AI-made or digitally impersonating her.",
    ),
    page_inspected: true,
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
    page_text: longPageBody(
      "Other Performer starring in an AI nude deepfake face swap clip. No mention of the protected actress anywhere on this page body.",
    ),
    page_inspected: true,
    target: actress,
  });

  assert.equal(result.finding_classification, "UNRELATED_ADULT_CONTENT");
  assert.equal(result.client_visible, false);
  assert.equal(shouldPersistFinding(result.finding_classification), false);
});

test("empty or failed exact-page crawl fails closed as UNVERIFIED_LEAD", () => {
  const failedCrawl = classifyPageEvidence({
    url: "https://abuse.example/watch/maya-kapoor-deepfake-face-swap",
    title: "Maya Kapoor deepfake face swap",
    description: "AI nude deepfake of Maya Kapoor from search snippet",
    page_text: "",
    page_inspected: false,
    target: actress,
  });

  assert.equal(failedCrawl.finding_classification, "UNVERIFIED_LEAD");
  assert.equal(failedCrawl.client_visible, false);
  assert.ok(failedCrawl.matched_evidence.includes("crawl:unavailable"));
  assert.equal(shouldPersistFinding(failedCrawl.finding_classification), true);

  const emptyBody = classifyPageEvidence({
    url: "https://abuse.example/watch/maya-kapoor-deepfake-face-swap",
    title: "Maya Kapoor deepfake face swap",
    description: "AI nude deepfake of Maya Kapoor",
    page_text: "short",
    page_inspected: true,
    target: actress,
  });

  assert.equal(emptyBody.finding_classification, "UNVERIFIED_LEAD");
  assert.equal(emptyBody.client_visible, false);
});

test("name mention plus the word deepfake is not VERIFIED_DEEPFAKE", () => {
  const result = classifyPageEvidence({
    url: "https://abuse.example/watch/maya-kapoor-deepfake-discussion",
    title: "Maya Kapoor deepfake rumours",
    description: "People discuss Maya Kapoor deepfake clips online",
    page_text: longPageBody(
      "Forum users mentioned Maya Kapoor and used the word deepfake while gossiping. No hosted media analysis is available on this page.",
    ),
    page_inspected: true,
    target: actress,
  });

  assert.notEqual(result.finding_classification, "VERIFIED_DEEPFAKE");
  assert.equal(result.client_visible, result.finding_classification === "PROBABLE_DEEPFAKE");
  assert.ok(
    result.finding_classification === "PROBABLE_DEEPFAKE" ||
      result.finding_classification === "UNVERIFIED_LEAD",
  );
});

test("search snippets alone cannot become PROBABLE_DEEPFAKE", () => {
  const result = classifyPageEvidence({
    url: "https://abuse.example/watch/maya-kapoor-deepfake-ai-nude",
    title: "Maya Kapoor deepfake AI nude face swap",
    description: "Face swap deepfake of Maya Kapoor",
    page_text: "",
    page_inspected: false,
    query: '"Maya Kapoor" deepfake',
    target: actress,
  });

  assert.equal(result.finding_classification, "UNVERIFIED_LEAD");
  assert.equal(isClientVisibleClassification(result.finding_classification), false);
});

test("probable deepfake requires identity and synthetic evidence on a crawled content page", () => {
  const result = classifyPageEvidence({
    url: "https://abuse.example/watch/maya-kapoor-fake-nude-clip",
    title: "Maya Kapoor AI nude deepfake",
    description: "Face swap deepfake of Maya Kapoor",
    page_text: longPageBody(
      "This page hosts a Maya Kapoor deepfake face swap and AI nude video. Users uploaded synthetic media impersonating the actress.",
    ),
    page_inspected: true,
    target: actress,
  });

  assert.equal(result.page_type, "content");
  assert.equal(result.finding_classification, "PROBABLE_DEEPFAKE");
  assert.equal(result.client_visible, true);
  assert.ok(result.identity_confidence >= 50);
  assert.ok(result.synthetic_media_confidence >= 50);
  assert.ok(result.matched_evidence.includes("crawl:exact-page"));
  assert.ok(result.matched_evidence.some((item) => item.startsWith("identity:")));
  assert.ok(result.matched_evidence.some((item) => item.startsWith("synthetic:")));
});

test("verified deepfake requires strong identity plus visual synthetic confirmation", () => {
  const textOnly = finalizeDeepfakeFinding({
    url: "https://abuse.example/watch/maya-kapoor-text-only",
    title: "Maya Kapoor deepfake face swap",
    description: "AI nude deepfake of Maya Kapoor",
    page_text: longPageBody(
      "Maya Kapoor deepfake face swap video with AI nude claims on the page, but no visual classifier confirmation.",
    ),
    page_inspected: true,
    target: actress,
    target_face_match: true,
    face_similarity: 93,
    is_synthetic: false,
  });

  assert.notEqual(textOnly.finding_classification, "VERIFIED_DEEPFAKE");

  const result = finalizeDeepfakeFinding({
    url: "https://abuse.example/watch/maya-kapoor-verified-deepfake",
    title: "Maya Kapoor deepfake face swap",
    description: "Confirmed AI nude deepfake of Maya Kapoor",
    page_text: longPageBody(
      "Maya Kapoor deepfake face swap video with AI generated nude frames hosted on this content page.",
    ),
    page_inspected: true,
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
  assert.ok(result.matched_evidence.includes("synthetic:hive-deepfake"));
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
    filtered.rejected.some((item) => /listing page excluded/i.test(item.rejection_reason ?? "")),
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
  assert.match(filtered.triage[0]?.rejection_reason ?? "", /without synthetic/i);
});

test("ADULT_NAME_MENTION and UNRELATED_ADULT_CONTENT are not persisted findings", () => {
  assert.equal(shouldPersistFinding("ADULT_NAME_MENTION"), false);
  assert.equal(shouldPersistFinding("UNRELATED_ADULT_CONTENT"), false);
  assert.equal(shouldPersistFinding("UNVERIFIED_LEAD"), true);
  assert.equal(shouldPersistFinding("PROBABLE_DEEPFAKE"), true);
  assert.equal(shouldPersistFinding("VERIFIED_DEEPFAKE"), true);
  assert.equal(isClientVisibleClassification("UNVERIFIED_LEAD"), false);
  assert.equal(isClientVisibleClassification("VERIFIED_DEEPFAKE"), true);
  assert.equal(isClientVisibleClassification("PROBABLE_DEEPFAKE"), true);
});
