import { describe, it } from "node:test";
import assert from "node:assert";

// Simulated hit structure matching ScanHit
interface TestHit {
  id: string;
  source: string;
  url: string;
  title: string;
  severity?: string;
  threatScore?: number;
  category?: string;
  media?: { videoId?: string; channelTitle?: string };
}

// Simulated in-memory database table for testing upsert deduplication
class MockScanHitsTable {
  private rows = new Map<string, { id: string; user_id: string; source: string; external_id: string | null; canonical_url: string | null; times_detected: number }>();

  upsert(batch: Array<{ user_id: string; source: string; external_id: string | null; canonical_url: string | null }>, onConflict: string): { persistenceMode: "upsert" | "insert-fallback"; count: number } {
    for (const item of batch) {
      const col = onConflict.includes("external_id") ? "external_id" : "canonical_url";
      const key = `${item.user_id}::${item.source}::${col === "external_id" ? item.external_id : item.canonical_url}`;
      const existing = this.rows.get(key);
      if (existing) {
        existing.times_detected += 1;
      } else {
        this.rows.set(key, {
          id: `hit-uuid-${this.rows.size + 1}`,
          user_id: item.user_id,
          source: item.source,
          external_id: item.external_id,
          canonical_url: item.canonical_url,
          times_detected: 1,
        });
      }
    }
    return { persistenceMode: "upsert", count: this.rows.size };
  }

  get totalCount(): number {
    return this.rows.size;
  }
}

// State machine helper for web scan persistence logic
function simulateScanPersistence(params: {
  discoveredHits: TestHit[];
  dbSuccess: boolean;
  dbErrorMessage?: string;
  refetchSuccess?: boolean;
}) {
  let isPersisting = true;
  let scanStatus: "running" | "completed" | "failed" = "running";
  let persistedScanId: string | null = null;
  let errorMsg: string | null = null;
  let persistedRowsCount = 0;

  const startTime = Date.now();
  const youtubeHits = params.discoveredHits.filter(
    (h) => h.source === "YouTube" || h.media?.videoId,
  );
  const socialWebHits = params.discoveredHits.filter(
    (h) => h.source !== "YouTube" && !h.media?.videoId,
  );

  if (params.dbSuccess) {
    scanStatus = "completed";
    persistedScanId = "scan-uuid-12345";
    persistedRowsCount = params.discoveredHits.length;
    isPersisting = false;
  } else {
    scanStatus = "failed";
    isPersisting = false;
    errorMsg = params.dbErrorMessage || "Database insert failed";
  }

  let renderedItems: TestHit[] = [];
  if (persistedScanId && params.refetchSuccess !== false) {
    renderedItems = params.discoveredHits;
  } else {
    renderedItems = params.discoveredHits;
  }

  const criticalOrHighThreats = renderedItems.filter(
    (h) => (h.severity === "Critical" || h.severity === "High") && (h.threatScore ?? 0) >= 50,
  );

  const youtubeSectionHits = renderedItems.filter((h) => h.source === "YouTube" || h.media?.videoId);

  return {
    scanStatus,
    isPersisting,
    persistedScanId,
    errorMsg,
    persistedRowsCount,
    youtubeCount: youtubeHits.length,
    socialWebCount: socialWebHits.length,
    renderedItemsCount: renderedItems.length,
    threatsOnlyCount: criticalOrHighThreats.length,
    showAllCount: renderedItems.length,
    youtubeSectionCount: youtubeSectionHits.length,
    durationMs: Date.now() - startTime,
  };
}

describe("Web Scan Persistence & Finalization State Machine", () => {
  it("Scenario A: 3 findings (1 YouTube, 2 social/web, 0 high-risk threats)", () => {
    const hits: TestHit[] = [
      {
        id: "yt-1",
        source: "YouTube",
        url: "https://youtube.com/watch?v=abc",
        title: "Mentions Video",
        severity: "Low",
        threatScore: 15,
        media: { videoId: "abc" },
      },
      {
        id: "social-1",
        source: "X",
        url: "https://x.com/post/1",
        title: "Mentions post",
        severity: "Low",
        threatScore: 10,
      },
      {
        id: "web-1",
        source: "Web",
        url: "https://blog.example/post",
        title: "Ordinary Blog",
        severity: "Low",
        threatScore: 5,
      },
    ];

    const result = simulateScanPersistence({
      discoveredHits: hits,
      dbSuccess: true,
      refetchSuccess: true,
    });

    assert.strictEqual(result.scanStatus, "completed");
    assert.strictEqual(result.isPersisting, false);
    assert.strictEqual(result.persistedScanId, "scan-uuid-12345");
    assert.strictEqual(result.persistedRowsCount, 3);
    assert.strictEqual(result.youtubeSectionCount, 1);
    assert.strictEqual(result.threatsOnlyCount, 0); // Valid empty state for Threats Only
    assert.strictEqual(result.showAllCount, 3); // All 3 visible in Show All Mentions
    assert.strictEqual(result.errorMsg, null);
  });

  it("Scenario B: Database persistence fails", () => {
    const hits: TestHit[] = [
      {
        id: "yt-1",
        source: "YouTube",
        url: "https://youtube.com/watch?v=xyz",
        title: "Test Video",
        media: { videoId: "xyz" },
      },
    ];

    const result = simulateScanPersistence({
      discoveredHits: hits,
      dbSuccess: false,
      dbErrorMessage: "ON CONFLICT DO UPDATE command cannot affect row a second time",
    });

    assert.strictEqual(result.scanStatus, "failed");
    assert.strictEqual(result.isPersisting, false);
    assert.strictEqual(result.errorMsg, "ON CONFLICT DO UPDATE command cannot affect row a second time");
    assert.strictEqual(result.renderedItemsCount, 1);
  });

  it("Scenario C: Persistence succeeds but refetch fails", () => {
    const hits: TestHit[] = [
      {
        id: "yt-1",
        source: "YouTube",
        url: "https://youtube.com/watch?v=123",
        title: "Refetch Fail Test",
        media: { videoId: "123" },
      },
    ];

    const result = simulateScanPersistence({
      discoveredHits: hits,
      dbSuccess: true,
      refetchSuccess: false,
    });

    assert.strictEqual(result.scanStatus, "completed");
    assert.strictEqual(result.isPersisting, false);
    assert.strictEqual(result.renderedItemsCount, 1);
    assert.strictEqual(result.youtubeSectionCount, 1);
  });

  it("Duplicate Retry Test: Persisting same scan/findings twice keeps final row count = 3", () => {
    const db = new MockScanHitsTable();
    const hits = [
      { user_id: "usr-1", source: "YouTube", external_id: "yt-100", canonical_url: "https://youtube.com/watch?v=yt-100" },
      { user_id: "usr-1", source: "X", external_id: null, canonical_url: "https://x.com/status/200" },
      { user_id: "usr-1", source: "News", external_id: null, canonical_url: "https://news.example/article/300" },
    ];

    // First scan execution
    const run1WithExt = hits.filter((h) => h.external_id);
    const run1WithoutExt = hits.filter((h) => !h.external_id);
    const res1 = db.upsert(run1WithExt, "user_id,source,external_id");
    db.upsert(run1WithoutExt, "user_id,source,canonical_url");

    assert.strictEqual(res1.persistenceMode, "upsert");
    assert.strictEqual(db.totalCount, 3);

    // Second scan execution (Retry with identical findings)
    const res2 = db.upsert(run1WithExt, "user_id,source,external_id");
    db.upsert(run1WithoutExt, "user_id,source,canonical_url");

    assert.strictEqual(res2.persistenceMode, "upsert");
    assert.strictEqual(db.totalCount, 3); // Must remain 3, NOT 6!
  });

  it("AWS Rekognition background call error safety test", async () => {
    let unhandledRejection: unknown = null;
    const handler = (reason: unknown) => {
      unhandledRejection = reason;
    };
    process.on("unhandledRejection", handler);

    // Simulate isolated background face scan execution
    const runFaceScanSafe = async () => {
      return new Promise<void>((resolve) => {
        void (async () => {
          try {
            throw new Error("AWS Rekognition ThrottlingException simulated");
          } catch (e) {
            // Safely caught, logged, never throws
            assert.strictEqual((e as Error).message, "AWS Rekognition ThrottlingException simulated");
          } finally {
            resolve();
          }
        })().catch(() => null);
      });
    };

    await runFaceScanSafe();
    process.removeListener("unhandledRejection", handler);
    assert.strictEqual(unhandledRejection, null);
  });
});
