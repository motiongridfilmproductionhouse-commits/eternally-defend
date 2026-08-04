/**
 * Configurable high-yield discovery target domains for Copyright Intelligence.
 * Re-exports from the extendable platform registry.
 */

export {
  DISCOVERY_TARGET_DOMAINS,
  DISCOVERY_MIRROR_DOMAINS,
  DISCOVERY_TORRENT_INDEX_DOMAINS,
  siteQueryForDomain,
  domainsByCategory,
  allRegistryDomains,
  buildPlatformClusterQuery,
  type PlatformCategory,
  type PlatformRegistryEntry,
  DISCOVERY_PLATFORM_REGISTRY,
} from "./discovery-platform-registry";
