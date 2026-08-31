import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalSourceType,
  filterHitsBySourceType,
  isCanonicalSourceType,
  labelForSourceType,
  SOURCE_TYPE_FILTERS,
} from "./source-type";

describe("canonicalSourceType", () => {
  it("maps every display label produced by platformFromUrl to its canonical singular value", () => {
    assert.equal(canonicalSourceType("YouTube"), "youtube");
    assert.equal(canonicalSourceType("News"), "news");
    assert.equal(canonicalSourceType("Reddit"), "reddit");
    assert.equal(canonicalSourceType("X"), "x");
    assert.equal(canonicalSourceType("Instagram"), "instagram");
    assert.equal(canonicalSourceType("TikTok"), "tiktok");
    assert.equal(canonicalSourceType("Facebook"), "facebook");
    assert.equal(canonicalSourceType("Blogs"), "blog");
    assert.equal(canonicalSourceType("Forums"), "forum");
    assert.equal(canonicalSourceType("Reviews"), "review");
    assert.equal(canonicalSourceType("Archive"), "archive");
    assert.equal(canonicalSourceType("LinkedIn"), "linkedin");
    assert.equal(canonicalSourceType("Podcasts"), "podcast");
    assert.equal(canonicalSourceType("Complaints"), "complaint");
    assert.equal(canonicalSourceType("Web"), "web");
  });

  it("is case-insensitive and trims whitespace", () => {
    assert.equal(canonicalSourceType("  reddit  "), "reddit");
    assert.equal(canonicalSourceType("REDDIT"), "reddit");
  });

  it("falls back to web for unknown or missing labels (e.g. legacy 'AI Research')", () => {
    assert.equal(canonicalSourceType("AI Research"), "web");
    assert.equal(canonicalSourceType(""), "web");
    assert.equal(canonicalSourceType(null), "web");
    assert.equal(canonicalSourceType(undefined), "web");
  });

  it("accepts already-canonical singular values as-is", () => {
    assert.equal(canonicalSourceType("blog"), "blog");
    assert.equal(canonicalSourceType("forum"), "forum");
    assert.equal(canonicalSourceType("podcast"), "podcast");
  });
});

describe("SOURCE_TYPE_FILTERS", () => {
  it("starts with 'All Sources' immediately before YouTube, matching the required button order", () => {
    const values = SOURCE_TYPE_FILTERS.map((f) => f.value);
    assert.deepEqual(values.slice(0, 2), ["", "youtube"]);
  });

  it("lists exactly the 15 required platforms in the specified order", () => {
    assert.deepEqual(
      SOURCE_TYPE_FILTERS.map((f) => f.label),
      [
        "All Sources",
        "YouTube",
        "News",
        "Reddit",
        "X",
        "Instagram",
        "TikTok",
        "Facebook",
        "Blogs",
        "Forums",
        "Reviews",
        "Archive",
        "LinkedIn",
        "Podcasts",
        "Complaints",
        "Web",
      ],
    );
  });

  it("has no duplicate values", () => {
    const values = SOURCE_TYPE_FILTERS.map((f) => f.value);
    assert.equal(new Set(values).size, values.length);
  });
});

describe("isCanonicalSourceType / labelForSourceType", () => {
  it("recognizes every filterable value and rejects garbage", () => {
    assert.equal(isCanonicalSourceType("reddit"), true);
    assert.equal(isCanonicalSourceType("Reddit"), false); // must be the canonical lowercase form
    assert.equal(isCanonicalSourceType("not-a-source"), false);
  });

  it("resolves a canonical value back to its display label", () => {
    assert.equal(labelForSourceType("reddit"), "Reddit");
    assert.equal(labelForSourceType("blog"), "Blogs");
  });
});

describe("filterHitsBySourceType — exclusivity guarantee", () => {
  const hits = [
    { id: "1", source: "Reddit" },
    { id: "2", source: "YouTube" },
    { id: "3", source: "Reddit" },
    { id: "4", source: "News" },
    { id: "5", source: "Instagram" },
    { id: "6", source: "X" },
    { id: "7", source: "TikTok" },
    { id: "8", source: "Facebook" },
    { id: "9", source: "Blogs" },
    { id: "10", source: "Forums" },
    { id: "11", source: "Reviews" },
    { id: "12", source: "Archive" },
    { id: "13", source: "LinkedIn" },
    { id: "14", source: "Podcasts" },
    { id: "15", source: "Complaints" },
    { id: "16", source: "Web" },
  ];

  it("selecting Reddit returns only Reddit findings — no other source_type is present", () => {
    const result = filterHitsBySourceType(hits, "reddit");
    assert.deepEqual(
      result.map((h) => h.id),
      ["1", "3"],
    );
    for (const h of result) {
      assert.equal(canonicalSourceType(h.source), "reddit");
    }
  });

  it("every other canonical source_type excludes all Reddit findings", () => {
    for (const { value } of SOURCE_TYPE_FILTERS) {
      if (!value || value === "reddit") continue;
      const result = filterHitsBySourceType(hits, value);
      assert.ok(
        result.every((h) => canonicalSourceType(h.source) !== "reddit"),
        `filtering by "${value}" must not include any Reddit finding`,
      );
    }
  });

  it("All Sources ('') returns every finding unfiltered", () => {
    assert.equal(filterHitsBySourceType(hits, "").length, hits.length);
  });

  it("an unmatched source_type returns an empty list rather than falling back to all results", () => {
    const onlyWeb = [{ id: "1", source: "Web" }];
    assert.deepEqual(filterHitsBySourceType(onlyWeb, "reddit"), []);
  });
});

/**
 * Regression test for the incident where /scan?source=instagram displayed
 * 39/39 unfiltered results (News/YouTube included) on production: the
 * Findings Feed section of _app.scan.tsx was never wired to any source
 * filter at all (a separate bug from the DB-backed PersistedResults section,
 * which already used this exact function). Both sections now delegate to
 * filterHitsBySourceType — this locks in the exact reported scenario.
 */
describe("regression: /scan?source=instagram must never fall back to all results", () => {
  const mixedRows = [
    { id: "1", source: "News" },
    { id: "2", source: "YouTube" },
    { id: "3", source: "Instagram" },
  ];

  it("requesting source=instagram returns ONLY the Instagram row, count=1", () => {
    const result = filterHitsBySourceType(mixedRows, "instagram");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "3");
    assert.equal(canonicalSourceType(result[0].source), "instagram");
  });

  it("requesting source=youtube returns ONLY the YouTube row, count=1", () => {
    const result = filterHitsBySourceType(mixedRows, "youtube");
    assert.deepEqual(result.map((h) => h.id), ["2"]);
  });

  it("requesting source=news returns ONLY the News row, count=1", () => {
    const result = filterHitsBySourceType(mixedRows, "news");
    assert.deepEqual(result.map((h) => h.id), ["1"]);
  });

  it("requesting Instagram when there are zero Instagram rows returns [] / count=0 — never all rows", () => {
    const noInstagramRows = [
      { id: "1", source: "News" },
      { id: "2", source: "YouTube" },
    ];
    const result = filterHitsBySourceType(noInstagramRows, "instagram");
    assert.deepEqual(result, []);
    assert.equal(result.length, 0);
    assert.notEqual(result.length, noInstagramRows.length, "must not silently fall back to all rows");
  });
});
