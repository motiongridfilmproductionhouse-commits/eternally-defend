import assert from "node:assert/strict";
import test from "node:test";
import {
  expansionToIdentityList,
  invalidateIdentityExpansionCache,
  resolveAndExpandSearchQuery,
  resolveAndExpandSearchQuerySafe,
} from "./identity-search-expander.server";
import { scoreIdentityRelevance } from "./identity-relevance.server";
import { mergeSearchResultsByFingerprint } from "./identity-dedupe.server";
import { mergeAliasListsForTest } from "./identity-profile-test-helpers";

test("Manju Pauthrose → Manju Pathrose", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const result = await resolveAndExpandSearchQuery({
    query: "Manju Pauthrose",
    module: "reputation",
    offlineOnly: true,
  });
  assert.equal(result.canonicalName, "Manju Pathrose");
  assert.ok(result.aliases.some((a) => /pauthrose/i.test(a)) || /pauthrose/i.test(result.originalQuery));
  assert.ok(result.searchQueries.some((q) => /Manju Pathrose/i.test(q.query)));
  assert.ok(result.confidence >= 0.7);
});

test("Aliyans actress Manju → correct contextual identity", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const result = await resolveAndExpandSearchQuery({
    query: "Aliyans actress Manju",
    module: "reputation",
    offlineOnly: true,
  });
  assert.equal(result.canonicalName, "Manju Pathrose");
  assert.ok(result.relatedShows.some((s) => /aliyan/i.test(s)));
  assert.ok(result.diagnostics.extractedProfession === "actress");
  assert.ok(result.searchQueries.some((q) => /Aliyans/i.test(q.query) && /Manju/i.test(q.query)));
  assert.ok(result.confidence >= 0.7);
});

test("Aliyans Thankam → correct actress identity", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const result = await resolveAndExpandSearchQuery({
    query: "Aliyans Thankam",
    module: "general",
    offlineOnly: true,
  });
  assert.equal(result.canonicalName, "Manju Pathrose");
  assert.ok(result.characterNames.some((c) => /thankam/i.test(c)));
});

test("Local-language name → canonical identity", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const result = await resolveAndExpandSearchQuery({
    query: "മഞ്ജു പത്രോസ്",
    module: "reputation",
    offlineOnly: true,
  });
  assert.equal(result.canonicalName, "Manju Pathrose");
  assert.ok(result.localLanguageNames.some((n) => n.includes("മഞ്ജു")));
});

test("Misspelled celebrity name → corrected identity", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const result = await resolveAndExpandSearchQuery({
    query: "Manju Pauthrose",
    offlineOnly: true,
  });
  assert.equal(result.correctedQuery.includes("Pathrose") || result.canonicalName === "Manju Pathrose", true);
});

test("Common first name → ambiguity retained", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const result = await resolveAndExpandSearchQuery({
    query: "Manju",
    module: "reputation",
    offlineOnly: true,
  });
  assert.ok(result.ambiguous || result.confidence < 0.7 || result.ambiguityCandidates.length >= 2);
  // Must not auto-attach a single celebrity with high confidence from first name alone.
  if (result.canonicalName) {
    assert.ok(result.ambiguous || result.confidence < 0.7);
  }
});

test("Wrong show association → result rejected", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const expansion = await resolveAndExpandSearchQuery({
    query: "Aliyans actress Manju",
    offlineOnly: true,
  });
  const relevance = scoreIdentityRelevance({
    expansion,
    title: "Manju Warrier opens up about cinema",
    snippet: "Malayalam actress Manju Warrier discusses her career",
    url: "https://news.example/manju-warrier",
  });
  assert.equal(relevance.matchedIdentity, false);
  assert.ok(relevance.quarantine);
  assert.ok(relevance.conflictingIdentity || relevance.reason.toLowerCase().includes("quarant"));
});

test("Official username → strong identity match", async () => {
  invalidateIdentityExpansionCache({ all: true });
  // Seed handle onto knowledge via knownHandles overlapping expansion usernames after resolve
  const expansion = await resolveAndExpandSearchQuery({
    query: "Manju Pathrose",
    knownHandles: ["manjupathrose"],
    offlineOnly: true,
  });
  expansion.usernames = ["manjupathrose"];
  const relevance = scoreIdentityRelevance({
    expansion,
    title: "Instagram @manjupathrose",
    snippet: "Official profile",
    url: "https://instagram.com/manjupathrose",
  });
  assert.equal(relevance.matchedIdentity, true);
  assert.ok(relevance.matchedTerms.some((t) => t.startsWith("handle:")));
});

test("Duplicate results from multiple aliases → one merged result", () => {
  const merged = mergeSearchResultsByFingerprint([
    {
      item: { id: 1 },
      url: "https://www.youtube.com/watch?v=abc123XYZ00",
      title: "Manju Pathrose interview",
      discoveredByQuery: "Manju Pathrose",
    },
    {
      item: { id: 2 },
      url: "https://youtube.com/watch?v=abc123XYZ00&utm_source=x",
      title: "Manju Pauthrose interview",
      discoveredByQuery: "Manju Pauthrose",
    },
    {
      item: { id: 3 },
      url: "https://youtube.com/watch?v=abc123XYZ00",
      title: "മഞ്ജു പത്രോസ്",
      discoveredByQuery: "മഞ്ജു പത്രോസ്",
    },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.discoveredByQueries.sort(), [
    "Manju Pathrose",
    "Manju Pauthrose",
    "മഞ്ജു പത്രോസ്",
  ].sort());
});

test("User-approved alias → never overwritten", () => {
  const merged = mergeAliasListsForTest(
    [{ alias: "Manju Sunichen", source: "reviewer_approved", active: true }],
    [{ alias: "Manju Sunichen", source: "ai_discovered" }],
  );
  assert.equal(merged[0]?.source, "reviewer_approved");
});

test("Expansion service failure must not stop the scan", async () => {
  const result = await resolveAndExpandSearchQuerySafe({
    query: "Manju Pauthrose",
    knownAliases: ["Custom Alias"],
    knownHandles: ["@customhandle"],
    offlineOnly: true,
  });
  assert.ok(result.searchQueries.length >= 1);
  assert.ok(
    result.searchQueries.some((q) => /Manju|Custom Alias|customhandle/i.test(q.query)),
  );
  // Force fallback path via empty query still returns structure
  const empty = await resolveAndExpandSearchQuerySafe({ query: "" });
  assert.ok(Array.isArray(empty.searchQueries));
});

test("Never use raw query as the only search query when expansion succeeds", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const result = await resolveAndExpandSearchQuery({
    query: "Manju Pauthrose",
    offlineOnly: true,
  });
  const identities = expansionToIdentityList(result);
  assert.ok(identities.length >= 2);
  assert.ok(result.searchQueries.length >= 2);
});

test("Copyright module adds piracy terms; reputation does not", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const film = await resolveAndExpandSearchQuery({
    query: "Spider-Man Brand New Day",
    entityType: "film",
    module: "copyright",
    offlineOnly: true,
  });
  assert.ok(film.searchQueries.some((q) => /full movie|watch online|torrent/i.test(q.query)));

  const person = await resolveAndExpandSearchQuery({
    query: "Manju Pathrose",
    module: "reputation",
    offlineOnly: true,
  });
  assert.ok(!person.searchQueries.some((q) => /\btorrent\b|\bfull movie\b/i.test(q.query)));
  assert.ok(person.searchQueries.some((q) => /controversy|impersonation|deepfake|fake/i.test(q.query)));
});

test("Query limits respected", async () => {
  invalidateIdentityExpansionCache({ all: true });
  const result = await resolveAndExpandSearchQuery({
    query: "Aliyans actress Manju",
    module: "deepfake",
    knownAliases: Array.from({ length: 20 }, (_, i) => `Alias ${i}`),
    offlineOnly: true,
  });
  assert.ok(result.searchQueries.length <= 35);
  const byCat = result.searchQueries.reduce<Record<string, number>>((acc, q) => {
    acc[q.category] = (acc[q.category] ?? 0) + 1;
    return acc;
  }, {});
  assert.ok((byCat.alias ?? 0) <= 10);
  assert.ok((byCat.risk ?? 0) <= 10);
  assert.ok((byCat.canonical ?? 0) <= 5);
});
