import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-paths";

const sitemap = readFileSync(join(__dirname, "../../../public/sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>https:\/\/protectbyeterna\.com([^<]*)<\/loc>/g)].map((m) => m[1]);

describe("isPublicPath", () => {
  it("treats every sitemap page as public (light stylesheet only)", () => {
    expect(locs.length).toBeGreaterThan(50);
    expect(locs.filter((p) => !isPublicPath(p))).toEqual([]);
  });
  it("treats /track-case and trailing slashes as public", () => {
    expect(isPublicPath("/track-case")).toBe(true);
    expect(isPublicPath("/monitoring/")).toBe(true);
  });
  it("gives signed-in app screens the full app stylesheet", () => {
    for (const p of ["/dashboard", "/auth", "/staff", "/onboarding", "/partner", "/admin/removal-cases"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
