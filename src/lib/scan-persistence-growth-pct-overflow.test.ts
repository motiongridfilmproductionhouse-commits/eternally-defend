import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { persistScanCore } from "./scans.functions";

/**
 * Reproduces the production "114 candidates · 0 findings · PERSIST_FAILED"
 * failure at the exact persistence boundary: `scan_hits.growth_pct` is
 * `numeric(8,3)` in Postgres (max magnitude 99999.999), and a single hit
 * whose `growthPct` exceeds that blows up the whole chunked `.upsert()`
 * call, since Postgres rejects an `INSERT ... ON CONFLICT` batch atomically
 * on any one row's overflow.
 *
 * There is no real Postgres instance available to this test, so the mock
 * below stands in for it. It reimplements only the one constraint that
 * matters here — the `numeric(8,3)` bound on `growth_pct` — returning the
 * same `{code: "22003", message: "numeric field overflow"}` shape Postgres
 * itself returns, and rejects the entire batch when it's tripped, matching
 * observed atomic-upsert behavior. It is not a substitute for a live
 * database-backed integration test; it verifies the application-level
 * persistence boundary (does `persistScanCore` still throw / still reach
 * `scans.update` finalization), not Postgres's own constraint enforcement.
 */
const GROWTH_PCT_MAX = 99_999.999;

function createPersistenceMock() {
  const scans: Record<string, unknown>[] = [];
  const scanHits: Record<string, unknown>[] = [];
  let nextScanId = 1;
  let scanUpdateCalled = false;
  let lastScanUpdatePayload: Record<string, unknown> | null = null;

  function from(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      eq() {
        return chain;
      },
      in() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      select() {
        return chain;
      },
      insert(payload: Record<string, unknown>) {
        if (table !== "scans") throw new Error(`unexpected insert on ${table}`);
        const row = { id: `scan-${nextScanId++}`, ...payload };
        scans.push(row);
        return {
          select: () => ({
            single: async () => ({ data: row, error: null }),
          }),
        };
      },
      update(payload: Record<string, unknown>) {
        if (table === "scans") {
          scanUpdateCalled = true;
          lastScanUpdatePayload = payload;
        }
        return {
          eq: async () => ({ data: null, error: null }),
        };
      },
      async upsert(rows: Array<Record<string, unknown>>) {
        if (table !== "scan_hits") throw new Error(`unexpected upsert on ${table}`);
        for (const row of rows) {
          const growthPct = row.growth_pct as number | null;
          if (growthPct !== null && Math.abs(growthPct) >= GROWTH_PCT_MAX) {
            return {
              error: {
                code: "22003",
                message: "numeric field overflow",
                details: `A field with precision 8, scale 3 must round to an absolute value less than 10^5.`,
                hint: null,
              },
            };
          }
        }
        scanHits.push(...rows);
        return { error: null };
      },
      // select().eq().in() and select().eq().order().limit() resolve here
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        resolve({ data: table === "scans" ? scans : scanHits, error: null });
      },
    };
    return chain;
  }

  return {
    from,
    get scanHits() {
      return scanHits;
    },
    get scanUpdateCalled() {
      return scanUpdateCalled;
    },
    get lastScanUpdatePayload() {
      return lastScanUpdatePayload;
    },
  };
}

function buildBatch(opts: { extremeGrowth: number }) {
  const hits = [];
  for (let i = 0; i < 113; i++) {
    hits.push({
      source: "youtube",
      externalId: `vid-${i}`,
      title: `Ordinary clip ${i}`,
      growthPct: 250 + i,
    });
  }
  hits.push({
    source: "youtube",
    externalId: "vid-viral",
    title: "Extreme viral clip",
    growthPct: opts.extremeGrowth,
  });
  return hits;
}

describe("scan_hits persistence boundary — growth_pct numeric(8,3) overflow", () => {
  it("persists a 114-hit batch (113 ordinary + 1 with growthPerDay > 100000) without PERSIST_FAILED", async () => {
    const supabase = createPersistenceMock();
    const hits = buildBatch({ extremeGrowth: 250_000 });

    const result = await persistScanCore(supabase, "user-1", {
      query: "Lena Kumar",
      hits,
      totals: { total: 114, unique: 114, duplicatesRemoved: 0 },
    });

    assert.equal(supabase.scanHits.length, 114, "all 114 candidates must be persisted");
    assert.equal(
      supabase.scanUpdateCalled,
      true,
      "finalize update (new_hits/updated_hits) must run",
    );
    assert.equal(supabase.lastScanUpdatePayload?.new_hits, 114);
    assert.equal(result.newHits, 114);

    const viral = supabase.scanHits.find(
      (r) => (r as Record<string, unknown>).external_id === "vid-viral",
    ) as Record<string, unknown>;
    assert.ok(viral, "the extreme candidate must still be persisted, not dropped");
    assert.equal(
      viral.growth_pct,
      99_999,
      "the extreme value must be bounded to the numeric(8,3) column's safe application ceiling",
    );
  });

  it("sanity: the mock itself rejects an out-of-range growth_pct like Postgres would (22003)", async () => {
    // Confirms the mock is a faithful stand-in and not a no-op: bypassing
    // normalizePercentage entirely and upserting a raw unbounded value must
    // still be rejected with the same numeric field overflow shape Postgres
    // returns for scan_hits.growth_pct numeric(8,3).
    const supabase = createPersistenceMock();
    const { error } = await supabase
      .from("scan_hits")
      .upsert([{ external_id: "raw-unbounded", growth_pct: 250_000 }]);
    assert.equal(error?.code, "22003");
  });
});
