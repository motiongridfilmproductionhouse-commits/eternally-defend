import { describe, expect, it } from "vitest";
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

describe("threat results", () => {
  it("categorises hosts", () => {
    expect(classifyThreatCategory({ domain: "t.me", url: "https://t.me/x" })).toBe("telegram");
    expect(classifyThreatCategory({ domain: "archive.org", url: "u" })).toBe("archive");
    expect(classifyThreatCategory({ domain: "ok.ru", url: "u" })).toBe("streaming");
    expect(classifyThreatCategory({ domain: "mega.nz", url: "u" })).toBe("file_host");
    expect(classifyThreatCategory({ domain: "1337x.to", url: "u" })).toBe("torrent");
    expect(classifyThreatCategory({ domain: "vegamovies.dad", url: "u" })).toBe("download");
  });

  it("maps confidence to severity", () => {
    expect(severityFor(98, true)).toBe("critical");
    expect(severityFor(75, false)).toBe("high");
    expect(severityFor(55, false)).toBe("medium");
    expect(severityFor(20, false)).toBe("low");
  });

  it("produces one row per unique domain and keeps every domain", () => {
    const rows = buildThreatResultRows({
      suspicious: [
        src({ id: "a", url: "https://ogomovies.xxx/a" }),
        src({ id: "b", url: "https://www.ogomovies.xxx/b", confidence: 80 }),
        src({ id: "c", url: "https://ok.ru/video", confidence: 91 }),
      ],
      inspected: [
        { id: "d", url: "https://dailymotion.com/v", host: "dailymotion.com", confidence: 74 },
      ],
    });
    expect(rows.map((r) => r.domain)).toEqual(["ogomovies.xxx", "ok.ru", "dailymotion.com"]);
    const first = rows[0]!;
    expect(first.findingCount).toBe(2);
    expect(first.additionalUrls).toContain("https://www.ogomovies.xxx/b");
  });

  it("filters and groups", () => {
    const rows = buildThreatResultRows({
      suspicious: [src({ id: "a" }), src({ id: "c", url: "https://ok.ru/v", confidence: 55 })],
    });
    expect(filterThreatRows(rows, { filter: "streaming" }).map((r) => r.domain)).toEqual(["ok.ru"]);
    expect(filterThreatRows(rows, { search: "ogo" })).toHaveLength(1);
    const groups = groupThreatRowsBySeverity(rows);
    expect(groups.find((g) => g.severity === "critical")?.count).toBe(1);
    expect(groups.find((g) => g.severity === "medium")?.count).toBe(1);
  });
});
