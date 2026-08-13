import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const PRODUCTION_FILES = walk(SRC);

describe("no hard-coded demo profile in the production path", () => {
  for (const needle of ["Sreehari", "Eterna Labs"]) {
    it(`does not contain "${needle}"`, () => {
      const offenders = PRODUCTION_FILES.filter((f) => readFileSync(f, "utf8").includes(needle));
      expect(offenders).toEqual([]);
    });
  }

  it("does not seed a demo organization or role in Settings", () => {
    const settings = readFileSync(join(SRC, "routes", "_app.settings.tsx"), "utf8");
    expect(settings).not.toMatch(/defaultValue=/);
    expect(settings).not.toContain("Founder");
  });
});

describe("account isolation in profile server functions", () => {
  const source = readFileSync(join(SRC, "lib", "profile", "account-profile.functions.ts"), "utf8");

  it("requires an authenticated session", () => {
    expect(source).toContain("requireSupabaseAuth");
  });

  it("scopes every profile query to the authenticated user id", () => {
    const eqCalls = source.match(/\.eq\((.+?)\)/g) ?? [];
    expect(eqCalls.length).toBeGreaterThan(0);
    for (const call of eqCalls) {
      expect(call).toBe('.eq("user_id", userId)');
    }
  });

  it("never selects by row order or a client-supplied identity", () => {
    expect(source).not.toMatch(/\.order\(/);
    expect(source).not.toMatch(/\.limit\(1\)/);
    expect(source).not.toMatch(/data\.(user_id|client_id)/);
  });
});

describe("per-user cache keys and logout teardown", () => {
  it("keys the settings profile query by the authenticated user id", () => {
    const settings = readFileSync(join(SRC, "routes", "_app.settings.tsx"), "utf8");
    expect(settings).toContain('queryKey: ["account-profile", userId ?? "anon"]');
  });

  it("clears cached queries on sign out", () => {
    const sidebar = readFileSync(join(SRC, "components", "dashboard", "Sidebar.tsx"), "utf8");
    const signOut = sidebar.slice(sidebar.indexOf("const signOut"));
    expect(signOut).toContain("queryClient.clear()");
    expect(signOut).toContain("cancelQueries");
  });
});
