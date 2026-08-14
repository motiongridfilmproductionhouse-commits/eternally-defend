/**
 * Feature-scoped discovery source policy.
 *
 * Some product rules disable a source for a specific feature only — Reddit is
 * excluded from the Deepfake Intelligence Agent and the Impersonation /
 * Identity discovery engine, but remains a legitimate signal for general
 * reputation web scanning. Previously the rule lived nowhere: the deepfake
 * pipeline still called Reddit discovery and Reddit hits bypassed host
 * filtering because they were tagged as "explicit provider results".
 *
 * This module is the single place that answers "may feature X ingest source Y".
 * It is pure so it can be unit-tested and imported from both server pipelines
 * and client filters.
 */

export type DiscoveryFeature =
  | "deepfake_intel"
  | "impersonation_discovery"
  | "copyright_intel"
  | "reputation_web_scan"
  | "channel_watch";

/** Hosts disabled per feature (suffix match, www-insensitive). */
const DISABLED_HOSTS: Record<DiscoveryFeature, readonly string[]> = {
  // Product rule: the deepfake agent must not scan Reddit.
  deepfake_intel: ["reddit.com", "redd.it", "old.reddit.com", "reddit.it"],
  // Product rule: the impersonation engine must not scan Reddit.
  impersonation_discovery: ["reddit.com", "redd.it", "old.reddit.com", "reddit.it"],
  copyright_intel: [],
  reputation_web_scan: [],
  channel_watch: [],
};

/** Provider identifiers disabled per feature. */
const DISABLED_PROVIDERS: Record<DiscoveryFeature, readonly string[]> = {
  deepfake_intel: ["reddit", "reddit_api"],
  impersonation_discovery: ["reddit", "reddit_api"],
  copyright_intel: [],
  reputation_web_scan: [],
  channel_watch: [],
};

function normalizeHost(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  if (!host) return null;
  if (host.includes("://") || host.startsWith("//")) {
    try {
      host = new URL(host.startsWith("//") ? `https:${host}` : host).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return host.replace(/^www\./, "").replace(/\.$/, "") || null;
}

/** True when `feature` is not allowed to ingest results from this host. */
export function isHostDisabledForFeature(
  feature: DiscoveryFeature,
  hostOrUrl: string | null | undefined,
): boolean {
  const host = normalizeHost(hostOrUrl);
  if (!host) return false;
  return DISABLED_HOSTS[feature].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** True when `feature` is not allowed to call this discovery provider. */
export function isProviderDisabledForFeature(
  feature: DiscoveryFeature,
  provider: string | null | undefined,
): boolean {
  const key = (provider ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (!key) return false;
  return DISABLED_PROVIDERS[feature].includes(key);
}

/** Convenience guard for candidate objects carrying both a url and a source. */
export function isCandidateDisabledForFeature(
  feature: DiscoveryFeature,
  candidate: { url?: string | null; image_url?: string | null; thumbnail_url?: string | null; source?: string | null },
): boolean {
  if (isProviderDisabledForFeature(feature, candidate.source)) return true;
  return (
    isHostDisabledForFeature(feature, candidate.url) ||
    isHostDisabledForFeature(feature, candidate.image_url) ||
    isHostDisabledForFeature(feature, candidate.thumbnail_url)
  );
}

/** Exposed for tests/diagnostics only. */
export function disabledHostsForFeature(feature: DiscoveryFeature): readonly string[] {
  return DISABLED_HOSTS[feature];
}
