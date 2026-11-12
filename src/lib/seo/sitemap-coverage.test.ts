import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every public marketing page must be listed in public/sitemap.xml.
// Non-public / utility routes are listed here explicitly.
const EXCLUDED = new Set([
  "/auth", "/onboarding", "/agent", "/agent-admin", "/agent-assessment", "/partner-status",
  "/track-case", "/waitinglist", "/impersonation-protection", "/staff",
]);
const routesDir = join(__dirname, "../../routes");
const sitemap = readFileSync(join(__dirname, "../../../public/sitemap.xml"), "utf8");

function publicPaths() {
  return readdirSync(routesDir)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .filter((f) => !/^(_|__root|api|staff|verify\.|face-handoff)/.test(f) && !f.includes("$"))
    .map((f) => {
      const base = f.replace(/\.tsx$/, "");
      if (base === "index") return "/";
      return "/" + base.replace(/^newsroom_\./, "newsroom/");
    })
    .filter((p) => !EXCLUDED.has(p));
}

describe("sitemap.xml", () => {
  it("lists every public page", () => {
    const missing = publicPaths().filter(
      (p) => !sitemap.includes(`<loc>https://protectbyeterna.com${p}</loc>`),
    );
    expect(missing).toEqual([]);
  });
  it("gives every URL a YYYY-MM-DD lastmod and no changefreq/priority", () => {
    const urls = sitemap.match(/<url>.*?<\/url>/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    expect(sitemap).not.toMatch(/changefreq|priority/);
  });
  it("includes /remove-content", () => {
    expect(sitemap).toContain("<loc>https://protectbyeterna.com/remove-content</loc>");
  });
});
