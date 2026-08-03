/**
 * Configurable high-yield discovery target domains for Copyright Intelligence.
 * These are search seeds only — every hit still requires exact-page evidence.
 */

/** Primary platform hosts for site: queries (user-configurable registry). */
export const DISCOVERY_TARGET_DOMAINS: readonly string[] = [
  "ogomovies1.com.pk",
  "ogomovies.com",
  "bilibili.tv",
  "bilibili.com",
  "dailymotion.com",
  "archive.org",
  "terabox.app",
  "terabox.com",
  "t.me",
  "telegram.me",
  "drive.google.com",
  "mega.nz",
  "mediafire.com",
  "pixeldrain.com",
  "gofile.io",
  "ok.ru",
  "vk.com",
  "rumble.com",
];

/** Torrent / index families (site clusters for OR queries). */
export const DISCOVERY_TORRENT_INDEX_DOMAINS: readonly string[] = [
  "1337x.to",
  "thepiratebay.org",
  "rarbg.to",
  "yts.mx",
  "kickass.cm",
];

/** Mirror / streaming index domains. */
export const DISCOVERY_MIRROR_DOMAINS: readonly string[] = [
  "movierulz.vc",
  "ibomma.bet",
  "tamilrockers.ws",
  "123movies.ai",
  "fmovies.to",
  "soap2day.day",
  "vegamovies.nl",
  "mp4moviez.ink",
  "9xmovies.gold",
  "hdhub4u.tv",
  "filmy4wap.co.in",
  "isaimini.com",
];

export function siteQueryForDomain(domain: string, quotedTitle: string): string {
  if (domain.includes("archive.org")) {
    return `site:archive.org "${quotedTitle}"`;
  }
  return `site:${domain} "${quotedTitle}"`;
}
