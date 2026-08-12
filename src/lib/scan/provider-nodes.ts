/**
 * Shared, pure mapping from real scan diagnostics to ScanRadar provider-node
 * states. Used both server-side (src/routes/api/scan.ts, for the final
 * progress checkpoint) and client-side (src/routes/_app.scan.tsx, for the
 * post-completion reveal) so the two never drift into different rules for
 * what counts as "complete" vs "degraded" vs "failed". Source type never
 * determines state — only real health/outcome data does.
 */
import type { DiscoveryRouterReport } from "./discovery/types";
import type { ExtractionStats } from "./page-extract-types";
import type { ScanAiDiagnostics } from "./openai/types";

export type ProviderNodeState = "waiting" | "active" | "complete" | "degraded" | "failed";

export interface ProviderNode {
  key: string;
  label: string;
  state: ProviderNodeState;
}

export const CONTENT_SOURCE_NODES: Array<{ key: string; nodeKey: string; label: string }> = [
  { key: "youtube", nodeKey: "youtube", label: "YouTube" },
  { key: "reddit", nodeKey: "reddit", label: "Reddit" },
  { key: "news", nodeKey: "news", label: "News" },
  { key: "web", nodeKey: "web", label: "Web" },
  { key: "forums", nodeKey: "forums", label: "Forums" },
  { key: "blogs", nodeKey: "blogs", label: "Blogs" },
];

export const INFRA_PROVIDER_NODES: Array<{ nodeKey: string; label: string }> = [
  { nodeKey: "serpapi", label: "SerpApi" },
  { nodeKey: "brave", label: "Brave" },
  { nodeKey: "gemini_grounding", label: "Gemini Grounding" },
  { nodeKey: "openai_research", label: "OpenAI Research" },
  { nodeKey: "crawl4ai", label: "Crawl4AI" },
];

export interface YoutubeDiagLite {
  status?: "ok" | "quota_exhausted" | "no_results" | "disabled";
}

/** Coarse nodes for while a scan is in flight — only "was this requested?" is known. */
export function coarseProviderNodes(requestedSources: string[]): ProviderNode[] {
  const requested = new Set(requestedSources.map((s) => s.toLowerCase()));
  return [
    ...CONTENT_SOURCE_NODES.map(({ nodeKey, label, key }) => ({
      key: nodeKey,
      label,
      state: (requested.has(key) ? "active" : "waiting") as ProviderNodeState,
    })),
    ...INFRA_PROVIDER_NODES.map(({ nodeKey, label }) => ({
      key: nodeKey,
      label,
      state: "active" as ProviderNodeState,
    })),
  ];
}

/** Final, real per-provider outcome once discovery/extraction/AI diagnostics are fully computed. */
export function finalProviderNodes(input: {
  sourcesRequested: string[];
  sourcesReturned: string[];
  youtube?: YoutubeDiagLite | null;
  providers?: DiscoveryRouterReport | null;
  extraction?: ExtractionStats | null;
  openai?: ScanAiDiagnostics | null;
}): ProviderNode[] {
  const returned = new Set(input.sourcesReturned.map((s) => s.toLowerCase()));
  const requested = new Set(input.sourcesRequested.map((s) => s.toLowerCase()));

  const contentState = (nodeKey: string): ProviderNodeState => {
    if (nodeKey === "youtube" && input.youtube) {
      switch (input.youtube.status) {
        case "ok":
        case "no_results":
          return "complete";
        case "quota_exhausted":
          return "degraded";
        default:
          return "waiting";
      }
    }
    if (!requested.has(nodeKey)) return "waiting";
    // Requested-but-zero-matches is a valid, non-failed outcome.
    return returned.has(nodeKey) ? "complete" : "complete";
  };

  const providerHealthFor = (id: string) =>
    input.providers?.providers.find((p) => p.provider === id);

  const infraState = (nodeKey: string): ProviderNodeState => {
    if (nodeKey === "crawl4ai") {
      const ex = input.extraction;
      if (!ex || !ex.CRAWL4AI_CONFIGURED) return "waiting";
      if (ex.CRAWL4AI_SUCCESS > 0) return ex.CRAWL4AI_FAILED > 0 ? "degraded" : "complete";
      return ex.CRAWL4AI_FAILED > 0 ? "failed" : "waiting";
    }
    if (nodeKey === "openai_research") {
      const status = input.openai?.research_status;
      if (!status || status === "SKIPPED" || status === "DISABLED") return "waiting";
      if (status === "OK") return "complete";
      return "degraded";
    }
    const health = providerHealthFor(nodeKey);
    if (!health || !health.configured) return "waiting";
    switch (health.state) {
      case "HEALTHY":
        return "complete";
      case "NOT_CONFIGURED":
        return "waiting";
      case "CREDITS_EXHAUSTED":
      case "RATE_LIMITED":
      case "TIMEOUT":
        return "degraded";
      case "AUTH_FAILED":
      case "UNAVAILABLE":
        return "failed";
      default:
        return "waiting";
    }
  };

  return [
    ...CONTENT_SOURCE_NODES.map(({ nodeKey, label }) => ({
      key: nodeKey,
      label,
      state: contentState(nodeKey),
    })),
    ...INFRA_PROVIDER_NODES.map(({ nodeKey, label }) => ({
      key: nodeKey,
      label,
      state: infraState(nodeKey),
    })),
  ];
}
