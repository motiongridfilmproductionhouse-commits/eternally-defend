import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeTimestamp } from "./scans.functions";

describe("normalizeTimestamp — scan_hits published_at persistence boundary", () => {
  it("preserves a valid ISO timestamp semantically", () => {
    const iso = "2023-04-27T10:15:00.000Z";
    assert.strictEqual(normalizeTimestamp(iso), iso);
  });

  it("parses a normal date string", () => {
    const result = normalizeTimestamp("April 27, 2023");
    assert.strictEqual(result, new Date("April 27, 2023").toISOString());
  });

  it("parses a unix timestamp (milliseconds, numeric input)", () => {
    const ms = 1682590500000;
    assert.strictEqual(normalizeTimestamp(ms), new Date(ms).toISOString());
  });

  it("parses a unix timestamp passed as a numeric string", () => {
    const ms = 1682590500000;
    assert.strictEqual(normalizeTimestamp(String(ms)), new Date(ms).toISOString());
  });

  it("parses a Reddit-style seconds-precision unix epoch (created_utc convention)", () => {
    const seconds = 1682590500; // 2023-04-27T10:15:00.000Z
    assert.strictEqual(normalizeTimestamp(seconds), new Date(seconds * 1000).toISOString());
    assert.strictEqual(
      normalizeTimestamp(String(seconds)),
      new Date(seconds * 1000).toISOString(),
    );
  });

  it("returns null for null", () => {
    assert.strictEqual(normalizeTimestamp(null), null);
  });

  it("returns null for undefined", () => {
    assert.strictEqual(normalizeTimestamp(undefined), null);
  });

  it("returns null for an empty string", () => {
    assert.strictEqual(normalizeTimestamp(""), null);
  });

  it("returns null for a whitespace-only string", () => {
    assert.strictEqual(normalizeTimestamp("   "), null);
  });

  it('returns null for the reported crash value "272023/04/" instead of throwing', () => {
    assert.strictEqual(normalizeTimestamp("272023/04/"), null);
  });

  it("returns null for random text that Date can't parse at all", () => {
    assert.strictEqual(normalizeTimestamp("not a date at all"), null);
    assert.strictEqual(normalizeTimestamp("unknown"), null);
  });

  it("resolves loosely-formatted but plausible text to the date Date.parse infers", () => {
    // "Apr 2023?" is not malformed in a harmful way — JS's lenient parser
    // recovers a sane, in-range date from it (the trailing "?" is ignored).
    // The boundary only needs to guarantee it never throws and never
    // produces something out of range; it isn't required to reject every
    // string a human wouldn't consider "clean".
    assert.strictEqual(normalizeTimestamp("Apr 2023?"), new Date("Apr 2023?").toISOString());
  });

  it("returns null for an invalid Date instance instead of throwing", () => {
    assert.strictEqual(normalizeTimestamp(new Date("not-a-date")), null);
  });

  it("returns ISO string for a valid Date instance", () => {
    const d = new Date("2023-04-27T00:00:00.000Z");
    assert.strictEqual(normalizeTimestamp(d), d.toISOString());
  });

  it("returns null for non-string/number/Date types (objects, arrays, booleans)", () => {
    assert.strictEqual(normalizeTimestamp({ foo: "bar" }), null);
    assert.strictEqual(normalizeTimestamp([2023, 4, 27]), null);
    assert.strictEqual(normalizeTimestamp(true), null);
  });

  it("never throws regardless of input shape", () => {
    const inputs: unknown[] = [
      "272023/04/",
      "unknown",
      "",
      null,
      undefined,
      NaN,
      Infinity,
      -Infinity,
      {},
      [],
      Symbol("x"),
      () => {},
    ];
    for (const input of inputs) {
      assert.doesNotThrow(() => normalizeTimestamp(input));
    }
  });
});

describe("scan_hits upsert batch resilience to malformed published dates", () => {
  it("a single malformed date never rejects the whole batch — it becomes null on that row only", () => {
    const hits = [
      { source: "reddit", externalId: "r1", publishedAt: "2023-04-27T10:00:00.000Z" },
      { source: "web", externalId: "w1", publishedAt: "272023/04/" },
      { source: "web", externalId: "w2", publishedAt: null },
    ];

    const rows = hits.map((h) => ({
      source: h.source,
      external_id: h.externalId,
      published_at: normalizeTimestamp(h.publishedAt),
    }));

    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].published_at, "2023-04-27T10:00:00.000Z");
    assert.strictEqual(rows[1].published_at, null);
    assert.strictEqual(rows[2].published_at, null);
  });
});
