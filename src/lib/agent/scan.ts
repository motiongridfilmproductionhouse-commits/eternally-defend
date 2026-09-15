import { estimateProtection, validateProfile, type PricingPolicy } from "./policy.ts";
import type { Assessment, Signals } from "./model.ts";

type Hit = {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  provider?: string;
};
export type ScanDependencies = {
  search: (query: string, signal: AbortSignal) => Promise<Hit[]>;
  successfulQueries: () => number;
  policy: () => Promise<PricingPolicy | null>;
  /** Optional public portrait lookup. Display-only; failure never fails the scan. */
  portrait?: (name: string, signal: AbortSignal) => Promise<string | null>;
  persist: (
    patch: Partial<Assessment> & { discovery?: unknown; policy_snapshot?: unknown },
  ) => Promise<void>;
};
class NoProvidersError extends Error {}
export async function executeAssessmentScan(
  artist: string,
  official: string | null,
  deps: ScanDependencies,
) {
  try {
    await deps.persist({ status: "SCANNING", stage: "Discovering public profiles" });
    const signal = AbortSignal.timeout(25000);
    const queryName = artist.replace(/["\\]/g, " ");
    const hits: Hit[] = [];
    for (const [query, stage] of [
      [`"${queryName}" official profile`, "Discovering public profiles"],
      [
        `"${queryName}"${official ? ` "${new URL(official).hostname}"` : ""}`,
        "Mapping public web presence",
      ],
    ]) {
      await deps.persist({ stage });
      // Providers receive an abort signal; the deadline also bounds adapters that ignore it.
      let onAbort: () => void = () => {};
      try {
        const timeout = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("Discovery timed out"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
        hits.push(...(await Promise.race([deps.search(query, signal), timeout])));
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }
    if (deps.successfulQueries() === 0) throw new NoProvidersError("No discovery provider answered");
    await deps.persist({ status: "ANALYZING", stage: "Analyzing observed web exposure" });
    // Display-only public picture. Never evidence, never affects pricing or gates.
    if (deps.portrait) {
      const image = await deps.portrait(artist, signal).catch(() => null);
      if (image) await deps.persist({ image_url: image });
    }
    const normalize = (s: string) =>
      s
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    const name = normalize(artist);
    const canonical = (url: string) => {
      const u = new URL(url);
      for (const key of [...u.searchParams.keys()])
        if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
      u.searchParams.sort();
      return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search;
    };
    const pages = new Map<string, Hit>();
    for (const hit of hits) {
      let url: string | null = null;
      try {
        url = validateProfile(hit.url);
      } catch {
        continue;
      }
      if (
        !url ||
        !normalize(`${hit.title ?? ""} ${hit.description ?? ""} ${hit.snippet ?? ""}`).includes(
          name,
        )
      )
        continue;
      pages.set(canonical(url), { url, title: hit.title?.slice(0, 500), provider: hit.provider });
    }
    const evidence = [...pages.values()];
    const signals: Signals = {
      matched_pages: evidence.length,
      domains: new Set(evidence.map((h) => new URL(h.url!).hostname.replace(/^www\./, ""))).size,
      official_profile_found: Boolean(official && pages.has(canonical(official))),
      identity_misuse: null,
      ai_misuse: null,
      scope:
        "Name-matched search sample only; not a total web count or verified misuse assessment.",
    };
    await deps.persist({ signals, discovery: evidence, stage: "Estimating monitoring workload" });
    const policy = await deps.policy();
    await deps.persist({ stage: "Calculating protection requirement" });
    const result = estimateProtection(signals, policy);
    await deps.persist({
      ...result,
      policy_snapshot: policy,
      conversion_status: "SCANNED",
      status: result.pricing ? "READY" : "REVIEW_REQUIRED",
      stage: result.pricing ? "Assessment complete" : "Eterna review required",
    });
  } catch (error) {
    await deps.persist({
      status: "FAILED",
      stage: "Scan unavailable",
      pricing: null,
      reason:
        error instanceof NoProvidersError
          ? "Public web search capacity is currently unavailable. No search provider answered, so no assessment was produced. Please try again later."
          : "Scan temporarily unavailable. Please try again.",
    });
  }
}
