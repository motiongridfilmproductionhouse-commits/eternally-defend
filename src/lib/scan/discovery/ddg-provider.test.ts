import test from "node:test";
import assert from "node:assert/strict";
import { parseDdgResults } from "./ddg-provider.server.ts";

const page = `
<div class="result">
  <a class="result__a" href="https://www.example.com/news/story">Edavela Babu &amp; news</a>
  <a class="result__snippet">Coverage about <b>Edavela Babu</b>.</a>
</div>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews18.com%2Ftopics%2Fedavela%2F&amp;rut=x">News18 topic</a>
  <a class="result__snippet">Latest updates.</a>
</div>
<div class="result">
  <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Sponsored</a>
</div>
<div class="result">
  <a class="result__a" href="https://www.example.com/news/story">Duplicate</a>
</div>
`;

test("parses public result links, titles and snippets", () => {
  const hits = parseDdgResults(page, 50);
  assert.deepEqual(
    hits.map((h) => h.url),
    ["https://www.example.com/news/story", "https://news18.com/topics/edavela/"],
  );
  assert.equal(hits[0]!.title, "Edavela Babu & news");
  assert.match(hits[0]!.description ?? "", /Coverage about Edavela Babu/);
  assert.equal(hits[0]!.provider, "ddg_html");
});

test("honours the result limit and drops search-engine self links", () => {
  assert.equal(parseDdgResults(page, 1).length, 1);
  assert.equal(
    parseDdgResults(page, 50).some((h) => h.url.includes("duckduckgo.com")),
    false,
  );
});

test("returns nothing for unusable markup instead of throwing", () => {
  assert.deepEqual(parseDdgResults("<html><body>no results</body></html>", 50), []);
  assert.deepEqual(parseDdgResults("", 50), []);
});
