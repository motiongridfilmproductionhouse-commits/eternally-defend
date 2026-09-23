import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MAX_SCAN_AGE_MS, planWorkerTick, shouldChain } from "./worker";
import { resolveWorkerOrigin } from "./worker.server";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("server-side scan continuation — planWorkerTick", () => {
  it("advances queued/running scans with a free lease, oldest first", () => {
    const plan = planWorkerTick(
      [
        {
          id: "b",
          status: "running",
          created_at: iso(-60_000),
          started_at: iso(-60_000),
          worker_lease_until: null,
        },
        {
          id: "a",
          status: "queued",
          created_at: iso(-120_000),
          started_at: null,
          worker_lease_until: null,
        },
        {
          id: "done",
          status: "completed",
          created_at: iso(-10_000),
          started_at: null,
          worker_lease_until: null,
        },
      ],
      NOW,
    );
    expect(plan.toAdvance).toEqual(["a", "b"]);
    expect(plan.toExpire).toEqual([]);
  });

  it("never touches a scan whose lease is held (no double-run, no restart)", () => {
    const plan = planWorkerTick(
      [
        {
          id: "x",
          status: "running",
          created_at: iso(-5_000),
          started_at: iso(-5_000),
          worker_lease_until: iso(10_000),
        },
      ],
      NOW,
    );
    expect(plan).toEqual({ toAdvance: [], toExpire: [] });
  });

  it("resumes a scan whose worker died (expired lease) — e.g. browser closed mid-step", () => {
    const plan = planWorkerTick(
      [
        {
          id: "x",
          status: "running",
          created_at: iso(-300_000),
          started_at: iso(-300_000),
          worker_lease_until: iso(-1_000),
        },
      ],
      NOW,
    );
    expect(plan.toAdvance).toEqual(["x"]);
  });

  it("fails honestly instead of looping forever once past the maximum run time", () => {
    const plan = planWorkerTick(
      [
        {
          id: "old",
          status: "running",
          created_at: iso(-DEFAULT_MAX_SCAN_AGE_MS - 1),
          started_at: null,
          worker_lease_until: null,
        },
        {
          id: "old-leased",
          status: "running",
          created_at: iso(-DEFAULT_MAX_SCAN_AGE_MS - 1),
          started_at: null,
          worker_lease_until: iso(5_000),
        },
      ],
      NOW,
    );
    expect(plan.toExpire).toEqual(["old"]);
    expect(plan.toAdvance).toEqual([]);
  });

  it("respects the per-tick limit", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`,
      status: "queued",
      created_at: iso(-i * 1000),
      started_at: null,
      worker_lease_until: null,
    }));
    expect(planWorkerTick(rows, NOW, { limit: 3 }).toAdvance).toHaveLength(3);
  });
});

describe("server-side scan continuation — chaining", () => {
  it("chains only while work remains and progress is being made", () => {
    expect(shouldChain({ remaining: 1, unitsRun: 4, hop: 0 })).toBe(true);
    expect(shouldChain({ remaining: 0, unitsRun: 4, hop: 0 })).toBe(false);
    expect(shouldChain({ remaining: 2, unitsRun: 0, hop: 0 })).toBe(false); // someone else holds it
    expect(shouldChain({ remaining: 2, unitsRun: 3, hop: 240 })).toBe(false); // cron takes over
  });

  it("resolves the worker origin from env first, then the request", () => {
    expect(resolveWorkerOrigin("https://app.example/_serverFn/x", {} as NodeJS.ProcessEnv)).toBe(
      "https://app.example",
    );
    expect(
      resolveWorkerOrigin("https://app.example/x", {
        PROSPECT_SCAN_WORKER_BASE_URL: "https://worker.example/",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("https://worker.example");
    expect(resolveWorkerOrigin(null, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("the hook verifies the managed worker token in the database and the cron job exists", () => {
    const root = join(__dirname, "..", "..", "..");
    const hook = readFileSync(
      join(root, "src/routes/api/public/hooks/prospect-scan-worker.ts"),
      "utf8",
    );
    expect(hook).toMatch(/verifyWorkerToken\(token\)/);
    expect(hook).toMatch(/createWorkerDb\(token\)/);
    expect(hook).not.toMatch(
      /requireTrustedRuntime|authorizeCronRequest|supabase\/client\.server|supabaseAdmin/,
    );
    const sql = readFileSync(
      join(root, "supabase/migrations/20260924091000_prospect_scan_worker_schedule.sql"),
      "utf8",
    );
    expect(sql).toMatch(/'eterna-prospect-scan-worker',\s*'\* \* \* \* \*'/);
    expect(sql).toMatch(/internal_cron_secrets/);
  });

  it("the staff popup no longer drives scans — it is a stall watchdog only", () => {
    const root = join(__dirname, "..", "..", "..");
    const page = readFileSync(join(root, "src/routes/staff.index.tsx"), "utf8");
    expect(page).toMatch(/STALL_MS/);
    expect(page).not.toMatch(/while \(!cancelled\)/);
  });
});
