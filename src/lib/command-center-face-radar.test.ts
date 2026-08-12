/**
 * Privacy contract for the face-linked nodes on the Home radars.
 *
 * Face matches are the identity-linking signal only: no AWS face id,
 * collection id, S3 key, bounding box/landmark data or internal registry id
 * may leave the server in the radar payload.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/lib/command-center.functions.ts", "utf8");

const faceQuery =
  source.match(/\.from\("face_match_events"\)[\s\S]*?\.limit\(\d+\),/)?.[0] ?? "";
const faceNodeBlock = source.match(/const faceNodes =[\s\S]*?\n      \}\);/)?.[0] ?? "";

const FORBIDDEN = [
  "face_id",
  "matched_face_id",
  "collection_id",
  "matched_protected_face_id",
  "s3_key",
  "s3_bucket",
  "image_s3_key",
  "image_s3_bucket",
  "bounding_box",
  "external_image_id",
  "landmark",
  "face_vector",
  "embedding",
];

const ALLOWED_NODE_FIELDS = [
  "id",
  "platform",
  "title",
  "severity",
  "threatScore",
  "reach",
  "permalink",
  "thumbnail",
];

describe("face-linked radar payload", () => {
  it("reads face matches scoped to the signed-in user", () => {
    expect(faceQuery).not.toBe("");
    expect(source).toContain("requireSupabaseAuth");
    expect(faceQuery).toContain('.eq("user_id", userId)');
  });

  it("never selects biometric, collection or storage identifiers", () => {
    for (const forbidden of FORBIDDEN) {
      expect(faceQuery.includes(forbidden), `${forbidden} selected`).toBe(false);
    }
  });

  it("builds nodes only from safe presentation fields", () => {
    expect(faceNodeBlock).not.toBe("");
    for (const forbidden of FORBIDDEN) {
      expect(faceNodeBlock.includes(forbidden), `${forbidden} in node`).toBe(false);
    }
    const emitted = [...faceNodeBlock.matchAll(/^\s{10}([A-Za-z]+):/gm)].map((m) => m[1]!);
    expect(emitted.length).toBeGreaterThan(0);
    for (const key of emitted) {
      expect(ALLOWED_NODE_FIELDS, `unexpected field ${key}`).toContain(key);
    }
  });

  it("derives node severity from the stored category, not similarity", () => {
    expect(faceNodeBlock).toContain("threat_category");
    expect(faceNodeBlock).not.toContain("similarity");
  });

  it("does not write or trigger pipelines from the radar aggregator", () => {
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(source).not.toMatch(/rekognition|firecrawl|serpapi/i);
  });
});
