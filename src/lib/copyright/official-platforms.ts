/**
 * Official / authorized platform gates for Copyright Intelligence.
 *
 * Hostname alone never proves piracy. These helpers reject ordinary pages from
 * licensed catalogs and constrain YouTube to exact watch-URL internal leads.
 */

import { hostOf } from "./url.server";

const AUTHORIZED_CATALOG_HOSTS = [
  "plex.tv",
  "watch.plex.tv",
  "app.plex.tv",
  "netflix.com",
  "primevideo.com",
  "disneyplus.com",
  "hulu.com",
  "max.com",
  "hbomax.com",
  "peacocktv.com",
  "paramountplus.com",
  "appletv.com",
  "tv.apple.com",
  "hotstar.com",
  "jiohotstar.com",
  "sonyliv.com",
  "zee5.com",
  "jiocinema.com",
  "mubi.com",
  "crunchyroll.com",
  "roku.com",
  "vudu.com",
  "fandangonow.com",
  "justwatch.com",
];

const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"];

const YOUTUBE_PROMO_RE =
  /\b(official\s*trailer|trailer|teaser|reaction|review|soundtrack|ost|gameplay|fan\s*edit|lyric\s*video|music\s*video|clip|shorts?|behind\s*the\s*scenes|making\s*of|interview)\b/i;

const YOUTUBE_FULL_LENGTH_RE =
  /\b(full\s*movie|complete\s*movie|full\s*film|watch\s*full|entire\s*movie|\d{2,3}\s*min(?:utes)?|runtime\s*[:\s]\s*[1-3]?\d{2})\b/i;

function hostMatches(host: string | null, list: string[]): boolean {
  if (!host) return false;
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

export function isYouTubeHost(url: string): boolean {
  return hostMatches(hostOf(url), YOUTUBE_HOSTS);
}

export function isAuthorizedCatalogHost(url: string): boolean {
  return hostMatches(hostOf(url), AUTHORIZED_CATALOG_HOSTS);
}

/** Exact YouTube watch / Shorts / embed URL — never channel/home/search. */
export function isYouTubeWatchUrl(url: string): boolean {
  if (!isYouTubeHost(url)) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return /^\/[\w-]{6,}$/.test(u.pathname);
    }
    if (/^\/(watch|embed|shorts|live)\b/i.test(u.pathname)) return true;
    if (u.pathname === "/watch" || u.searchParams.has("v")) return true;
    return false;
  } catch {
    return false;
  }
}

export function isYouTubePromotional(text: string): boolean {
  return YOUTUBE_PROMO_RE.test(text) && !YOUTUBE_FULL_LENGTH_RE.test(text);
}

export function hasYouTubeFullLengthEvidence(text: string): boolean {
  return YOUTUBE_FULL_LENGTH_RE.test(text);
}

/**
 * Hosts that must never be registered as a single monitored piracy source.
 * Exact qualifying pages on other hosts are registered by evidence URL.
 */
export function isNeverMonitoredDomain(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  if (hostMatches(host, YOUTUBE_HOSTS)) return true;
  if (hostMatches(host, AUTHORIZED_CATALOG_HOSTS)) return true;
  return false;
}

export type OfficialPlatformDecision =
  | { kind: "authorized_catalog"; classification: "OFFICIAL_OR_AUTHORIZED" | "CATALOG_OR_LISTING"; reason: string }
  | { kind: "youtube_non_watch"; classification: "OFFICIAL_OR_AUTHORIZED" | "TRAILER_OR_PROMO"; reason: string }
  | { kind: "youtube_promo"; classification: "TRAILER_OR_PROMO"; reason: string }
  | { kind: "youtube_internal_reupload"; classification: "VIDEO_HOST_REUPLOAD"; reason: string; clientVisible: false }
  | { kind: "youtube_insufficient"; classification: "UNVERIFIED_LEAD"; reason: string }
  | null;

/**
 * Pre-classification gate for official platforms / YouTube.
 * Returns null when the page should continue through normal evidence gates.
 */
export function officialPlatformDecision(opts: {
  url: string;
  pageTitle?: string | null;
  text?: string;
}): OfficialPlatformDecision {
  const blob = `${opts.pageTitle ?? ""} ${opts.text ?? ""} ${opts.url}`;

  if (isAuthorizedCatalogHost(opts.url)) {
    return {
      kind: "authorized_catalog",
      classification: /\/(movie|show|watch|details|media)\b/i.test(opts.url)
        ? "CATALOG_OR_LISTING"
        : "OFFICIAL_OR_AUTHORIZED",
      reason:
        "Authorized catalog/discovery platform (e.g. Plex/OTT). Watch-now markup or runtime on a licensed catalog page is not unauthorized distribution evidence.",
    };
  }

  if (!isYouTubeHost(opts.url)) return null;

  if (!isYouTubeWatchUrl(opts.url)) {
    return {
      kind: "youtube_non_watch",
      classification: "OFFICIAL_OR_AUTHORIZED",
      reason:
        "YouTube non-watch URL (channel/home/search/playlist). youtube.com is never monitored as a single piracy source.",
    };
  }

  if (isYouTubePromotional(blob)) {
    return {
      kind: "youtube_promo",
      classification: "TRAILER_OR_PROMO",
      reason:
        "YouTube watch URL classified as trailer/clip/reaction/review/soundtrack/fan content — not unauthorized full-length distribution.",
    };
  }

  if (hasYouTubeFullLengthEvidence(blob)) {
    return {
      kind: "youtube_internal_reupload",
      classification: "VIDEO_HOST_REUPLOAD",
      clientVisible: false,
      reason:
        "Exact YouTube watch URL with full-length/reupload language retained as an internal investigation lead only — never registers youtube.com as a monitored source.",
    };
  }

  return {
    kind: "youtube_insufficient",
    classification: "UNVERIFIED_LEAD",
    reason:
      "Exact YouTube watch URL lacks strong full-length reupload evidence — internal lead only, not client-visible piracy.",
  };
}
