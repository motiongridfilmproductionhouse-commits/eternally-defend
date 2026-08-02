import assert from "node:assert/strict";
import test from "node:test";
import { needsRenderedFallback } from "./page-retrieve.server";
import {
  detectChallengeOrShellPage,
  enrichLinksFromHtml,
  isLikelyListingPage,
} from "./page-extract.server";

test("empty static HTML triggers rendered fallback need", () => {
  assert.equal(needsRenderedFallback("", ""), true);
  assert.equal(needsRenderedFallback("<html></html>", ""), true);
});

test("javascript challenge page triggers rendered fallback need", () => {
  const html = "<html><body>Please enable JavaScript to view this page.</body></html>";
  assert.equal(detectChallengeOrShellPage(html, "Please enable JavaScript"), true);
  assert.equal(needsRenderedFallback(html, "Please enable JavaScript"), true);
});

test("cloudflare checking-your-browser shell triggers fallback", () => {
  const html =
    "<html><body>Checking your browser before accessing example.com. Just a moment...</body></html>";
  assert.equal(detectChallengeOrShellPage(html, "Checking your browser"), true);
  assert.equal(needsRenderedFallback(html, "Checking your browser"), true);
});

test("browser-rendered page recovers iframe and download links from HTML", () => {
  const html = `
    <html>
      <body>
        <h1>Neon Horizon Full Movie</h1>
        <iframe src="https://streamhost.example/embed/neon"></iframe>
        <video src="https://cdn.example/neon.m3u8"></video>
        <a href="https://mega.nz/file/abc123">Download Neon Horizon</a>
        <button data-src="https://mirror.example/watch">Watch now</button>
      </body>
    </html>
  `;
  const links = enrichLinksFromHtml(html, "https://piracylib.test/neon-horizon");
  assert.ok(links.some((l) => l.includes("streamhost.example")));
  assert.ok(links.some((l) => l.includes("mega.nz")));
  assert.ok(links.some((l) => l.includes(".m3u8")));
});

test("listing page heuristic detects category/search grids", () => {
  assert.equal(
    isLikelyListingPage({
      url: "https://movies.test/category/latest",
      linkCount: 6,
      html: "<html>Latest movies browse</html>",
      markdown: "Latest movies",
    }),
    true,
  );
  assert.equal(
    isLikelyListingPage({
      url: "https://movies.test/watch/neon-horizon",
      linkCount: 3,
      html: "<html>Watch Neon Horizon full movie</html>",
      markdown: "Watch full movie",
    }),
    false,
  );
});
