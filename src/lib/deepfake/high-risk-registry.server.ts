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
  "REAL_NETWORK_DISCOVERY" | "TEST_FIXTURE" | "MANUAL_EVIDENCE" | "HISTORICAL_FINDING";

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
    return raw
      .toLowerCase()
      .replace(/^www\./, "")
      .trim();
  } catch {
    return urlOrHost
      .toLowerCase()
      .replace(/^www\./, "")
      .trim();
  }
}

export function determineLeadOrigin(url: string, source?: string): FindingOrigin {
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
 * Loads persisted domains (see migration
 * 20260818120000_deepfake_high_risk_domain_registry.sql) into the in-memory
 * registry so growth from past scans/targets survives cold starts. Safe to
 * call every scan start: idempotent, additive-only, and never throws — a
 * database failure just means the scan falls back to the 3-domain seed list
 * for that run instead of aborting.
 *
 * IMPORTANT: the underlying table intentionally does NOT store
 * exact_discovery_query (or anything else target-identifying) — it's global,
 * cross-tenant reference data, and a stored query string like
 * `site:host "Some Person" deepfake` would leak which individuals are
 * enrolled for protection to every authenticated user. The in-memory
 * HighRiskSourceEntry.exact_discovery_query field is process-local only
 * (never persisted, never returned to any client — getHighRiskSourceDomains()
 * only exposes bare hostnames) and is backfilled with a generic
 * `site:{host}` placeholder on hydration.
 */
export async function hydrateHighRiskRegistryFromDatabase(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<{ hydrated: number; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("deepfake_high_risk_domains")
      .select("hostname, discovery_provider, first_seen_at, last_seen_at, qualified_finding_count")
      .order("qualified_finding_count", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);

    let hydrated = 0;
    for (const row of data ?? []) {
      const key = normalizeHostname(row.hostname);
      if (!key) continue;
      const existing = registry.get(key);
      if (!existing || row.qualified_finding_count > existing.qualified_finding_count) {
        registry.set(key, {
          hostname: key,
          source_domain: key,
          discovery_provider: row.discovery_provider ?? "seed",
          // Not persisted server-side (see function comment) — regenerated
          // fresh per scan by generateHighRiskSiteQueries() anyway.
          exact_discovery_query: `site:${key}`,
          first_seen_at: row.first_seen_at ?? new Date().toISOString(),
          last_seen_at: row.last_seen_at ?? new Date().toISOString(),
          qualified_finding_count: row.qualified_finding_count ?? 1,
        });
        hydrated += 1;
      }
    }
    return { hydrated };
  } catch (err) {
    return { hydrated: 0, error: (err as Error).message };
  }
}

/**
 * Strict boundary check for `persistQualifiedDomainFinding()`: true only if
 * `value` is already a canonical hostname with no scheme, path, query
 * string, fragment, port, credentials, or surrounding whitespace — e.g.
 * `example.com` or `subdomain.example.com`.
 *
 * `normalizeHostname()` (above) is a best-effort *cleaner* used throughout
 * the in-memory registry (it strips `www.`, lowercases, and — only when the
 * input contains `"://"` and parses — extracts `new URL(...).hostname`).
 * Its two fallback paths (no `"://"` present, or the URL constructor
 * throws) just lowercase/trim the original string with no structural
 * stripping, so it does not *guarantee* a canonical hostname reaches this
 * module's callers. This function is the last check before the value is
 * ever sent to the `upsert_deepfake_high_risk_domain` RPC and is
 * deliberately independent of `normalizeHostname()`.
 */
export function isCanonicalHostname(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 253) return false;
  // Reject anything with leading/trailing (or whitespace-only) padding —
  // covers the "whitespace-only value" case and stray spaces from
  // upstream string concatenation.
  if (value !== value.trim()) return false;
  // Reject characters that only ever appear once a hostname has been
  // combined with a scheme, path, query string, fragment, credentials, or
  // port: whitespace, "/", "\", "?", "#", "@", ":". This single check
  // covers every invalid example the caller specified
  // (`https://example.com/page`, `example.com:443`, `/page`) plus
  // IP:port / user:pass@host fragments.
  if (/[\s/\\?#@:]/.test(value)) return false;
  if (value.includes("..")) return false;
  const labels = value.split(".");
  const labelPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  return labels.every((label) => labelPattern.test(label));
}

/**
 * Best-effort persistence of a qualified-domain finding to
 * deepfake_high_risk_domains via the atomic upsert RPC. Never throws — a
 * write failure here must never fail or slow down the scan that found it.
 *
 * Deliberately sends only hostname + provider — never the exact discovery
 * query — to a globally-readable-by-design registry table. See the
 * hydrateHighRiskRegistryFromDatabase() comment above for why.
 *
 * Validates `entry.hostname` against `isCanonicalHostname()` immediately
 * before the RPC call and fails safe (logs + returns, no throw, no scan
 * impact) for anything that isn't already a bare hostname — this is a
 * defense-in-depth boundary check independent of whatever normalization the
 * caller already performed.
 */
export async function persistQualifiedDomainFinding(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  entry: Pick<HighRiskSourceEntry, "hostname" | "discovery_provider">,
): Promise<void> {
  if (!isCanonicalHostname(entry.hostname)) {
    console.warn("[DEEPFAKE:REGISTRY] Persist skipped: hostname is not canonical", {
      hostname: entry.hostname,
    });
    return;
  }

  try {
    const { error } = await supabase.rpc("upsert_deepfake_high_risk_domain", {
      _hostname: entry.hostname,
      _provider: entry.discovery_provider,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn("[DEEPFAKE:REGISTRY] Persist failed (in-memory registry still updated):", {
      hostname: entry.hostname,
      error: (err as Error).message,
    });
  }
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
      [
        input.name,
        ...(input.aliases ?? []),
        ...(input.handles ?? []).map((h) => h.replace(/^@/, "")),
      ]
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
