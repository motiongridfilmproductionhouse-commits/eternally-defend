import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/celebrity/radar.functions.ts", "utf8");

describe("getCelebrityRadarState contract", () => {
  it("is authenticated and read-only", () => {
    expect(source).toContain("requireSupabaseAuth");
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it("scopes every findings table read to the signed-in user", () => {
    const tables = source.match(/\.from\("([a-z_]+)"\)/g) ?? [];
    expect(tables.length).toBeGreaterThan(5);
    // one .eq("user_id", userId) per table read
    const scoped = source.match(/\.eq\("user_id", userId\)/g) ?? [];
    expect(scoped.length).toBe(tables.length);
  });

  it("never selects biometric or storage identifiers", () => {
    for (const forbidden of [
      "face_id",
      "collection_id",
      "s3_key",
      "s3_bucket",
      "image_s3_key",
      "matched_face_id",
      "bounding_box",
      "external_image_id",
    ]) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  it("does not create or trigger scans", () => {
    expect(source).not.toMatch(/rekognition|firecrawl|serpapi|brightdata/i);
  });
});
