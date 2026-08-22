/**
 * Narrative Intelligence dispatch — pure aggregation over data already
 * collected by Reputation/Channel Watch, zero external API calls, so this
 * is the cheapest module to run and safe on a short cadence.
 */
export interface NarrativeOutcome {
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

export async function runNarrativeIntelForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
): Promise<NarrativeOutcome> {
  const { clusterFindingsCore } = await import("@/lib/mm/narrative.functions");
  try {
    const result = await clusterFindingsCore(supabaseAdmin, userId);
    return {
      status: "COMPLETED",
      candidates_found: result.clusters,
      verified_findings: result.created + result.updated,
      blocked_reason: null,
    };
  } catch (err) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: (err as Error).message?.slice(0, 200) ?? "NARRATIVE_CLUSTERING_FAILED",
    };
  }
}
