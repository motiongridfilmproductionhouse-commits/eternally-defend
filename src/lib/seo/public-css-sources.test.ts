import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// styles.css only scans public-page sources for Tailwind classes. If a public
// page imports a component from elsewhere, its classes would silently vanish
// from the public stylesheet. This walks the import graph of every sitemap
// page and checks each file is covered by styles.css's @source rules.
const SRC = resolve(__dirname, "../..");
const css = readFileSync(join(SRC, "styles.css"), "utf8");
const includes = [...css.matchAll(/^@source "\.\/([^"]+)";/gm)].map((m) => m[1]);
const excludes = [...css.matchAll(/^@source not "\.\/([^"]+)";/gm)].map((m) => m[1]);

const matches = (rel: string, pat: string) =>
  pat.endsWith("*") ? rel.startsWith(pat.slice(0, -1)) : rel === pat || rel.startsWith(pat + "/");
const covered = (rel: string) =>
  includes.some((p) => matches(rel, p)) && !excludes.some((p) => matches(rel, p));

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (/\.(tsx?)$/.test(c) && existsSync(c)) return c;
  }
  return null;
}

function routeFile(path: string): string {
  const slug = path === "/" ? "index" : path.slice(1).replace(/^newsroom\//, "newsroom_.");
  return join(SRC, "routes", `${slug}.tsx`);
}

describe("public stylesheet sources", () => {
  it("cover every file imported by public pages", () => {
    const sitemap = readFileSync(join(SRC, "../public/sitemap.xml"), "utf8");
    const paths = [...sitemap.matchAll(/<loc>https:\/\/protectbyeterna\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
    const queue = [...paths, "/track-case"].map(routeFile).filter(existsSync);
    expect(queue.length).toBeGreaterThan(50);
    const seen = new Set<string>();
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const code = readFileSync(f, "utf8");
      for (const m of code.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
        const r = resolveImport(f, m[1] ?? m[2]);
        if (r && !seen.has(r)) queue.push(r);
      }
    }
    const uncovered = [...seen]
      .map((f) => relative(SRC, f))
      .filter((rel) => !rel.startsWith("integrations/") && !/\.(server|functions|schema)\.ts$/.test(rel))
      .filter((rel) => !covered(rel));
    expect(uncovered).toEqual([]);
  });
});
