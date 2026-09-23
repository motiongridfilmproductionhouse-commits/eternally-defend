import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const PROD = "https://eternasentinel.com/api/public/hooks/prospect-scan-worker";

describe("prospect worker routes to production", () => {
  const sql = read("supabase/migrations/20260924121000_prospect_worker_production_origin.sql");

  it("defines the production worker URL once and uses it for cron and the scan-insert kick", () => {
    expect(sql).toContain(`'${PROD}'::text`);
    expect(sql.split(PROD).length - 1).toBe(1); // single source of truth
    expect(sql).not.toMatch(/lovable\.app/);
    expect(sql).toMatch(/cron\.unschedule\('eterna-prospect-scan-worker'\)/);
    expect(sql).toMatch(/cron\.schedule\(\s*'eterna-prospect-scan-worker',\s*'\* \* \* \* \*'/);
    expect((sql.match(/url := public\.prospect_worker_hook_url\(\)/g) ?? []).length).toBe(2);
    expect(sql).toMatch(/CREATE TRIGGER trg_prospect_scans_dispatch_worker/);
  });

  it("keeps the existing managed token (never regenerated) and never exposes it", () => {
    expect(sql).toMatch(/ON CONFLICT \(name\) DO NOTHING/);
    expect(sql).not.toMatch(/UPDATE public\.internal_cron_secrets/i);
    expect(sql).not.toMatch(/DELETE FROM public\.internal_cron_secrets/i);
    expect(sql).not.toMatch(/GRANT[^;]*internal_cron_secrets/i);
    expect(sql).not.toMatch(/SERVICE_ROLE/i);
  });

  it("does not edit the already-merged schedule migration", () => {
    // The original migration still targets the old origin; the forward migration supersedes it.
    expect(read("supabase/migrations/20260924091000_prospect_scan_worker_schedule.sql")).toMatch(
      /lovable\.app/,
    );
  });
});

describe("scan popup covers the search page as soon as a scan id exists", () => {
  const page = read("src/routes/staff.index.tsx");
  const shell = read("src/components/staff/ScanShell.tsx");

  it("renders the initializing / error shell while the snapshot is not loaded", () => {
    expect(page).toMatch(/\(scanId && !snap\) \|\| \(!scanId && start\.isPending\)/);
    expect(page).toMatch(/<ScanShell/);
    expect(shell).toContain("Initializing live intelligence scan…");
    expect(shell).toContain("Unable to load scan");
    expect(shell).toContain("Retry");
    expect(shell).toContain("Return to Search");
    expect(shell).toMatch(/IntelligenceCore/);
    expect(shell).toMatch(/RAIL\.map/);
  });

  it("Retry reloads the same scan id and never starts another scan", () => {
    expect(page).toMatch(/onRetry=\{\(\) => void scan\.refetch\(\)\}/);
    const retryBlock = page.slice(
      page.indexOf("<ScanShell"),
      page.indexOf("/>", page.indexOf("<ScanShell")),
    );
    expect(retryBlock).not.toMatch(/start\.mutate|startFn|rescan/);
  });

  it("the scan id lives in the URL so /staff?scan=<id> reconnects after a refresh", () => {
    expect(page).toMatch(/scan: typeof search\.scan === "string" \? search\.scan : undefined/);
    expect(page).toMatch(/queryFn: \(\) => scanFn\(\{ data: \{ scanId: scanId! \} \}\)/);
  });
});
