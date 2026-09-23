import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The staff pre-enrollment feature must run with only SUPABASE_URL and
 * SUPABASE_PUBLISHABLE_KEY. No prospect code path may reach the service-role
 * client, the service-role key, or helpers that require it.
 */
const root = join(__dirname, "..", "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

const featureFiles = [
  ...walk(join(root, "src/lib/prospect")),
  ...walk(join(root, "src/components/staff")),
  join(root, "src/routes/staff.tsx"),
  join(root, "src/routes/staff.index.tsx"),
  join(root, "src/routes/staff.report.$scanId.tsx"),
  join(root, "src/routes/api/public/hooks/prospect-scan-worker.ts"),
].filter((f) => !f.endsWith(".test.ts"));

const FORBIDDEN =
  /integrations\/supabase\/client\.server|supabaseAdmin|SUPABASE_SERVICE_ROLE_KEY|requireTrustedRuntime|authorizeCronRequest/;

describe("staff pre-enrollment feature has no service-role dependency", () => {
  it("no feature file references the service-role client, key or helpers that need it", () => {
    const offenders = featureFiles.filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the onboarding hooks call the consumer with the user's own session", () => {
    for (const f of [
      "src/lib/onboarding/progress.functions.ts",
      "src/lib/onboarding/v2-profile.functions.ts",
    ]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src).toMatch(/applyMyPreEnrollmentPackagesSafely\(supabase, userId\)/);
    }
  });

  it("signup is untouched by the pre-enrollment feature", () => {
    const src = readFileSync(join(root, "src/lib/invites/invites.functions.ts"), "utf8");
    expect(src).not.toMatch(/prospect/);
  });

  it("the worker credential never leaves the database or reaches a browser bundle", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/20260924120000_prospect_without_service_role.sql"),
      "utf8",
    );
    // Token compared inside SECURITY DEFINER functions; no grant on the secrets table.
    expect(sql).toMatch(
      /FUNCTION public\.prospect_worker_token_valid\(_token text\)[\s\S]*SECURITY DEFINER/,
    );
    expect(sql).not.toMatch(/GRANT[^;]*internal_cron_secrets/i);
    // Client-side code never names the token or its header.
    const clientFiles = [
      ...walk(join(root, "src/components")),
      join(root, "src/routes/staff.index.tsx"),
      join(root, "src/routes/onboarding.tsx"),
    ];
    const leaks = clientFiles.filter((f) =>
      /prospect_scan_worker|x-prospect-worker-token|internal_cron_secrets/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(leaks).toEqual([]);
  });
});
