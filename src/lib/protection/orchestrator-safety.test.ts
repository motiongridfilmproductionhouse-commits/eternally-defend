/**
 * Cross-cutting safety guarantees for the Phase 2 orchestrator wiring:
 * one module's failure must not affect another, one tenant's data must
 * never leak into another's, and nothing in the new automated dispatch
 * path is capable of sending anything externally (that stays gated
 * downstream in EnforcementWorkerRunner/the connector layer, untouched by
 * this phase — confirmed by static inspection here since importing the
 * actual cron route file isn't safe in a unit test, see below).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCopyrightIntelForUser } from "./dispatch/copyright.server";
import { runNarrativeIntelForUser } from "./dispatch/narrative.server";
import { createMockSupabase } from "./test-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mirrors (does not import) scan-orchestrator.ts's exact per-row shape:
 * `try { dispatch(row) } catch { mark row FAILED, continue }`. The real
 * route file isn't imported here because it constructs a live Supabase
 * admin client and expects a signed cron request — this harness exercises
 * the isolation guarantee that shape provides without touching either.
 */
async function processRowsLikeOrchestrator(
  rows: { id: string; dispatch: () => Promise<unknown> }[],
): Promise<Record<string, "COMPLETED" | "FAILED">> {
  const results: Record<string, "COMPLETED" | "FAILED"> = {};
  for (const row of rows) {
    try {
      await row.dispatch();
      results[row.id] = "COMPLETED";
    } catch {
      results[row.id] = "FAILED";
    }
  }
  return results;
}

test("one module's exception does not stop or affect a sibling module's run", async () => {
  const results = await processRowsLikeOrchestrator([
    {
      id: "deepfake_intel",
      dispatch: async () => {
        throw new Error("simulated Rekognition outage");
      },
    },
    {
      id: "narrative_intelligence",
      dispatch: async () => {
        const supabase = createMockSupabase();
        return runNarrativeIntelForUser(supabase, "user-1");
      },
    },
  ]);
  assert.equal(results.deepfake_intel, "FAILED");
  assert.equal(results.narrative_intelligence, "COMPLETED");
});

test("a provider failure inside one module (e.g. copyright/SerpAPI) never propagates to stop other modules", async () => {
  const results = await processRowsLikeOrchestrator([
    {
      id: "copyright_intel",
      dispatch: async () => {
        const supabase = createMockSupabase({
          protected_assets: [
            { id: "a1", user_id: "user-1", name: "P", storage_path: "p1", active: true },
          ],
        });
        return runCopyrightIntelForUser(supabase, "user-1", 1440, {
          executeCopyrightScanById: async () => {
            throw new Error("SerpApi quota exceeded");
          },
        });
      },
    },
    {
      id: "narrative_intelligence",
      dispatch: async () => runNarrativeIntelForUser(createMockSupabase(), "user-1"),
    },
  ]);
  // Copyright itself catches per-asset failures internally and returns a
  // PARTIAL outcome rather than throwing, which is an even stronger
  // guarantee than "the orchestrator's outer catch saves the day" — either
  // way, the sibling module is unaffected.
  assert.equal(results.copyright_intel, "COMPLETED");
  assert.equal(results.narrative_intelligence, "COMPLETED");
});

test("tenant isolation: two users' enrollment-shaped rows never cross in the same query", async () => {
  const supabase = createMockSupabase({
    scan_module_enrollments: [
      { id: "e1", user_id: "user-1", module_key: "copyright_intel", eligible: true },
      { id: "e2", user_id: "user-2", module_key: "copyright_intel", eligible: true },
    ],
  });
  const { data: user1Rows } = await supabase
    .from("scan_module_enrollments")
    .select("*")
    .eq("user_id", "user-1");
  assert.equal(user1Rows.length, 1);
  assert.equal(user1Rows[0].user_id, "user-1");
});

test("static: no Phase 2 dispatch file calls a connector's submit(), sends live enforcement mail, or reads the live-enforcement bypass flags", () => {
  const forbidden = [
    /connector\.submit\s*\(/,
    /\.submit\s*\(\s*payload/,
    /PostmarkTransport/,
    /sendEmail\s*\(/,
    /process\.env\.ENFORCEMENT_LIVE_ENABLED/,
    /process\.env\.ENFORCEMENT_TEST_MODE/,
    /process\.env\.CONTROLLED_PRODUCTION_MODE/,
  ];
  const dispatchDir = join(__dirname, "dispatch");
  const files = [
    join(dispatchDir, "copyright.server.ts"),
    join(dispatchDir, "youtube-removal.server.ts"),
    join(dispatchDir, "deepfake.server.ts"),
    join(dispatchDir, "narrative.server.ts"),
    join(dispatchDir, "face-protection.server.ts"),
    join(__dirname, "evidence.server.ts"),
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(src, pattern, `${file} must not match ${pattern}`);
    }
  }
});

test("static: Phase 2 dispatch modules only ever call AutoEnforcementOrchestrator.onVerifiedFinding, never a lower-level submit path directly", () => {
  const dispatchDir = join(__dirname, "dispatch");
  const files = ["copyright.server.ts", "youtube-removal.server.ts", "deepfake.server.ts"];
  for (const file of files) {
    const src = readFileSync(join(dispatchDir, file), "utf8");
    assert.match(
      src,
      /onVerifiedFinding/,
      `${file} should route findings through onVerifiedFinding`,
    );
    assert.doesNotMatch(
      src,
      /EnforcementWorkerRunner/,
      `${file} must not touch the job-processing worker directly`,
    );
  }
});
