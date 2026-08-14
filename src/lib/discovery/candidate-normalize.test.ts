import { describe, expect, it } from "vitest";
import {
  candidateIdentityKey,
  canonicalizePageUrl,
  dedupeNormalizedCandidates,
  normalizeCandidateBatch,
  normalizeProviderCandidate,
} from "./candidate-normalize";

describe("canonicalizePageUrl", () => {
  it("strips tracking params, hash, www and trailing slash", () => {
    expect(
      canonicalizePageUrl("https://WWW.Example.com/watch/123/?utm_source=x&igshid=y#frag"),
    ).toBe("https://example.com/watch/123");
  });

  it("keeps meaningful params in a stable order", () => {
    expect(canonicalizePageUrl("https://ex.com/p?b=2&a=1")).toBe(
      canonicalizePageUrl("https://ex.com/p?a=1&b=2"),
    );
    expect(canonicalizePageUrl("https://ex.com/p?a=1&b=2")).toBe("https://ex.com/p?a=1&b=2");
  });

  it("is idempotent", () => {
    const once = canonicalizePageUrl("https://www.ex.com/a//b/?utm_medium=q")!;
    expect(canonicalizePageUrl(once)).toBe(once);
  });

  it("rejects unusable and non-http URLs", () => {
    expect(canonicalizePageUrl("")).toBeNull();
    expect(canonicalizePageUrl("not a url")).toBeNull();
    expect(canonicalizePageUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("normalizeProviderCandidate", () => {
  it("keeps an actionable page URL and records the media URL as evidence", () => {
    const result = normalizeProviderCandidate({
      pageUrl: "https://example.com/post/1",
      imageUrl: "https://cdn.example.com/a.jpg",
      title: " Leak ",
      provider: "serpapi_google_lens",
      matchType: "exact",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.canonicalPageUrl).toBe("https://example.com/post/1");
    expect(result.candidate.mediaUrl).toBe("https://cdn.example.com/a.jpg");
    expect(result.candidate.pageTitle).toBe("Leak");
    expect(result.candidate.host).toBe("example.com");
  });

  it("drops leads with no page URL", () => {
    const result = normalizeProviderCandidate({ pageUrl: null, provider: "bing_visual_search" });
    expect(result).toEqual({ ok: false, reason: "missing_page_url" });
  });

  it("drops search-result surfaces — they are never removal targets", () => {
    const result = normalizeProviderCandidate({
      pageUrl: "https://www.google.com/search?q=leak",
      provider: "serpapi_google_lens",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("search_surface");
  });
});

describe("dedupeNormalizedCandidates", () => {
  it("collapses rotating media URLs onto one canonical page identity", () => {
    const { candidates } = normalizeCandidateBatch([
      {
        pageUrl: "https://example.com/post/1?utm_source=a",
        imageUrl: null,
        provider: "serpapi_google_lens",
        matchType: "visual",
      },
      {
        pageUrl: "https://www.example.com/post/1/",
        imageUrl: "https://cdn.example.com/rotated-2.jpg",
        provider: "bing_visual_search",
        matchType: "exact",
      },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].matchType).toBe("exact");
    expect(candidates[0].mediaUrl).toBe("https://cdn.example.com/rotated-2.jpg");
  });

  it("keeps distinct pages separate", () => {
    const deduped = dedupeNormalizedCandidates([
      {
        pageUrl: "https://a.com/1",
        canonicalPageUrl: "https://a.com/1",
        mediaUrl: null,
        host: "a.com",
        platform: null,
        pageTitle: null,
        provider: "p",
        matchType: "visual",
        hasExactPageUrl: true,
      },
      {
        pageUrl: "https://a.com/2",
        canonicalPageUrl: "https://a.com/2",
        mediaUrl: null,
        host: "a.com",
        platform: null,
        pageTitle: null,
        provider: "p",
        matchType: "visual",
        hasExactPageUrl: true,
      },
    ]);
    expect(deduped).toHaveLength(2);
  });
});

describe("candidateIdentityKey", () => {
  it("matches the database unique index tuple", () => {
    expect(candidateIdentityKey("u1", "a1", "https://x.com/p")).toBe("u1|a1|https://x.com/p");
  });
});
