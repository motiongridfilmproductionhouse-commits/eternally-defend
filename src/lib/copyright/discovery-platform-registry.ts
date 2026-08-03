/**
 * Extendable platform registry for Copyright discovery site: queries.
 * Domains are configuration entries — discovery logic must not hard-code one title or site.
 */

export type PlatformCategory =
  | "streaming"
  | "download"
  | "cloud_storage"
  | "video_hosting"
  | "archive"
  | "telegram"
  | "torrent"
  | "mirror"
  | "file_host";

export interface PlatformRegistryEntry {
  domain: string;
  category: PlatformCategory;
}

/** Categorized discovery target domains (search seeds only). */
export const DISCOVERY_PLATFORM_REGISTRY: readonly PlatformRegistryEntry[] = [
  // Streaming / mirror indexes
  { domain: "ogomovies1.com.pk", category: "streaming" },
  { domain: "ogomovies.com", category: "streaming" },
  { domain: "movierulz.vc", category: "mirror" },
  { domain: "ibomma.bet", category: "mirror" },
  { domain: "tamilrockers.ws", category: "mirror" },
  { domain: "123movies.ai", category: "mirror" },
  { domain: "fmovies.to", category: "mirror" },
  { domain: "soap2day.day", category: "mirror" },
  { domain: "vegamovies.nl", category: "mirror" },
  { domain: "mp4moviez.ink", category: "mirror" },
  { domain: "9xmovies.gold", category: "mirror" },
  { domain: "hdhub4u.tv", category: "mirror" },
  { domain: "filmy4wap.co.in", category: "mirror" },
  { domain: "isaimini.com", category: "mirror" },
  // Video hosting
  { domain: "bilibili.tv", category: "video_hosting" },
  { domain: "bilibili.com", category: "video_hosting" },
  { domain: "dailymotion.com", category: "video_hosting" },
  { domain: "ok.ru", category: "video_hosting" },
  { domain: "vk.com", category: "video_hosting" },
  { domain: "rumble.com", category: "video_hosting" },
  // Cloud storage / file lockers
  { domain: "terabox.app", category: "cloud_storage" },
  { domain: "terabox.com", category: "cloud_storage" },
  { domain: "drive.google.com", category: "cloud_storage" },
  { domain: "mega.nz", category: "file_host" },
  { domain: "mediafire.com", category: "file_host" },
  { domain: "pixeldrain.com", category: "file_host" },
  { domain: "gofile.io", category: "file_host" },
  // Archive
  { domain: "archive.org", category: "archive" },
  // Telegram
  { domain: "t.me", category: "telegram" },
  { domain: "telegram.me", category: "telegram" },
  // Torrent indexes
  { domain: "1337x.to", category: "torrent" },
  { domain: "thepiratebay.org", category: "torrent" },
  { domain: "rarbg.to", category: "torrent" },
  { domain: "yts.mx", category: "torrent" },
  { domain: "kickass.cm", category: "torrent" },
];

export function domainsByCategory(category: PlatformCategory): string[] {
  return DISCOVERY_PLATFORM_REGISTRY.filter((e) => e.category === category).map((e) => e.domain);
}

export function allRegistryDomains(): string[] {
  return [...new Set(DISCOVERY_PLATFORM_REGISTRY.map((e) => e.domain))];
}

export function siteQueryForDomain(domain: string, quotedTitle: string): string {
  if (domain.includes("archive.org")) {
    return `site:archive.org "${quotedTitle}"`;
  }
  return `site:${domain} "${quotedTitle}"`;
}

/** Primary platform hosts for site: queries (backward-compatible flat list). */
export const DISCOVERY_TARGET_DOMAINS: readonly string[] = allRegistryDomains().filter(
  (d) =>
    !["movierulz.vc", "ibomma.bet", "tamilrockers.ws", "123movies.ai", "fmovies.to"].includes(d),
);

export const DISCOVERY_MIRROR_DOMAINS: readonly string[] = domainsByCategory("mirror");

export const DISCOVERY_TORRENT_INDEX_DOMAINS: readonly string[] = domainsByCategory("torrent");

/** Search-engine friendly OR clusters built from registry categories. */
export function buildPlatformClusterQuery(
  category: PlatformCategory,
  quotedTitle: string,
  suffix = "",
): string | null {
  const domains = domainsByCategory(category).slice(0, 6);
  if (!domains.length) return null;
  const siteClause = domains.map((d) => `site:${d}`).join(" OR ");
  return `"${quotedTitle}" (${siteClause})${suffix ? ` ${suffix}` : ""}`;
}
