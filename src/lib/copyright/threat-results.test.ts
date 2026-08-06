import assert from "node:assert/strict";
import test from "node:test";
import {
  buildThreatResultRows,
  classifyThreatCategory,
  filterThreatRows,
  groupThreatRowsBySeverity,
  severityFor,
} from "./threat-results";
import type { PublicSuspiciousSource } from "./suspicious-sources";

function src(overrides: Partial<PublicSuspiciousSource>): PublicSuspiciousSource {
  return {
    id: overrides.id ?? "id-1",
    url: overrides.url ?? "https://ogomovies.xxx/movie",
    domain: overrides.domain ?? null,
    title: overrides.title ?? null,
    classification: overrides.classification ?? "DOWNLOAD_PAGE",
    confidence: overrides.confidence ?? 95,
    confidence_band: overrides.confidence_band ?? "confirmed",
    source_state: overrides.source_state ?? "new_confirmed",
    ...overrides,
  } as PublicSuspiciousSource;
}

test("threat results: categorises hosts", () => {
  assert.equal(classifyThreatCategory({ domain: "t.me", url: "https://t.me/x" }), "telegram");
  assert.equal(classifyThreatCategory({ domain: "archive.org", url: "u" }), "archive");
  assert.equal(
    classifyThreatCategory({
      domain: "archive.org",
      url: "https://archive.org/x.pdf",
    }),
    "document",
  );
  assert.equal(classifyThreatCategory({ domain: "ok.ru", url: "u" }), "video_reupload");
  assert.equal(classifyThreatCategory({ domain: "dailymotion.com", url: "u" }), "video_reupload");
  assert.equal(classifyThreatCategory({ domain: "bilibili.tv", url: "u" }), "video_reupload");
  assert.equal(classifyThreatCategory({ domain: "mega.nz", url: "u" }), "cloud_storage");
  assert.equal(classifyThreatCategory({ domain: "terabox.app", url: "u" }), "cloud_storage");
  assert.equal(classifyThreatCategory({ domain: "1337x.to", url: "u" }), "torrent");
  assert.equal(classifyThreatCategory({ domain: "vegamovies.dad", url: "u" }), "download");
  assert.equal(classifyThreatCategory({ domain: "ogomovies1.com.pk", url: "u" }), "download");
});

test("threat results: maps confidence to severity", () => {
  assert.equal(severityFor(98, true), "critical");
  assert.equal(severityFor(75, false), "high");
  assert.equal(severityFor(55, false), "medium");
  assert.equal(severityFor(20, false), "low");
  assert.equal(
    severityFor(80, true, {
      categoryKey: "download",
      classification: "DOWNLOAD_PAGE",
    }),
    "critical",
  );
  assert.equal(
    severityFor(80, true, {
      categoryKey: "cloud_storage",
      classification: "FILE_HOST_DISTRIBUTION",
    }),
    "critical",
  );
});

test("threat results: produces one row per unique domain and keeps every domain", () => {
  const rows = buildThreatResultRows({
    suspicious: [
      src({ id: "a", url: "https://ogomovies.xxx/a" }),
      src({ id: "b", url: "https://www.ogomovies.xxx/b", confidence: 80 }),
      src({ id: "c", url: "https://ok.ru/video", confidence: 91 }),
    ],
    inspected: [
      { id: "d", url: "https://ogomovies.xxx/c", host: "ogomovies.xxx", confidence: 74 },
      { id: "e", url: "https://youtube.com/watch?v=1", host: "youtube.com", confidence: 95 },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.domain),
    ["ogomovies.xxx", "ok.ru"],
  );
  const first = rows[0]!;
  assert.equal(first.findingCount, 3);
  assert.ok(first.additionalUrls.includes("https://www.ogomovies.xxx/b"));
});

test("threat results: filters and groups", () => {
  const rows = buildThreatResultRows({
    suspicious: [src({ id: "a" }), src({ id: "c", url: "https://ok.ru/v", confidence: 55 })],
  });
  assert.deepEqual(
    filterThreatRows(rows, { filter: "video_reupload" }).map((r) => r.domain),
    ["ok.ru"],
  );
  assert.equal(filterThreatRows(rows, { search: "ogo" }).length, 1);
  const groups = groupThreatRowsBySeverity(rows);
  assert.equal(groups.find((g) => g.severity === "critical")?.count, 1);
  assert.equal(groups.find((g) => g.severity === "medium")?.count, 1);
});
