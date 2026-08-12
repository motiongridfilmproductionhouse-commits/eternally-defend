/**
 * Integration test for the discovery -> protected-face match bridge.
 *
 * AWS + storage are mocked; the Supabase client is a small in-memory fake so
 * eligibility, ownership and dedupe rules are verified end-to-end without
 * touching the real collection or database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchFacesByImage = vi.fn();

vi.mock("./aws/s3.server", () => ({
  fetchImageBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" })),
  putObject: vi.fn(async () => undefined),
  getBucket: () => "eterna-evidence",
}));

vi.mock("./aws/rekognition.server", () => ({
  searchFacesByImage: (...args: unknown[]) => searchFacesByImage(...args),
}));

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const HIT = "33333333-3333-3333-3333-333333333333";

type Row = Record<string, unknown>;

function makeSupabase(seed: {
  protected_faces: Row[];
  face_match_events?: Row[];
  scan_hits?: Row[];
}) {
  const db: Record<string, Row[]> = {
    protected_faces: seed.protected_faces,
    face_match_events: seed.face_match_events ?? [],
    scan_hits: seed.scan_hits ?? [{ id: HIT, severity: "low", risk_type: null, tags: [], threat_score: 5 }],
    rekognition_collections: [{ user_id: USER, collection_id: "eterna-client-USER" }],
    protected_face_profiles: [],
    deepfake_findings: [],
  };

  function query(table: string) {
    let rows = [...(db[table] ?? [])];
    const api: Record<string, unknown> = {};
    const chain = () => api as never;
    Object.assign(api, {
      select: () => chain(),
      order: () => chain(),
      limit: () => chain(),
      gte: () => chain(),
      or: () => chain(),
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return chain();
      },
      in: (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col] as never));
        return chain();
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: async (payload: Row) => {
        db[table]!.push({ id: `evt-${db[table]!.length + 1}`, ...payload });
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows, error: null }),
    });
    return api as never;
  }

  return { client: { from: (t: string) => query(t) }, db };
}

async function run(supabase: unknown) {
  const { analyzeHitForFaces } = await import("./face-scan.server");
  return analyzeHitForFaces({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    userId: USER,
    scanHitId: HIT,
    imageUrl: "https://example.com/news-photo.jpg",
    sourceType: "news",
  });
}

beforeEach(() => {
  searchFacesByImage.mockReset();
});

describe("analyzeHitForFaces eligibility", () => {
  it("only uses ACTIVE protected faces of the authenticated user", async () => {
    searchFacesByImage.mockResolvedValue({
      matches: [
        { faceId: "face-active", similarity: 96 },
        { faceId: "face-inactive", similarity: 95 },
      ],
      searchedFaceConfidence: 99,
      searchedFaceBoundingBox: null,
    });
    const { client, db } = makeSupabase({
      protected_faces: [
        { id: "pf-1", user_id: USER, face_id: "face-active", collection_id: "col", status: "ACTIVE" },
        { id: "pf-2", user_id: USER, face_id: "face-inactive", collection_id: "col", status: "INACTIVE" },
      ],
    });

    const res = await run(client);
    expect(res).toMatchObject({ ok: true, matches: 1 });
    expect(db.face_match_events).toHaveLength(1);
    expect(db.face_match_events![0]!.matched_face_id).toBe("face-active");
    expect(db.face_match_events![0]!.user_id).toBe(USER);
  });

  it("does not insert a duplicate event for the same scan hit and face", async () => {
    searchFacesByImage.mockResolvedValue({
      matches: [{ faceId: "face-active", similarity: 96 }],
      searchedFaceConfidence: 99,
      searchedFaceBoundingBox: null,
    });
    const { client, db } = makeSupabase({
      protected_faces: [
        { id: "pf-1", user_id: USER, face_id: "face-active", collection_id: "col", status: "ACTIVE" },
      ],
      face_match_events: [
        { id: "evt-existing", user_id: USER, scan_hit_id: HIT, matched_face_id: "face-active" },
      ],
    });

    const res = await run(client);
    expect(res).toMatchObject({ ok: true, matches: 0 });
    expect(db.face_match_events).toHaveLength(1);
  });

  it("never creates an event from another user's protected face", async () => {
    searchFacesByImage.mockResolvedValue({
      matches: [{ faceId: "face-of-other-user", similarity: 99 }],
      searchedFaceConfidence: 99,
      searchedFaceBoundingBox: null,
    });
    const { client, db } = makeSupabase({
      protected_faces: [
        {
          id: "pf-other",
          user_id: OTHER,
          face_id: "face-of-other-user",
          collection_id: "col",
          status: "ACTIVE",
        },
      ],
    });

    const res = await run(client);
    expect(res).toMatchObject({ ok: false, reason: "no_active_faces" });
    expect(db.face_match_events).toHaveLength(0);
  });
});
