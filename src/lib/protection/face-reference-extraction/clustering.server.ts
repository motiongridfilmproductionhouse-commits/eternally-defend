/**
 * Groups visually similar candidate faces (from Path C protected-asset
 * bootstrap) into clusters for human review — NOT identity proof. This is
 * pure grouping by recurring appearance; it never decides who anyone is.
 * The largest/most-frequent cluster is surfaced first purely as a review
 * convenience (task item 3) — nothing here ever auto-selects or auto-trusts
 * a cluster. Frequency is presented to the admin, never used to promote.
 *
 * Comparison is injected (never calls AWS directly) so this stays a pure,
 * fast, fully unit-testable module — see clustering.test.ts.
 */

export interface ClusterCandidate {
  tileId: string;
  imageBytes: Uint8Array;
}

export interface FaceCluster {
  tileIds: string[];
  /** First-encountered tile in the cluster — a display convenience only, never a trust signal. */
  representativeTileId: string;
}

export const DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 90;

class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/**
 * Groups candidates whose pairwise similarity clears the threshold into the
 * same cluster (transitive: if A~B and B~C both clear the threshold, A/B/C
 * end up in one cluster even if A~C alone doesn't — deliberately a bit
 * generous for review purposes; the admin sees every representative example
 * before confirming, so an over-eager grouping just means one extra look,
 * never an auto-trust mistake).
 */
export async function clusterCandidateFaces(input: {
  candidates: ClusterCandidate[];
  compareFaces: (a: Uint8Array, b: Uint8Array) => Promise<number>;
  similarityThreshold?: number;
}): Promise<FaceCluster[]> {
  const { candidates, compareFaces } = input;
  const threshold = input.similarityThreshold ?? DEFAULT_CLUSTER_SIMILARITY_THRESHOLD;

  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    return [{ tileIds: [candidates[0].tileId], representativeTileId: candidates[0].tileId }];
  }

  const uf = new UnionFind(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (uf.find(i) === uf.find(j)) continue; // already grouped, skip the redundant compare
      let similarity = 0;
      try {
        similarity = await compareFaces(candidates[i].imageBytes, candidates[j].imageBytes);
      } catch {
        continue; // a single failed comparison just means these two stay ungrouped, not fatal
      }
      if (similarity >= threshold) uf.union(i, j);
    }
  }

  const groups = new Map<number, string[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = uf.find(i);
    const group = groups.get(root) ?? [];
    group.push(candidates[i].tileId);
    groups.set(root, group);
  }

  return [...groups.values()].map((tileIds) => ({ tileIds, representativeTileId: tileIds[0] }));
}

/** Largest-first, purely for presentation order — never a trust decision. */
export function orderClustersByFrequency(clusters: FaceCluster[]): FaceCluster[] {
  return [...clusters].sort((a, b) => b.tileIds.length - a.tileIds.length);
}
