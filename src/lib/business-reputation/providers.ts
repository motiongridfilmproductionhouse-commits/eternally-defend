export type ProviderOutcome<T> = {
  provider: string;
  status: "fulfilled" | "rejected";
  results: T[];
  error?: string;
};

export function combineBusinessProviderResults<T>(outcomes: ProviderOutcome<T>[]) {
  const successful = outcomes.filter((x) => x.status === "fulfilled");
  const failed = outcomes.filter((x) => x.status === "rejected");
  const results = successful.flatMap((x) => x.results);
  const status =
    successful.length === 0 ? "failed" : failed.length ? "completed_with_warnings" : "completed";
  return {
    status,
    results,
    warnings: failed.map((x) => `${x.provider} unavailable`),
    customerError: successful.length
      ? null
      : "Business Reputation discovery is temporarily unavailable. Please try again.",
  } as const;
}

export function capProviderResults<T>(results: T[], maxResults: number): T[] {
  return results.slice(0, Math.max(0, maxResults));
}
