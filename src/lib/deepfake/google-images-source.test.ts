import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractGoogleImagesMetaFromHtml,
  isGoogleImagesViewerUrl,
  isSameDomainGalleryLink,
  isUsableSourceWebsiteUrl,
  resolveGoogleImagesSourceWebsite,
} from "./google-images-source.server";
import { buildGoogleImagesInvestigationQueries } from "./google-images-queries.server";
import {
  emptyGoogleImagesDiagnostics,
  formatGoogleImagesDiagnosticLines,
  parseGoogleImagesDiagnostics,
} from "./google-images-diagnostics";
import { expandIdentityVariants } from "./identity-variants.server";
import { findingRowFromGoogleImagesCandidate } from "./google-images-investigation.server";
import {
  buildGoogleImagesEvidencePackage,
  perceptualHashOfBytes,
  sha256OfBytes,
} from "./google-images-evidence.server";

const VIEWER_EXAMPLES = [
  "https://www.google.com/search?tbnid=_frhBoSjm04CEM&tbnh=0&tbnw=0&cs=0&hl=en-US&udm=2&tbs=rimg:Cf364QaEo5tOYVjJbGx18uyx4AIA&q=sarayu+mohan+nude&sa=X&biw=440&bih=874&dpr=3",
  "https://www.google.com/search?tbnid=_frhBoSjm04CEM&udm=2&tbs=rimg:Cf364QaEo5tOYVjJbGx18uyx4AIA&q=sarayu+mohan+nude#sv=CAMSZBoyKhBlLWJWcENFTUdYcFU5S2tNMg5iVnBDRU1HWHBVOUtrTToOelVPbEY2WGo1QlVvb00gBCokCg5zZ0swX1pkR1dKWElMTRIQZS1iVnBDRU1HWHBVOUtrTRgAMAFKBAgBEAIYByCOycHdCUoIEAIYASACKAE",
  "https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fa.jpg&imgrefurl=https%3A%2F%2Fnews.example.com%2Fstory",
  "https://www.google.com/search?q=sarayu&tbm=isch",
];

test("resolveGoogleImagesSourceWebsite prefers imgrefurl over imgurl", () => {
  const source = resolveGoogleImagesSourceWebsite({
    href: "https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fa.jpg&imgrefurl=https%3A%2F%2Fnews.example.com%2Fstory",
    imgurl: "https://cdn.example.com/a.jpg",
    imgrefurl: "https://news.example.com/story",
  });
  assert.equal(source, "https://news.example.com/story");
});

test("isGoogleImagesViewerUrl rejects tbnid / udm=2 / #sv= viewer pages", () => {
  for (const url of VIEWER_EXAMPLES) {
    assert.equal(isGoogleImagesViewerUrl(url), true, url);
    assert.equal(isUsableSourceWebsiteUrl(url), false, url);
  }
  assert.equal(
    isUsableSourceWebsiteUrl("https://news.example.com/gallery/sarayu"),
    true,
  );
});

test("resolveGoogleImagesSourceWebsite never returns Google viewer URLs", () => {
  // Viewer URLs alone are never returned as the source page.
  for (const url of VIEWER_EXAMPLES) {
    assert.equal(
      resolveGoogleImagesSourceWebsite({
        explicitSource: url,
        imgrefurl: url,
      }),
      null,
      url,
    );
  }

  // But a viewer href that embeds imgrefurl must yield the original webpage.
  assert.equal(
    resolveGoogleImagesSourceWebsite({
      href: "https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fa.jpg&imgrefurl=https%3A%2F%2Fnews.example.com%2Fstory",
    }),
    "https://news.example.com/story",
  );
});

test("extractGoogleImagesMetaFromHtml reads ou/ru pairs and href imgrefurl", () => {
  const html = `
    {"ou":"https://cdn.example.com/x.jpg","ru":"https://site.example.com/post"}
    <a href="/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fy.jpg&amp;imgrefurl=https%3A%2F%2Fblog.example.com%2Fitem">x</a>
  `;
  const rows = extractGoogleImagesMetaFromHtml(html);
  assert.ok(rows.some((r) => r.image_url.includes("cdn.example.com")));
  assert.ok(
    rows.some((r) => r.source_website_url === "https://site.example.com/post"),
  );
  assert.ok(
    rows.some((r) => r.source_website_url === "https://blog.example.com/item"),
  );
  assert.ok(rows.every((r) => !isGoogleImagesViewerUrl(r.source_website_url)));
});

test("isSameDomainGalleryLink detects gallery/media paths", () => {
  assert.equal(
    isSameDomainGalleryLink(
      "https://news.example.com/gallery/sarayu",
      "https://news.example.com/story",
    ),
    true,
  );
  assert.equal(
    isSameDomainGalleryLink(
      "https://other.example.com/gallery/sarayu",
      "https://news.example.com/story",
    ),
    false,
  );
  assert.equal(
    isSameDomainGalleryLink(VIEWER_EXAMPLES[0]!, "https://news.example.com/story"),
    false,
  );
});

test("evidence package never stores Google viewer as source_website_url", () => {
  const pkg = buildGoogleImagesEvidencePackage({
    query: "sarayu mohan nude",
    googleResultUrl: VIEWER_EXAMPLES[0]!,
    sourceWebsiteUrl: VIEWER_EXAMPLES[0]!,
    imageUrl: "https://cdn.example.com/a.jpg",
    faceSimilarity: 92,
    identityConfidence: 90,
    sha256: sha256OfBytes(new Uint8Array([1, 2, 3])),
    perceptualHash: perceptualHashOfBytes(new Uint8Array([1, 2, 3])),
  });
  assert.equal(pkg.source_website_url, null);
  assert.equal(pkg.google_result_url, VIEWER_EXAMPLES[0]);
  assert.equal(pkg.crawl_metadata.google_viewer_rejected, true);

  const ok = buildGoogleImagesEvidencePackage({
    query: "sarayu mohan nude",
    googleResultUrl: VIEWER_EXAMPLES[0]!,
    sourceWebsiteUrl: "https://leak.example.com/album/1",
    imageUrl: "https://cdn.example.com/a.jpg",
    faceSimilarity: 92,
    identityConfidence: 90,
    sha256: "abc",
  });
  assert.equal(ok.source_website_url, "https://leak.example.com/album/1");
  assert.equal(ok.evidence_status, "captured");
});

test("buildGoogleImagesInvestigationQueries covers Sarayu Mohan variants", () => {
  const queries = buildGoogleImagesInvestigationQueries({
    name: "Sarayu Mohan",
    aliases: ["Sarayu"],
  });
  const joined = queries.join("\n").toLowerCase();
  assert.match(joined, /sarayu mohan/);
  assert.match(joined, /deepfake/);
  assert.ok(queries.some((q) => /[\u0D00-\u0D7F]/.test(q)));
  assert.ok(queries.length >= 12);
});

test("expandIdentityVariants includes initials and native script for Sarayu Mohan", () => {
  const variants = expandIdentityVariants({ name: "Sarayu Mohan" });
  assert.ok(variants.some((v) => /[\u0D00-\u0D7F]/.test(v)));
  assert.ok(variants.some((v) => /^SM\b/i.test(v) || v.includes("SM")));
});

test("google images diagnostics include viewer/source/gallery funnel counters", () => {
  const parsed = parseGoogleImagesDiagnostics({
    google_images_diagnostic: {
      queries_executed: 12,
      images_discovered: 240,
      viewer_urls_discovered: 40,
      original_source_pages_extracted: 28,
      source_pages_crawled: 8,
      images_extracted_from_sources: 64,
      gallery_pages_followed: 5,
      source_pages_discovered: 28,
      candidate_pages_crawled: 8,
      images_downloaded: 180,
      face_comparisons: 90,
      high_confidence_matches: 6,
      evidence_packages_created: 6,
      provider_status: "success",
      used_browser: true,
      playwright_fallback_used: true,
    },
  });
  assert.equal(parsed.viewer_urls_discovered, 40);
  assert.equal(parsed.original_source_pages_extracted, 28);
  assert.equal(parsed.gallery_pages_followed, 5);
  const lines = formatGoogleImagesDiagnosticLines(parsed);
  assert.ok(lines.some((line) => /Viewer URLs Discovered: 40/.test(line)));
  assert.ok(lines.some((line) => /Original Source Pages Extracted: 28/.test(line)));
  assert.ok(lines.some((line) => /Gallery Pages Followed: 5/.test(line)));
  assert.ok(lines.some((line) => /Faces Compared: 90/.test(line)));
  assert.ok(lines.some((line) => /Playwright\/CDP Fallback: used/.test(line)));
  assert.equal(emptyGoogleImagesDiagnostics().viewer_urls_discovered, 0);
});

test("findingRowFromGoogleImagesCandidate rejects Google viewer evidence URLs", () => {
  for (const url of VIEWER_EXAMPLES) {
    const rejected = findingRowFromGoogleImagesCandidate({
      scanId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      candidate: {
        url,
        query: "Sarayu Mohan deepfake",
        source: "google_images_investigation",
        url_verification_status: "URL_VERIFIED",
        finding_classification: "PROBABLE_DEEPFAKE",
        face_similarity: 92,
      },
    });
    assert.equal(rejected, null, url);
  }

  const accepted = findingRowFromGoogleImagesCandidate({
    scanId: "11111111-1111-1111-1111-111111111111",
    userId: "22222222-2222-2222-2222-222222222222",
    candidate: {
      url: "https://news.example.com/story",
      query: "Sarayu Mohan deepfake",
      source: "google_images_investigation",
      url_verification_status: "URL_VERIFIED",
      finding_classification: "VERIFIED_DEEPFAKE",
      face_similarity: 94,
      title: "Example",
    },
  });
  assert.ok(accepted);
  assert.equal(accepted?.finding_classification, "VERIFIED_DEEPFAKE");
  assert.equal(accepted?.url_verification_status, "URL_VERIFIED");
  assert.equal(accepted?.url, "https://news.example.com/story");
});

test("investigation source crawl recursively follows galleries", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/deepfake/google-images-investigation.server.ts"),
    "utf8",
  );
  assert.match(src, /GOOGLE_IMAGES_GALLERY_PAGE_LIMIT/);
  assert.match(src, /extractGalleryLinks/);
  assert.match(src, /isSameDomainGalleryLink/);
  assert.match(src, /googleResultUrl: input\.googleResultUrl/);
  assert.match(src, /isGoogleImagesViewerUrl/);
  assert.match(src, /data-lazy-src|srcset/);
  assert.doesNotMatch(src, /google_result_url: input\.pageUrl/);
});
