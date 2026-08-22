import test from "node:test";
import assert from "node:assert/strict";
import { captureAndRecordFindingEvidence } from "./evidence.server";
import { createMockSupabase } from "./test-utils";

function withMockFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("evidence capture records a real hash for a reachable URL", async () => {
  const supabase = createMockSupabase();
  await withMockFetch(
    (async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "4" },
      })) as unknown as typeof fetch,
    async () => {
      const result = await captureAndRecordFindingEvidence(supabase, {
        userId: "user-1",
        moduleKey: "copyright_intel",
        findingSourceTable: "copyright_matches",
        findingId: "match-1",
        url: "https://pirate-site.example/found.jpg",
      });
      assert.equal(result.ok, true);
      assert.notEqual(result.status, "capture_failed");
    },
  );

  const rows = supabase._store.automated_finding_evidence;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].media_sha256?.length, 64, "sha256 hex digest recorded");
  assert.equal(rows[0].module_key, "copyright_intel");
  assert.equal(rows[0].finding_id, "match-1");
});

test("evidence capture is recorded (as capture_failed) even when the URL is unreachable, never throws", async () => {
  const supabase = createMockSupabase();
  await withMockFetch(
    (async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch,
    async () => {
      const result = await captureAndRecordFindingEvidence(supabase, {
        userId: "user-1",
        moduleKey: "youtube_removal",
        findingSourceTable: "youtube_removal_findings",
        findingId: "finding-1",
        url: "https://dead-link.example/gone",
      });
      assert.equal(result.status, "capture_failed");
    },
  );
  const rows = supabase._store.automated_finding_evidence;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].evidence_status, "capture_failed");
});

test("retrying the same finding upserts (idempotent) instead of creating a duplicate evidence row", async () => {
  const supabase = createMockSupabase();
  const input = {
    userId: "user-1",
    moduleKey: "copyright_intel",
    findingSourceTable: "copyright_matches",
    findingId: "match-dup",
    url: "https://pirate-site.example/found.jpg",
  };
  await withMockFetch(
    (async () =>
      new Response(new Uint8Array([9]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "1" },
      })) as unknown as typeof fetch,
    async () => {
      await captureAndRecordFindingEvidence(supabase, input);
      await captureAndRecordFindingEvidence(supabase, input); // retry
    },
  );
  const rows = supabase._store.automated_finding_evidence.filter(
    (r) => r.finding_id === "match-dup",
  );
  assert.equal(rows.length, 1, "retry must upsert onto the same row, not duplicate");
});

test("duplicate-safety audit: the SAME url rediscovered in a later scan (a new finding_id) upserts onto one evidence row, not a new one per cycle", async () => {
  const supabase = createMockSupabase();
  const sameUrl = "https://pirate-site.example/recurring-reupload.jpg";
  await withMockFetch(
    (async () =>
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "1" },
      })) as unknown as typeof fetch,
    async () => {
      // Scan cycle 1 discovers this URL as copyright_matches row "match-cycle-1".
      await captureAndRecordFindingEvidence(supabase, {
        userId: "user-1",
        moduleKey: "copyright_intel",
        findingSourceTable: "copyright_matches",
        findingId: "match-cycle-1",
        url: sameUrl,
      });
      // A later recurring scan of the same asset rediscovers the same URL,
      // but copyright_matches is scoped per-scan so it's a DIFFERENT row id.
      await captureAndRecordFindingEvidence(supabase, {
        userId: "user-1",
        moduleKey: "copyright_intel",
        findingSourceTable: "copyright_matches",
        findingId: "match-cycle-2",
        url: sameUrl,
      });
    },
  );
  const rows = supabase._store.automated_finding_evidence.filter((r) => r.url === sameUrl);
  assert.equal(
    rows.length,
    1,
    "content-identity dedup must collapse repeat scans of the same URL onto one evidence row",
  );
});

test("evidence for the same url but different users never collapses into one row (tenant isolation)", async () => {
  const supabase = createMockSupabase();
  const sameUrl = "https://pirate-site.example/shared-infringement.jpg";
  await withMockFetch(
    (async () =>
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })) as unknown as typeof fetch,
    async () => {
      await captureAndRecordFindingEvidence(supabase, {
        userId: "user-1",
        moduleKey: "copyright_intel",
        findingSourceTable: "copyright_matches",
        findingId: "m1",
        url: sameUrl,
      });
      await captureAndRecordFindingEvidence(supabase, {
        userId: "user-2",
        moduleKey: "copyright_intel",
        findingSourceTable: "copyright_matches",
        findingId: "m2",
        url: sameUrl,
      });
    },
  );
  const rows = supabase._store.automated_finding_evidence.filter((r) => r.url === sameUrl);
  assert.equal(
    rows.length,
    2,
    "two different users' evidence for the same URL must stay separate rows",
  );
});

test("deployment-readiness audit: every capture attempt is preserved in the append-only history table, even though the canonical row is upserted", async () => {
  const supabase = createMockSupabase();
  const sameUrl = "https://pirate-site.example/history-check.jpg";
  await withMockFetch(
    (async () =>
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })) as unknown as typeof fetch,
    async () => {
      await captureAndRecordFindingEvidence(supabase, {
        userId: "user-1",
        moduleKey: "copyright_intel",
        findingSourceTable: "copyright_matches",
        findingId: "cycle-1",
        url: sameUrl,
      });
      await captureAndRecordFindingEvidence(supabase, {
        userId: "user-1",
        moduleKey: "copyright_intel",
        findingSourceTable: "copyright_matches",
        findingId: "cycle-2",
        url: sameUrl,
      });
      await captureAndRecordFindingEvidence(supabase, {
        userId: "user-1",
        moduleKey: "copyright_intel",
        findingSourceTable: "copyright_matches",
        findingId: "cycle-3",
        url: sameUrl,
      });
    },
  );

  const canonical = supabase._store.automated_finding_evidence.filter((r) => r.url === sameUrl);
  assert.equal(canonical.length, 1, "canonical row stays a single idempotent occurrence");

  const history = supabase._store.automated_finding_evidence_captures.filter(
    (r) => r.evidence_id === canonical[0].id,
  );
  assert.equal(history.length, 3, "every capture attempt is retained in the append-only history");
});
