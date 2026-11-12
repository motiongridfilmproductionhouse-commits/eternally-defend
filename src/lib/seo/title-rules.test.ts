import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every public page title: "<keyword> | Eterna Sentinel" or "<keyword> | Eterna", max 60 chars.
const sitemap = readFileSync("public/sitemap.xml", "utf8");
const paths = [...sitemap.matchAll(/<loc>https:\/\/protectbyeterna\.com([^<]*)<\/loc>/g)].map((m) => m[1] || "/");

function routeFile(path: string) {
  if (path === "/") return "src/routes/index.tsx";
  const p = path.replace(/^\//, "");
  return p.startsWith("newsroom/") ? `src/routes/newsroom_.${p.slice(9)}.tsx` : `src/routes/${p}.tsx`;
}

function pageTitle(src: string) {
  const constTitle = src.match(/const TITLE = "([^"]+)"/)?.[1];
  const head = src.slice(Math.max(src.indexOf("head:"), 0));
  const m = head.match(/title:\s*("[^"]+"|TITLE)/);
  return m?.[1] === "TITLE" ? constTitle : m?.[1]?.slice(1, -1);
}

describe("public page titles", () => {
  for (const path of paths) {
    it(`${path} follows the title pattern`, () => {
      const title = pageTitle(readFileSync(routeFile(path), "utf8"));
      expect(title, path).toBeDefined();
      expect(title!.length).toBeLessThanOrEqual(60);
      // About and Contact lead with the brand by request.
      if (path === "/about" || path === "/contact") expect(title).toMatch(/^.*Eterna Sentinel \| /);
      else expect(title).toMatch(/ \| Eterna( Sentinel)?$/);
    });
  }
  it("homepage title is the agreed keyword title", () => {
    expect(pageTitle(readFileSync("src/routes/index.tsx", "utf8"))).toBe(
      "Digital Identity & Deepfake Protection | Eterna Sentinel",
    );
  });
});
