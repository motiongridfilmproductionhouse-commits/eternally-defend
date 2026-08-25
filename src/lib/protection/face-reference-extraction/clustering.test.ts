import test from "node:test";
import assert from "node:assert/strict";
import { clusterCandidateFaces, orderClustersByFrequency } from "./clustering.server";

function bytes(label: string): Uint8Array {
  return new TextEncoder().encode(label);
}

/** Fake similarity: same "person" prefix (before '-') => high similarity, else low. */
function fakeCompare(a: Uint8Array, b: Uint8Array): Promise<number> {
  const da = new TextDecoder().decode(a);
  const db = new TextDecoder().decode(b);
  const personA = da.split("-")[0];
  const personB = db.split("-")[0];
  return Promise.resolve(personA === personB ? 96 : 20);
}

test("groups recurring faces of the same person into one cluster, keeps distinct people separate", async () => {
  const candidates = [
    { tileId: "t1", imageBytes: bytes("lena-1") },
    { tileId: "t2", imageBytes: bytes("lena-2") },
    { tileId: "t3", imageBytes: bytes("lena-3") },
    { tileId: "t4", imageBytes: bytes("costar-1") },
    { tileId: "t5", imageBytes: bytes("costar-2") },
    { tileId: "t6", imageBytes: bytes("interviewer-1") },
  ];
  const clusters = await clusterCandidateFaces({ candidates, compareFaces: fakeCompare });

  assert.equal(clusters.length, 3);
  const bySize = orderClustersByFrequency(clusters);
  assert.equal(bySize[0].tileIds.length, 3);
  assert.deepEqual(new Set(bySize[0].tileIds), new Set(["t1", "t2", "t3"]));
  assert.equal(bySize[1].tileIds.length, 2);
  assert.equal(bySize[2].tileIds.length, 1);
});

test("dominant/most-frequent cluster is not implicitly labeled or treated specially by the clustering function itself — it is just the largest group", async () => {
  const candidates = [
    { tileId: "t1", imageBytes: bytes("costar-1") },
    { tileId: "t2", imageBytes: bytes("costar-2") },
    { tileId: "t3", imageBytes: bytes("costar-3") },
    { tileId: "t4", imageBytes: bytes("costar-4") },
    { tileId: "t5", imageBytes: bytes("lena-1") },
  ];
  const clusters = await clusterCandidateFaces({ candidates, compareFaces: fakeCompare });
  const ordered = orderClustersByFrequency(clusters);
  // The dominant cluster here is NOT the protected person (costar appears
  // more often than Lena in this screenshot set) — the clustering output
  // carries no identity claim, only membership. Nothing in this module
  // asserts or infers who is who.
  assert.equal(ordered[0].tileIds.length, 4);
  assert.ok(
    ordered[0].tileIds.every((id) => id.startsWith("t") && ["t1", "t2", "t3", "t4"].includes(id)),
  );
});

test("a single candidate face still forms its own one-member cluster", async () => {
  const clusters = await clusterCandidateFaces({
    candidates: [{ tileId: "solo", imageBytes: bytes("solo-1") }],
    compareFaces: fakeCompare,
  });
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].tileIds, ["solo"]);
});

test("zero candidates yields zero clusters", async () => {
  const clusters = await clusterCandidateFaces({ candidates: [], compareFaces: fakeCompare });
  assert.deepEqual(clusters, []);
});

test("a failed comparison for one pair does not crash clustering — that pair simply stays ungrouped", async () => {
  const flaky = async (a: Uint8Array, b: Uint8Array) => {
    const da = new TextDecoder().decode(a);
    if (da.includes("flaky")) throw new Error("Rekognition transient error");
    return fakeCompare(a, b);
  };
  const clusters = await clusterCandidateFaces({
    candidates: [
      { tileId: "t1", imageBytes: bytes("lena-flaky") },
      { tileId: "t2", imageBytes: bytes("lena-2") },
    ],
    compareFaces: flaky,
  });
  assert.equal(
    clusters.length,
    2,
    "the failed pair falls back to two separate one-member clusters",
  );
});
