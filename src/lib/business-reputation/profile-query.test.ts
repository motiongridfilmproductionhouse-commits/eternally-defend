import assert from "node:assert/strict";
import test from "node:test";
import { dedupeAliases, normalizeBusinessProfile, normalizeWebsite } from "./profile";
import { buildBusinessQueryPlan } from "./query-plan";

const profile = normalizeBusinessProfile({
  resolved: true,
  resolvedBrandName: "Acme Coffee",
  placeId: "place-1",
  website: "HTTP://WWW.AcmeCoffee.com/path",
  formattedAddress: "Austin, TX, US",
  country: "US",
  city: "Austin",
  businessTypes: ["cafe", "cafe"],
  aliases: ["ACME COFFEE", "Acme"],
  tradingNames: ["Acme", "ACME Café"],
  scope: "branch",
});

test("normalizes the selected business website domain", () =>
  assert.equal(profile.website, "https://acmecoffee.com"));
test("deduplicates aliases and trading names without replacing the selected name", () =>
  assert.deepEqual(profile.aliases, ["Acme", "ACME Café"]));
test("empty optional profile fields remain safe", () => assert.equal(normalizeWebsite(""), null));
test("dedupeAliases removes case-insensitive duplicates", () =>
  assert.deepEqual(dedupeAliases(["Acme", " acme ", "Trading"], "ACME"), ["Trading"]));
test("branch query plan preserves city scope", () => {
  const queries = buildBusinessQueryPlan({ profile, handles: ["@acmecoffee"], maxQueries: 32 });
  assert.match(queries.find((x) => x.category === "exact")!.query, /Austin/);
});
test("brand query plan supports broad discovery without city restriction", () => {
  const queries = buildBusinessQueryPlan({
    profile: { ...profile, scope: "brand" },
    scope: "brand",
  });
  assert.doesNotMatch(queries.find((x) => x.category === "exact")!.query, /Austin/);
});
test("exact business query has highest priority", () => {
  const queries = buildBusinessQueryPlan({ profile });
  assert.equal(queries[0]?.category, "exact");
  assert.equal(queries[0]?.priority, 100);
});
test("identity categories are generated", () => {
  const categories = new Set(
    buildBusinessQueryPlan({ profile, handles: ["@acmecoffee"] }).map((x) => x.category),
  );
  for (const category of [
    "identity",
    "media",
    "review",
    "complaint",
    "legal",
    "impersonation",
    "domain",
    "social",
  ])
    assert.ok(categories.has(category));
});
test("query plan is deterministic and deduplicated", () => {
  const a = buildBusinessQueryPlan({ profile, handles: ["@acmecoffee"] });
  const b = buildBusinessQueryPlan({ profile, handles: ["@acmecoffee"] });
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((x) => x.query.toLowerCase())).size, a.length);
});
test("query plan respects maximum", () =>
  assert.ok(
    buildBusinessQueryPlan({ profile, handles: ["a", "b", "c"], maxQueries: 5 }).length <= 5,
  ));
test("unconfirmed and empty businesses are rejected", () =>
  assert.throws(
    () => buildBusinessQueryPlan({ profile: { ...profile, resolved: false } }),
    /confirmed/,
  ));
test("sample Places profiles can be explicitly marked and remain distinguishable", () =>
  assert.equal(normalizeBusinessProfile({ ...profile, isSample: true }).isSample, true));
