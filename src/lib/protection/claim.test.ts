import test from "node:test";
import assert from "node:assert/strict";
import { isRowClaimable, buildDueRowFilter, STALE_CLAIM_MINUTES } from "./claim";
import { createMockSupabase } from "./test-utils";

const NOW = new Date("2026-08-24T12:00:00.000Z").getTime();

test("a row that's not RUNNING/QUEUED is always claimable", () => {
  assert.equal(isRowClaimable("WAITING_FOR_NEXT_SCAN", new Date(NOW).toISOString(), NOW), true);
  assert.equal(isRowClaimable("COMPLETED", new Date(NOW).toISOString(), NOW), true);
  assert.equal(isRowClaimable("FAILED", new Date(NOW).toISOString(), NOW), true);
});

test("a freshly-claimed RUNNING row (worker still genuinely working) is not reclaimable", () => {
  const justClaimed = new Date(NOW - 2 * 60_000).toISOString(); // 2 min ago
  assert.equal(isRowClaimable("RUNNING", justClaimed, NOW), false);
});

test("a RUNNING row stuck past the stale window (crashed worker) is reclaimable", () => {
  const staleClaim = new Date(NOW - (STALE_CLAIM_MINUTES + 1) * 60_000).toISOString();
  assert.equal(isRowClaimable("RUNNING", staleClaim, NOW), true);
});

test("a QUEUED row past the stale window is also reclaimable", () => {
  const staleClaim = new Date(NOW - (STALE_CLAIM_MINUTES + 1) * 60_000).toISOString();
  assert.equal(isRowClaimable("QUEUED", staleClaim, NOW), true);
});

test("exactly at the stale boundary counts as reclaimable (>=)", () => {
  const boundary = new Date(NOW - STALE_CLAIM_MINUTES * 60_000).toISOString();
  assert.equal(isRowClaimable("RUNNING", boundary, NOW), true);
});

test("buildDueRowFilter produces a PostgREST OR expression combining the not-claimed and stale-claim conditions", () => {
  const cutoff = "2026-08-24T11:40:00.000Z";
  const filter = buildDueRowFilter(cutoff);
  assert.equal(filter, `current_status.not.in.(RUNNING,QUEUED),updated_at.lte.${cutoff}`);
});

/** Mirrors scan-orchestrator.ts's exact claim query (see its inline comment). */
async function attemptClaim(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  row: { id: string; current_status: string; updated_at: string },
) {
  const { data: claimed } = await supabase
    .from("scan_module_enrollments")
    .update({ current_status: "RUNNING" })
    .eq("id", row.id)
    .eq("current_status", row.current_status)
    .eq("updated_at", row.updated_at)
    .select()
    .maybeSingle();
  return claimed;
}

test("duplicate-safety audit: two workers reclaiming the same stale RUNNING row — only one succeeds", async () => {
  const staleUpdatedAt = "2026-08-24T11:00:00.000Z";
  const supabase = createMockSupabase({
    scan_module_enrollments: [
      {
        id: "e1",
        user_id: "user-1",
        module_key: "copyright_intel",
        current_status: "RUNNING",
        updated_at: staleUpdatedAt,
      },
    ],
  });
  // Both workers independently SELECTed the row before either claimed it,
  // so both compute their claim attempt from the same pre-claim snapshot.
  const snapshot = { id: "e1", current_status: "RUNNING", updated_at: staleUpdatedAt };

  const first = await attemptClaim(supabase, snapshot);
  const second = await attemptClaim(supabase, snapshot);

  assert.ok(first, "the first worker to claim the stale row must succeed");
  assert.equal(second, null, "a second worker using the same stale snapshot must not also succeed");
});

test("a normal (non-stale) claim transition (WAITING_FOR_NEXT_SCAN -> RUNNING) is still exclusive between two racing workers", async () => {
  const readyAt = "2026-08-24T12:00:00.000Z";
  const supabase = createMockSupabase({
    scan_module_enrollments: [
      {
        id: "e2",
        user_id: "user-1",
        module_key: "reputation_web_scan",
        current_status: "WAITING_FOR_NEXT_SCAN",
        updated_at: readyAt,
      },
    ],
  });
  const snapshot = { id: "e2", current_status: "WAITING_FOR_NEXT_SCAN", updated_at: readyAt };

  const first = await attemptClaim(supabase, snapshot);
  const second = await attemptClaim(supabase, snapshot);

  assert.ok(first);
  assert.equal(second, null);
});
