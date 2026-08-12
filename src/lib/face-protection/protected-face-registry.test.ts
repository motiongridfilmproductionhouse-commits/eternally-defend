import { describe, expect, it } from "vitest";
import {
  FACE_MATCH_SIMILARITY_THRESHOLD,
  assertOwnedProtectedFace,
  buildEnrollmentFaceRow,
  classifyManualMatch,
  filterActiveProtectedFaces,
  reviewStatusForVerdict,
  scannerToneForVerdict,
} from "./protected-face-registry";
import { resolveActiveFaceMonitoring } from "./monitoring.server";

const verifiedAt = "2026-08-12T21:00:00.000Z";

function enrollmentRow(overrides: Partial<Parameters<typeof buildEnrollmentFaceRow>[0]> = {}) {
  return buildEnrollmentFaceRow({
    userId: "user-1",
    collectionId: "eterna_user1",
    faceId: "face-abc",
    imageId: "img-1",
    externalImageId: "user_1",
    confidence: 99.4,
    boundingBox: { Width: 0.3 },
    s3Bucket: "eterna-private",
    s3Key: "clients/user-1/reference/liveness/s1.jpg",
    label: "Sarayu Mohan",
    verifiedAt,
    ...overrides,
  });
}

/** Minimal supabase query stub for the monitoring resolver. */
function supabaseStub(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const rows = (tables[table] ?? []) as Record<string, unknown>[];
      let filtered = [...rows];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filtered = filtered.filter((r) => r[col] === val);
          return builder;
        },
        maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: filtered, error: null }),
      };
      return builder;
    },
  };
}

describe("enrollment persistence", () => {
  it("persists an ACTIVE protected face reference from a successful enrollment", () => {
    const row = enrollmentRow();
    expect(row).toMatchObject({
      user_id: "user-1",
      collection_id: "eterna_user1",
      face_id: "face-abc",
      status: "ACTIVE",
      source: "liveness_enrollment",
      label: "Sarayu Mohan",
      last_verified_at: verifiedAt,
    });
  });

  it("stores only the private S3 object key, never image bytes", () => {
    const row = enrollmentRow();
    expect(row.s3_key).toBe("clients/user-1/reference/liveness/s1.jpg");
    expect(JSON.stringify(row)).not.toContain("base64");
  });

  it("falls back to a neutral label when no display name exists", () => {
    expect(enrollmentRow({ label: "   " }).label).toBe("Verified liveness reference");
  });
});

describe("active reference resolution", () => {
  it("resolves ACTIVE protected faces for the automatic pipeline", async () => {
    const result = await resolveActiveFaceMonitoring(
      supabaseStub({
        protected_faces: [
          {
            id: "pf-1",
            user_id: "user-1",
            face_id: "face-abc",
            collection_id: "eterna_user1",
            status: "ACTIVE",
          },
        ],
      }) as never,
      "user-1",
    );
    expect(result.collectionId).toBe("eterna_user1");
    expect(result.activeFaceIds).toEqual(["face-abc"]);
  });

  it("excludes deactivated references from future monitoring", async () => {
    const result = await resolveActiveFaceMonitoring(
      supabaseStub({
        protected_faces: [
          {
            id: "pf-1",
            user_id: "user-1",
            face_id: "face-abc",
            collection_id: "eterna_user1",
            status: "INACTIVE",
          },
        ],
        rekognition_collections: [{ user_id: "user-1", collection_id: "eterna_user1" }],
      }) as never,
      "user-1",
    );
    expect(result.activeFaceIds).toEqual([]);
  });

  it("returns no collection when enrollment never succeeded", async () => {
    const result = await resolveActiveFaceMonitoring(supabaseStub({}) as never, "user-1");
    expect(result.collectionId).toBeNull();
    expect(result.activeFaceIds).toEqual([]);
  });

  it("filters inactive rows defensively", () => {
    const faces = [
      { id: "a", face_id: "f1", collection_id: "c", status: "ACTIVE" },
      { id: "b", face_id: "f2", collection_id: "c", status: "INACTIVE" },
    ];
    expect(filterActiveProtectedFaces(faces).map((f) => f.id)).toEqual(["a"]);
  });
});

describe("ownership", () => {
  it("rejects another account's protected face", () => {
    expect(() =>
      assertOwnedProtectedFace(
        { id: "pf-1", user_id: "other-user", face_id: "f", collection_id: "c" },
        "user-1",
      ),
    ).toThrow(/not found/i);
  });

  it("accepts the owner's protected face", () => {
    const face = { id: "pf-1", user_id: "user-1", face_id: "f", collection_id: "c" };
    expect(assertOwnedProtectedFace(face, "user-1")).toBe(face);
  });
});

describe("manual scan verdicts use real backend values", () => {
  it("returns MATCH with the AWS similarity when above threshold", () => {
    const r = classifyManualMatch({ faceDetected: true, faceConfidence: 99.8, similarity: 93.2 });
    expect(r.verdict).toBe("MATCH");
    expect(r.similarity).toBe(93.2);
    expect(FACE_MATCH_SIMILARITY_THRESHOLD).toBe(80);
  });

  it("keeps a no-match as NO_MATCH without inventing a percentage", () => {
    const r = classifyManualMatch({ faceDetected: true, faceConfidence: 99.5, similarity: null });
    expect(r.verdict).toBe("NO_MATCH");
    expect(r.similarity).toBeNull();
  });

  it("reports NO_MATCH when no face was detected at all", () => {
    const r = classifyManualMatch({ faceDetected: false, faceConfidence: null, similarity: null });
    expect(r).toMatchObject({ verdict: "NO_MATCH", reason: "no_face_detected" });
  });

  it("flags NEEDS_REVIEW only on real low quality or borderline similarity", () => {
    expect(
      classifyManualMatch({ faceDetected: true, faceConfidence: 74, similarity: null }).verdict,
    ).toBe("NEEDS_REVIEW");
    expect(
      classifyManualMatch({ faceDetected: true, faceConfidence: 99, similarity: 71.5 }).verdict,
    ).toBe("NEEDS_REVIEW");
    expect(
      classifyManualMatch({ faceDetected: true, faceConfidence: 99, similarity: 51 }).verdict,
    ).toBe("NO_MATCH");
  });

  it("only records a review event for match/review verdicts", () => {
    expect(reviewStatusForVerdict("MATCH")).toBe("pending");
    expect(reviewStatusForVerdict("NEEDS_REVIEW")).toBe("pending");
    expect(reviewStatusForVerdict("NO_MATCH")).toBeNull();
  });

  it("drives the scanner colour from the backend verdict only", () => {
    expect(scannerToneForVerdict("SCANNING")).toBe("blue");
    expect(scannerToneForVerdict("NO_MATCH")).toBe("blue");
    expect(scannerToneForVerdict("NEEDS_REVIEW")).toBe("amber");
    expect(scannerToneForVerdict("MATCH")).toBe("red");
  });
});
