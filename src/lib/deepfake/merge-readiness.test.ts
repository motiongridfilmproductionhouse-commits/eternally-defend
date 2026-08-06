import assert from "node:assert/strict";
import test from "node:test";
import {
  filterClientDiscoveries,
  filterClientFindings,
  isClientVisibleDiscovery,
  isClientVisibleFinding,
  isInternalOnlyClassification,
  isRejectedUrlStatus,
} from "./client-results.server";
import { isGenericTokenOnlyMention, matchesSelectedIdentity } from "./identity.server";
import { filterDeepfakeCandidates } from "./filter.server";
import {
  evaluateUrlVerification,
  isUrlVerified,
  normalizeCanonicalUrl,
} from "./url-verification.server";
import {
  classifyPageEvidence,
  isClientVisibleClassification,
  shouldPersistFinding,
} from "./page-evidence.server";

const honeyRose = {
  name: "Honey Rose",
  aliases: ["Honey"],
  handles: ["@honey"],
};

const longPrimary = (text: string) =>
  `${text} ${"Exact crawled content body with enough text for verification of the hosted media page. ".repeat(2)}`;

test("Latest Public Leads never returns another actress when Honey Rose is selected", () => {
  const scanId = "11111111-1111-1111-1111-111111111111";

  const discoveries = filterClientDiscoveries(
    [
      {
        scan_id: scanId,
        page_url: "https://abuse.example/watch/honey-rose-deepfake-1",
        page_title: "Honey Rose deepfake face swap",
        snippet: "Exact page for Honey Rose",
        analysis_status: "url_verified",
      },
      {
        scan_id: scanId,
        page_url: "https://abuse.example/watch/anu-sithara-deepfake-2",
        page_title: "Anu Sithara deepfake face swap",
        snippet: "Exact page for Anu Sithara",
        analysis_status: "url_verified",
      },
      {
        scan_id: "22222222-2222-2222-2222-222222222222",
        page_url: "https://abuse.example/watch/other-scan",
        page_title: "Honey Rose deepfake",
        snippet: "Wrong scan",
        analysis_status: "url_verified",
      },
    ],
    honeyRose,
    scanId,
  );

  assert.equal(discoveries.length, 1);
  assert.match(discoveries[0]?.page_title ?? "", /Honey Rose/i);
  assert.doesNotMatch(discoveries[0]?.page_title ?? "", /Anu Sithara/i);
});

test("generic meanings of honey or rose are rejected", () => {
  assert.equal(matchesSelectedIdentity("wild honey recipe with rose syrup", honeyRose), false);
  assert.equal(isGenericTokenOnlyMention("wild honey recipe with rose syrup", honeyRose), true);
  assert.equal(matchesSelectedIdentity("Honey Rose deepfake face swap", honeyRose), true);

  /*
   * Generic single-token aliases like "Honey" / "@honey" are not usable
   * identity phrases and must not accept off-target pages.
   */
  const filtered = filterDeepfakeCandidates(
    [
      {
        url: "https://food.example/posts/honey-glaze",
        title: "Best honey glaze",
        description: "Cooking with honey and rose water",
        query: '"Honey Rose" nude',
      },
    ],
    honeyRose,
  );

  assert.equal(filtered.accepted.length, 0);
  assert.ok(filtered.rejected.length >= 1);

  const urlCheck = evaluateUrlVerification({
    discovered_url: "https://food.example/posts/honey-glaze",
    final_url: "https://food.example/posts/honey-glaze",
    http_status: 200,
    crawled_title: "Best honey glaze",
    crawled_description: "Cooking tips",
    crawled_page_text: longPrimary(
      "This article explains honey glaze and rose water desserts. No actress identity.",
    ),
    page_inspected: true,
    search_title: "Honey Rose nude",
    search_snippet: "Honey Rose deepfake",
    target: honeyRose,
  });

  assert.equal(urlCheck.url_verification_status, "URL_REJECTED");
});

test("search, tag, category, listing and performer-index pages are rejected", () => {
  const cases = [
    "https://tube.example/search?q=Honey+Rose",
    "https://tube.example/tags/honey-rose",
    "https://tube.example/category/celebrities",
    "https://tube.example/browse/newest",
    "https://tube.example/pornstar/honey-rose",
  ];

  for (const url of cases) {
    const result = evaluateUrlVerification({
      discovered_url: url,
      final_url: url,
      http_status: 200,
      crawled_title: "Honey Rose results",
      crawled_page_text: longPrimary("Honey Rose listing page content."),
      page_inspected: true,
      target: honeyRose,
    });

    assert.equal(result.url_verification_status, "URL_REJECTED", `expected reject for ${url}`);
  }

  const prefilter = filterDeepfakeCandidates(
    [
      {
        url: "https://tube.example/search?q=Honey+Rose+deepfake",
        title: "Honey Rose deepfake - Search results",
        description: "Honey Rose AI nude",
        query: '"Honey Rose" deepfake',
      },
    ],
    honeyRose,
  );

  assert.equal(prefilter.accepted.length, 0);
  assert.ok(
    prefilter.rejected.some((item) => /listing page excluded/i.test(item.rejection_reason ?? "")),
  );
});

test("raw Firecrawl results cannot reach the UI", () => {
  const scanId = "11111111-1111-1111-1111-111111111111";

  const discoveries = filterClientDiscoveries(
    [
      {
        scan_id: scanId,
        page_url: "https://raw.example/search-hit",
        page_title: "Honey Rose deepfake",
        snippet: "Raw Firecrawl snippet",
        analysis_status: "discovered",
      },
      {
        scan_id: scanId,
        page_url: "https://abuse.example/watch/honey-rose-deepfake",
        page_title: "Honey Rose deepfake face swap",
        snippet: "Verified crawl",
        analysis_status: "url_verified",
      },
    ],
    honeyRose,
    scanId,
  );

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0]?.analysis_status, "url_verified");
  assert.equal(
    isClientVisibleDiscovery(
      {
        page_url: "https://raw.example/hit",
        page_title: "Honey Rose",
        analysis_status: "discovered",
      },
      honeyRose,
      scanId,
    ),
    false,
  );
});

test("results are scoped by scan_id and selected target identity", () => {
  const scanA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const scanB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  const findings = filterClientFindings(
    [
      {
        scan_id: scanA,
        url: "https://abuse.example/a",
        final_url: "https://abuse.example/a",
        page_title: "Honey Rose deepfake",
        snippet: "Honey Rose content",
        finding_classification: "PROBABLE_DEEPFAKE",
        url_verification_status: "URL_VERIFIED",
      },
      {
        scan_id: scanB,
        url: "https://abuse.example/b",
        final_url: "https://abuse.example/b",
        page_title: "Honey Rose deepfake",
        snippet: "Honey Rose content",
        finding_classification: "PROBABLE_DEEPFAKE",
        url_verification_status: "URL_VERIFIED",
      },
    ],
    honeyRose,
    scanA,
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.scan_id, scanA);
});

test("only URL_VERIFIED plus VERIFIED_DEEPFAKE or PROBABLE_DEEPFAKE are client-visible", () => {
  const scanId = "11111111-1111-1111-1111-111111111111";

  const rows = [
    {
      scan_id: scanId,
      url: "https://abuse.example/verified",
      final_url: "https://abuse.example/verified",
      page_title: "Honey Rose deepfake",
      snippet: "Honey Rose",
      finding_classification: "VERIFIED_DEEPFAKE",
      url_verification_status: "URL_VERIFIED",
    },
    {
      scan_id: scanId,
      url: "https://abuse.example/probable",
      final_url: "https://abuse.example/probable",
      page_title: "Honey Rose AI nude deepfake",
      snippet: "Honey Rose",
      finding_classification: "PROBABLE_DEEPFAKE",
      url_verification_status: "URL_VERIFIED",
    },
    {
      scan_id: scanId,
      url: "https://abuse.example/unverified",
      final_url: "https://abuse.example/unverified",
      page_title: "Honey Rose rumour",
      snippet: "Honey Rose",
      finding_classification: "UNVERIFIED_LEAD",
      url_verification_status: "URL_VERIFIED",
    },
    {
      scan_id: scanId,
      url: "https://abuse.example/rejected-url",
      final_url: "https://abuse.example/rejected-url",
      page_title: "Honey Rose deepfake",
      snippet: "Honey Rose",
      finding_classification: "PROBABLE_DEEPFAKE",
      url_verification_status: "URL_REJECTED",
    },
  ];

  const visible = filterClientFindings(rows, honeyRose, scanId);
  assert.deepEqual(visible.map((item) => item.finding_classification).sort(), [
    "PROBABLE_DEEPFAKE",
    "VERIFIED_DEEPFAKE",
  ]);

  for (const item of visible) {
    assert.ok(item.final_url);
    assert.match(item.final_url, /^https?:\/\//);
    if (item.canonical_url) {
      assert.match(item.canonical_url, /^https?:\/\//);
    }
  }

  assert.equal(isClientVisibleClassification("UNVERIFIED_LEAD"), false);
  assert.equal(isUrlVerified("URL_REJECTED"), false);
  assert.equal(isClientVisibleFinding(rows[2]!, honeyRose, scanId), false);
});

test("client findings expose validated final_url and canonical_url for opening", () => {
  const scanId = "22222222-2222-2222-2222-222222222222";
  const [row] = filterClientFindings(
    [
      {
        scan_id: scanId,
        url: "https://discovered.example/redirect",
        final_url: "https://abuse.example/honey-rose-final",
        canonical_url: "https://abuse.example/honey-rose-final",
        page_title: "Honey Rose deepfake",
        snippet: "Honey Rose",
        finding_classification: "PROBABLE_DEEPFAKE",
        url_verification_status: "URL_VERIFIED",
      },
    ],
    honeyRose,
    scanId,
  );

  assert.ok(row);
  assert.equal(row.final_url, "https://abuse.example/honey-rose-final");
  assert.equal(row.canonical_url, "https://abuse.example/honey-rose-final");
  assert.equal(row.url, "https://abuse.example/honey-rose-final");
});

test("redirects resolve to final URL for opening", () => {
  const discovered = "https://tracker.example/r/honey";
  const finalUrl = "https://abuse.example/watch/honey-rose-deepfake-face-swap-77";

  const result = evaluateUrlVerification({
    discovered_url: discovered,
    final_url: finalUrl,
    http_status: 200,
    redirect_chain: [discovered, finalUrl],
    crawled_title: "Honey Rose deepfake face swap",
    crawled_description: "Honey Rose exact page",
    crawled_page_text: longPrimary(
      "Honey Rose deepfake face swap video on this exact content page.",
    ),
    page_inspected: true,
    target: honeyRose,
  });

  assert.equal(result.url_verification_status, "URL_VERIFIED");
  assert.equal(result.final_url, finalUrl);
  assert.equal(result.canonical_url, normalizeCanonicalUrl(finalUrl));
  assert.notEqual(result.final_url, result.discovered_url);

  const findings = filterClientFindings(
    [
      {
        scan_id: "11111111-1111-1111-1111-111111111111",
        url: discovered,
        final_url: finalUrl,
        page_title: "Honey Rose deepfake face swap",
        snippet: "Honey Rose exact page",
        finding_classification: "PROBABLE_DEEPFAKE",
        url_verification_status: "URL_VERIFIED",
      },
    ],
    honeyRose,
    "11111111-1111-1111-1111-111111111111",
  );

  assert.equal(findings[0]?.url, finalUrl);
});

test("broken, homepage, unrelated-final-page and snippet-only URLs fail closed", () => {
  const broken = evaluateUrlVerification({
    discovered_url: "https://broken.example/honey-rose",
    final_url: "https://broken.example/honey-rose",
    http_status: 500,
    page_inspected: false,
    target: honeyRose,
  });
  assert.equal(broken.url_verification_status, "URL_REJECTED");

  const homepage = evaluateUrlVerification({
    discovered_url: "https://adult.example/",
    final_url: "https://adult.example/",
    http_status: 200,
    crawled_title: "Home",
    crawled_page_text: longPrimary("Honey Rose homepage banner."),
    page_inspected: true,
    target: honeyRose,
  });
  assert.equal(homepage.url_verification_status, "URL_REJECTED");

  const unrelated = evaluateUrlVerification({
    discovered_url: "https://tube.example/watch/other-actress",
    final_url: "https://tube.example/watch/other-actress",
    http_status: 200,
    crawled_title: "Anu Sithara studio feature",
    crawled_description: "Different actress",
    crawled_page_text: longPrimary(
      "Anu Sithara stars in this feature. The protected target is not named anywhere in the primary article body.",
    ),
    page_inspected: true,
    search_title: "Honey Rose deepfake",
    search_snippet: "Honey Rose AI nude",
    target: honeyRose,
  });
  assert.equal(unrelated.url_verification_status, "URL_REJECTED");

  const snippetOnly = evaluateUrlVerification({
    discovered_url: "https://abuse.example/watch/blocked",
    final_url: "https://abuse.example/watch/blocked",
    http_status: 200,
    crawled_title: null,
    crawled_page_text: "",
    page_inspected: false,
    search_title: "Honey Rose deepfake face swap",
    search_snippet: "Honey Rose AI nude",
    target: honeyRose,
  });
  assert.equal(snippetOnly.url_verification_status, "URL_REJECTED");

  const pageEvidence = classifyPageEvidence({
    url: "https://abuse.example/watch/blocked",
    title: "Honey Rose deepfake",
    description: "Honey Rose AI nude",
    page_text: "",
    page_inspected: false,
    target: honeyRose,
  });
  assert.equal(pageEvidence.finding_classification, "UNVERIFIED_LEAD");
  assert.equal(pageEvidence.client_visible, false);
});

test("UNVERIFIED_LEAD and URL_REJECTED cannot leak through public leads or API filters", () => {
  const scanId = "11111111-1111-1111-1111-111111111111";

  assert.equal(isInternalOnlyClassification("UNVERIFIED_LEAD"), true);
  assert.equal(isRejectedUrlStatus("URL_REJECTED"), true);
  assert.equal(shouldPersistFinding("ADULT_NAME_MENTION"), false);

  const findings = filterClientFindings(
    [
      {
        scan_id: scanId,
        url: "https://abuse.example/u",
        final_url: "https://abuse.example/u",
        page_title: "Honey Rose lead",
        snippet: "Honey Rose",
        finding_classification: "UNVERIFIED_LEAD",
        url_verification_status: "URL_VERIFIED",
      },
      {
        scan_id: scanId,
        url: "https://abuse.example/r",
        final_url: "https://abuse.example/r",
        page_title: "Honey Rose deepfake",
        snippet: "Honey Rose",
        finding_classification: "PROBABLE_DEEPFAKE",
        url_verification_status: "URL_REJECTED",
      },
    ],
    honeyRose,
    scanId,
  );

  assert.equal(findings.length, 0);

  const discoveries = filterClientDiscoveries(
    [
      {
        scan_id: scanId,
        page_url: "https://raw.example/x",
        page_title: "Honey Rose deepfake",
        analysis_status: "discovered",
      },
      {
        scan_id: scanId,
        page_url: "https://abuse.example/ok",
        page_title: "Honey Rose deepfake face swap",
        snippet: "Honey Rose exact page",
        analysis_status: "url_verified",
      },
    ],
    honeyRose,
    scanId,
  );

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0]?.analysis_status, "url_verified");
});
