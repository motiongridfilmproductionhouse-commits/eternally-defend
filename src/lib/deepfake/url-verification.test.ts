import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateUrlVerification,
  extractPrimaryContent,
  identityInPrimaryContent,
  isHomepageUrl,
  isRedirectOnlyResult,
  isUrlVerified,
  normalizeCanonicalUrl,
} from "./url-verification.server";

const actress = {
  name: "Maya Kapoor",
  aliases: ["Maya K"],
  handles: [],
};

const longPrimary = (text: string) =>
  `${text} ${"This crawled article body contains enough primary content for exact-page verification requirements and describes the hosted media clearly. ".repeat(2)}`;

test("broken URLs are rejected", () => {
  const result = evaluateUrlVerification({
    discovered_url: "https://broken.example/maya-kapoor-deepfake",
    final_url: "https://broken.example/maya-kapoor-deepfake",
    http_status: 404,
    redirect_chain: ["https://broken.example/maya-kapoor-deepfake"],
    crawled_title: null,
    crawled_description: null,
    crawled_page_text: "",
    page_inspected: false,
    search_title: "Maya Kapoor deepfake",
    search_snippet: "Maya Kapoor AI nude",
    target: actress,
  });

  assert.equal(result.url_verification_status, "URL_REJECTED");
  assert.match(result.rejection_reason ?? "", /broken|unreachable|404/i);
  assert.equal(isUrlVerified(result.url_verification_status), false);
});

test("redirected URLs store final_url and can verify the destination content page", () => {
  const discovered = "https://tracker.example/out?u=maya";
  const finalUrl =
    "https://abuse.example/watch/maya-kapoor-deepfake-face-swap-99";

  const result = evaluateUrlVerification({
    discovered_url: discovered,
    final_url: finalUrl,
    http_status: 200,
    redirect_chain: [discovered, finalUrl],
    crawled_title: "Maya Kapoor deepfake face swap",
    crawled_description: "Exact content page for Maya Kapoor",
    crawled_page_text: longPrimary(
      "Maya Kapoor deepfake face swap video hosted on this content page with AI nude claims.",
    ),
    page_inspected: true,
    search_title: "Maya Kapoor deepfake",
    search_snippet: "redirected listing text",
    target: actress,
  });

  assert.equal(result.url_verification_status, "URL_VERIFIED");
  assert.equal(result.discovered_url, discovered);
  assert.equal(result.final_url, finalUrl);
  assert.equal(
    result.canonical_url,
    normalizeCanonicalUrl(finalUrl),
  );
  assert.deepEqual(result.redirect_chain, [discovered, finalUrl]);
  assert.equal(result.http_status, 200);
  assert.ok(result.crawled_at);
  assert.equal(result.page_title, "Maya Kapoor deepfake face swap");
  assert.equal(result.verified_domain, "abuse.example");
});

test("homepage URLs are rejected", () => {
  assert.equal(isHomepageUrl("https://adult.example/"), true);
  assert.equal(isHomepageUrl("https://adult.example/video/123"), false);

  const result = evaluateUrlVerification({
    discovered_url: "https://adult.example/",
    final_url: "https://adult.example/",
    http_status: 200,
    crawled_title: "Adult Tube Home",
    crawled_page_text: longPrimary("Welcome to the homepage featuring Maya Kapoor banners."),
    page_inspected: true,
    target: actress,
  });

  assert.equal(result.url_verification_status, "URL_REJECTED");
  assert.match(result.rejection_reason ?? "", /homepage/i);
});

test("redirect-only destinations that land on empty shells are rejected", () => {
  assert.equal(
    isRedirectOnlyResult({
      discovered_url: "https://tracker.example/r/1",
      final_url: "https://site.example/",
      http_status: 200,
      page_text: "",
      page_title: "",
    }),
    true,
  );

  const result = evaluateUrlVerification({
    discovered_url: "https://tracker.example/r/1",
    final_url: "https://site.example/",
    http_status: 200,
    redirect_chain: [
      "https://tracker.example/r/1",
      "https://site.example/",
    ],
    crawled_title: null,
    crawled_page_text: "",
    page_inspected: false,
    target: actress,
  });

  assert.equal(result.url_verification_status, "URL_REJECTED");
});

test("unrelated final pages are rejected even when the search snippet named the person", () => {
  const result = evaluateUrlVerification({
    discovered_url: "https://tube.example/watch/other-person-clip-8841",
    final_url: "https://tube.example/watch/other-person-clip-8841",
    http_status: 200,
    crawled_title: "Jordan Blake studio release",
    crawled_description: "A different adult celebrity feature",
    crawled_page_text: longPrimary(
      "Jordan Blake stars in this studio release. No protected actress identity appears in the primary article body.",
    ),
    page_inspected: true,
    search_title: "Maya Kapoor deepfake nude",
    search_snippet: "Maya Kapoor AI nude video",
    target: actress,
  });

  assert.equal(result.url_verification_status, "URL_REJECTED");
  assert.match(
    result.rejection_reason ?? "",
    /differs from the search snippet|do not match the selected identity/i,
  );
});

test("identity only in recommendations or comments is rejected", () => {
  const pageText = [
    "Main review of an unrelated celebrity photoshoot and fashion event coverage.",
    "More runway details and styling notes fill the primary article body here.",
    "Recommended for you:",
    "Maya Kapoor deepfake clip",
    "Maya Kapoor AI nude",
    "Comments:",
    "User123: Maya Kapoor looks fake here",
  ].join("\n");

  const identity = identityInPrimaryContent({
    title: "Unrelated celebrity photoshoot",
    description: "Fashion coverage",
    page_text: pageText,
    target: actress,
  });

  assert.equal(identity.onlyInChrome, true);
  assert.equal(identity.inPrimaryBody, false);

  const result = evaluateUrlVerification({
    discovered_url: "https://blog.example/unrelated-shoot",
    final_url: "https://blog.example/unrelated-shoot",
    http_status: 200,
    crawled_title: "Unrelated celebrity photoshoot",
    crawled_description: "Fashion coverage",
    crawled_page_text: pageText,
    page_inspected: true,
    search_title: "Maya Kapoor",
    search_snippet: "Maya Kapoor deepfake",
    target: actress,
  });

  assert.equal(result.url_verification_status, "URL_REJECTED");
  assert.match(
    result.rejection_reason ?? "",
    /recommendations|comments|navigation/i,
  );
});

test("duplicate canonical URLs normalize equivalently after redirects", () => {
  const a = normalizeCanonicalUrl(
    "https://www.Abuse.Example/watch/maya-kapoor-deepfake/?utm_source=x&fbclid=1",
  );
  const b = normalizeCanonicalUrl(
    "https://abuse.example/watch/maya-kapoor-deepfake",
  );

  assert.equal(a, b);
});

test("accurate content URLs are verified with crawled title and primary content", () => {
  const finalUrl =
    "https://abuse.example/watch/maya-kapoor-deepfake-ai-nude-55";

  const result = evaluateUrlVerification({
    discovered_url: finalUrl,
    final_url: finalUrl,
    http_status: 200,
    redirect_chain: [finalUrl],
    crawled_title: "Maya Kapoor deepfake AI nude",
    crawled_description: "Face swap content page",
    crawled_page_text: longPrimary(
      "This exact content page hosts a Maya Kapoor deepfake face swap and AI nude video.",
    ),
    page_inspected: true,
    search_title: "Ignored search title about someone else",
    search_snippet: "Ignored search snippet",
    target: actress,
  });

  assert.equal(result.url_verification_status, "URL_VERIFIED");
  assert.equal(result.rejection_reason, null);
  assert.equal(result.page_title, "Maya Kapoor deepfake AI nude");
  assert.ok(
    extractPrimaryContent(result.page_text).toLowerCase().includes("maya kapoor"),
  );
  assert.equal(result.verified_domain, "abuse.example");
});

test("search and listing final URLs are rejected", () => {
  const search = evaluateUrlVerification({
    discovered_url: "https://tube.example/search?q=Maya+Kapoor",
    final_url: "https://tube.example/search?q=Maya+Kapoor",
    http_status: 200,
    crawled_title: "Search results for Maya Kapoor",
    crawled_page_text: longPrimary("Search results listing Maya Kapoor videos."),
    page_inspected: true,
    target: actress,
  });

  assert.equal(search.url_verification_status, "URL_REJECTED");
  assert.match(search.rejection_reason ?? "", /search|listing/i);

  const tag = evaluateUrlVerification({
    discovered_url: "https://tube.example/tags/maya-kapoor",
    final_url: "https://tube.example/tags/maya-kapoor",
    http_status: 200,
    crawled_title: "Maya Kapoor tag",
    crawled_page_text: longPrimary("Tagged videos for Maya Kapoor."),
    page_inspected: true,
    target: actress,
  });

  assert.equal(tag.url_verification_status, "URL_REJECTED");
});
