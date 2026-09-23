import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  contentFingerprint,
  contentItemKey,
  dedupeKey,
  groupObservations,
} from "./fingerprint";

describe("canonicalizeUrl", () => {
  it("strips tracking parameters, www, hash and trailing slash", () => {
    expect(canonicalizeUrl("http://WWW.Example.com/Story/?utm_source=x&id=7#top")).toBe(
      "https://example.com/Story?id=7",
    );
  });

  it("collapses every YouTube watch form to one canonical URL", () => {
    const expected = "https://youtube.com/watch?v=AbC123";
    expect(canonicalizeUrl("https://youtu.be/AbC123")).toBe(expected);
    expect(canonicalizeUrl("https://www.youtube.com/watch?v=AbC123&t=30s")).toBe(expected);
    expect(canonicalizeUrl("https://m.youtube.com/shorts/AbC123")).toBe(expected);
  });
});

describe("dedupe", () => {
  it("gives the same key to the same item found by different providers", () => {
    const a = dedupeKey({ url: "https://news.example/a?utm_medium=brave", title: "Headline" });
    const b = dedupeKey({ url: "http://www.news.example/a/", title: "Headline" });
    expect(a).toEqual(b);
  });

  it("counts one underlying item once even with four provider observations", () => {
    const hits = [
      { url: "https://news.example/a", title: "Headline", provider: "brave" },
      { url: "https://www.news.example/a?utm_source=g", title: "Headline", provider: "google" },
      { url: "http://news.example/a/", title: "Headline", provider: "firecrawl" },
      { url: "https://news.example/a#lead", title: "Headline", provider: "gemini" },
    ];
    const groups = groupObservations(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.observations).toHaveLength(4);
  });

  it("keeps genuinely different items apart", () => {
    const groups = groupObservations([
      { url: "https://news.example/a", title: "One" },
      { url: "https://news.example/b", title: "Two" },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("returns an empty fingerprint when nothing was retrieved", () => {
    expect(contentFingerprint({})).toBe("");
  });

  it("counts one page once even when providers describe it with different titles", () => {
    const groups = groupObservations([
      { url: "https://news.example/a", title: "Headline — News Example", provider: "google" },
      { url: "https://www.news.example/a?utm_source=brave", title: "Headline", provider: "brave" },
      {
        url: "http://news.example/a/",
        title: "News Example: Headline story",
        provider: "firecrawl",
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.observations).toHaveLength(3);
  });

  it("collapses identical retrieved content at different URLs in primary totals", () => {
    const fp = contentFingerprint({
      title: "Same story",
      text: "Identical body text of the article",
    });
    const a = contentItemKey({ canonical_url: "https://a.example/x", content_fingerprint: fp });
    const b = contentItemKey({
      canonical_url: "https://mirror.example/y",
      content_fingerprint: fp,
    });
    const c = contentItemKey({ canonical_url: "https://c.example/z", content_fingerprint: "" });
    expect(a).toBe(b);
    expect(c).toBe("url:https://c.example/z");
  });
});
