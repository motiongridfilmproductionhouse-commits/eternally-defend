/**
 * High-Risk Source Registry for Deepfake Intelligence.
 *
 * Maintains proven high-risk source domains where celebrity synthetic/explicit
 * impersonation media is distributed. Future scans dynamically query these domains first.
 */

export interface HighRiskSourceEntry {
  hostname: string;
  source_domain: string;
  discovery_provider: string;
  exact_discovery_query: string;
  first_seen_at: string;
  last_seen_at: string;
  qualified_finding_count: number;
}

export type FindingOrigin =
  | "REAL_NETWORK_DISCOVERY"
  | "TEST_FIXTURE"
  | "MANUAL_EVIDENCE"
  | "HISTORICAL_FINDING";

export const SEED_HIGH_RISK_DOMAINS: string[] = [
  "desifakes.com",
  "imgfy.net",
  "desifakes-com.zproxy.org",
];

const registry = new Map<string, HighRiskSourceEntry>();

// Initialize registry with seed domains
function initializeSeedRegistry() {
  const now = new Date().toISOString();
  for (const domain of SEED_HIGH_RISK_DOMAINS) {
    const key = domain.toLowerCase().trim();
    if (!registry.has(key)) {
      registry.set(key, {
        hostname: key,
        source_domain: key,
        discovery_provider: "seed",
        exact_discovery_query: `site:${key}`,
        first_seen_at: now,
        last_seen_at: now,
        qualified_finding_count: 1,
      });
    }
  }
}

initializeSeedRegistry();

export function normalizeHostname(urlOrHost: string): string {
  try {
    const raw = urlOrHost.includes("://") ? new URL(urlOrHost).hostname : urlOrHost;
    return raw.toLowerCase().replace(/^www\./, "").trim();
  } catch {
    return urlOrHost.toLowerCase().replace(/^www\./, "").trim();
  }
}

export function determineLeadOrigin(
  url: string,
  source?: string,
): FindingOrigin {
  const host = normalizeHostname(url);
  if (host.includes("synthetic-hosting-hub.com") || host.includes("ai-mirror-node.net")) {
    return "TEST_FIXTURE";
  }
  if (source === "manual_evidence" || source === "manual") {
    return "MANUAL_EVIDENCE";
  }
  if (source === "historical" || source === "historical_seed") {
    return "HISTORICAL_FINDING";
  }
  return "REAL_NETWORK_DISCOVERY";
}

/**
 * Returns all active high-risk domains, starting with proven domains sorted by finding count.
 */
export function getHighRiskSourceDomains(): string[] {
  const entries = Array.from(registry.values());
  entries.sort((a, b) => b.qualified_finding_count - a.qualified_finding_count);
  return Array.from(new Set(entries.map((e) => e.hostname)));
}

/**
 * Records or updates a proven high-risk domain when a qualified target finding is confirmed.
 */
export function recordQualifiedDomainFinding(input: {
  hostname: string;
  provider?: string;
  query?: string;
}): HighRiskSourceEntry {
  const normHost = normalizeHostname(input.hostname);
  if (!normHost) {
    throw new Error("Invalid hostname provided to High-Risk Source Registry");
  }

  const now = new Date().toISOString();
  const existing = registry.get(normHost);

  if (existing) {
    existing.last_seen_at = now;
    existing.qualified_finding_count += 1;
    if (input.provider) existing.discovery_provider = input.provider;
    if (input.query) existing.exact_discovery_query = input.query;
    return existing;
  }

  const entry: HighRiskSourceEntry = {
    hostname: normHost,
    source_domain: normHost,
    discovery_provider: input.provider ?? "firecrawl",
    exact_discovery_query: input.query ?? `site:${normHost}`,
    first_seen_at: now,
    last_seen_at: now,
    qualified_finding_count: 1,
  };

  registry.set(normHost, entry);
  return entry;
}

/**
 * Generates Tier 1 site-specific queries for a given target across known high-risk domains.
 */
export function generateHighRiskSiteQueries(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
}): string[] {
  const targets = Array.from(
    new Set(
      [input.name, ...(input.aliases ?? []), ...(input.handles ?? []).map((h) => h.replace(/^@/, ""))]
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );

  const domains = getHighRiskSourceDomains();
  const queries: string[] = [];

  for (const domain of domains) {
    for (const target of targets) {
      const quoteTarget = `"${target.replaceAll('"', "").trim()}"`;
      queries.push(
        `site:${domain} ${quoteTarget}`,
        `site:${domain} ${quoteTarget} deepfake`,
        `site:${domain} ${quoteTarget} fake`,
        `site:${domain} ${quoteTarget} nude`,
      );
    }
  }

  return Array.from(new Set(queries));
}
