/**
 * Shared URL helpers + candidate shape for the Copyright Intelligence engine.
 */

export interface DiscoveryCandidate {
  url: string;
  title: string | null;
  source: string | null;
  thumbnail: string | null;
  imageUrl: string | null;
  /** true when the discovery layer treated this as a high-signal lead */
  exact: boolean;
  frameIndex: number;
  /** query that surfaced this candidate, kept for evidence */
  query?: string | null;
  /** coarse piracy taxonomy (streaming_site, torrent, cam_theatre_leak, ...) */
  category?: string | null;
  /** detected content language for this candidate */
  language?: string | null;
  /** the keyword/query variation that matched */
  keywordMatch?: string | null;
  /** classified website type (unauthorized_streaming, file_host, official_or_authorized, ...) */
  websiteType?: string | null;
  /** numeric priority score (higher score ranks candidate above social/news) */
  priorityScore?: number;
  /** historical candidate status */
  historicalStatus?: "active" | "redirected" | "unreachable" | "removed" | null;
}

/**
 * Official studios, licensed streamers, ticketing, databases, news, reviews and
 * commentary. Matches here are legitimate references and are excluded from
 * unauthorized-distribution discovery.
 */
const OFFICIAL_HOSTS = [
  // licensed streaming / storefronts
  "netflix.com",
  "primevideo.com",
  "amazon.com",
  "amazon.in",
  "hotstar.com",
  "disneyplus.com",
  "disney.com",
  "hulu.com",
  "max.com",
  "hbomax.com",
  "peacocktv.com",
  "paramountplus.com",
  "appletv.com",
  "apple.com",
  "itunes.apple.com",
  "play.google.com",
  "tv.apple.com",
  "sonyliv.com",
  "zee5.com",
  "jiocinema.com",
  "jiohotstar.com",
  "aha.video",
  "sunnxt.com",
  "mubi.com",
  "crunchyroll.com",
  "roku.com",
  "vudu.com",
  "fandangonow.com",
  "microsoft.com",
  "manoramamax.com",
  "simplysouth.tv",
  "erosnow.com",
  "voot.com",
  "lionsgateplay.com",
  // studios / distributors / official
  "marvel.com",
  "sonypictures.com",
  "warnerbros.com",
  "universalpictures.com",
  "paramount.com",
  "20thcenturystudios.com",
  "focusfeatures.com",
  "a24films.com",
  "lionsgate.com",
  "mgm.com",
  "netflixstudios.com",
  "spiderman.movie",
  // ticketing / listings / databases
  "bookmyshow.com",
  "fandango.com",
  "atomtickets.com",
  "pvrcinemas.com",
  "inox.co.in",
  "cinepolis.com",
  "amctheatres.com",
  "regmovies.com",
  "imdb.com",
  "themoviedb.org",
  "letterboxd.com",
  "rottentomatoes.com",
  "metacritic.com",
  "justwatch.com",
  "wikipedia.org",
  "fandom.com",
  "boxofficemojo.com",
  "allmovie.com",
  "moviefone.com",
  // news / reviews / commentary / trade
  "variety.com",
  "hollywoodreporter.com",
  "deadline.com",
  "screenrant.com",
  "collider.com",
  "ign.com",
  "polygon.com",
  "gamespot.com",
  "empireonline.com",
  "indiewire.com",
  "slashfilm.com",
  "cinemablend.com",
  "comicbook.com",
  "thewrap.com",
  "cbr.com",
  "nytimes.com",
  "theguardian.com",
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "forbes.com",
  "reuters.com",
  "usatoday.com",
  "people.com",
  "ndtv.com",
  "indiatimes.com",
  "timesofindia.indiatimes.com",
  "hindustantimes.com",
  "news18.com",
  "firstpost.com",
  "thehindu.com",
  "indianexpress.com",
  "pinkvilla.com",
  "koimoi.com",
  "bollywoodhungama.com",
  "filmibeat.com",
  "onmanorama.com",
  "mathrubhumi.com",
  "manoramaonline.com",
  // storefront / merch / social-official noise
  "shop.marvel.com",
  "walmart.com",
  "target.com",
  "ebay.com",
  "etsy.com",
  "amazon.co.uk",
];

const FILE_HOST_HINTS = [
  "mega.nz",
  "mediafire.com",
  "drive.google.com",
  "dropbox.com",
  "1fichier.com",
  "pixeldrain.com",
  "gofile.io",
  "krakenfiles.com",
  "anonfiles.com",
  "workupload.com",
  "send.cm",
  "doodstream.com",
  "streamtape.com",
  "mixdrop.co",
  "vidmoly.to",
  "filemoon.sx",
  "streamsb.net",
  "upstream.to",
  "terabox.com",
  "terabox.app",
];

const VIDEO_HOST_HINTS = [
  "dailymotion.com",
  "ok.ru",
  "vk.com",
  "rumble.com",
  "bitchute.com",
  "archive.org",
  "vimeo.com",
  "bilibili.tv",
  "streamable.com",
  "odysee.com",
];

const TORRENT_HINTS = [
  "1337x",
  "yts",
  "rarbg",
  "torrent",
  "magnet",
  "piratebay",
  "nyaa",
  "limetorrents",
  "torlock",
];

export const PIRACY_DOMAIN_PATTERNS = [
  /ogomovies/i,
  /movierulz/i,
  /tamilrockers/i,
  /1tamilmv/i,
  /filmyzilla/i,
  /moviesda/i,
  /kuttymovies/i,
  /isaimini/i,
  /vegamovies/i,
  /mp4moviez/i,
  /uwatchfree/i,
  /ibomma/i,
  /123movies/i,
  /fmovies/i,
  /soap2day/i,
  /katmovie/i,
  /tamilyogi/i,
  /9xmovies/i,
  /jalshamoviez/i,
  /bolly4u/i,
  /worldfree4u/i,
  /desiremovies/i,
  /hdhub4u/i,
  /skymovieshd/i,
  /filmymeet/i,
  /terabox/i,
  /mediafire/i,
  /mega\.nz/i,
  /t\.me/i,
  /telegram\.me/i,
  /bilibili/i,
  /dailymotion/i,
  /rumble/i,
  /ok\.ru/i,
  /vk\.com/i,
];

/** Check if host is a known piracy site or file host pattern across any TLD. */
export function isPiracyDomain(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return PIRACY_DOMAIN_PATTERNS.some((pat) => pat.test(host));
}

/** true when the host is an official / licensed / news / review source. */
export function isExcludedHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Standardized website-type classification. */
export function websiteTypeFor(url: string, text = ""): string {
  const host = hostOf(url) ?? "";
  const blob = `${host} ${url} ${text}`.toLowerCase();

  if (isExcludedHost(url)) return "official_or_authorized";
  if (/(review|recap|explained|box office|interview|news coverage)/i.test(text)) {
    return "review_or_news";
  }
  if (isPiracyDomain(url)) {
    if (/(download|\.mkv|\.mp4|720p|1080p|hdrip)/i.test(blob)) return "download_page";
    if (/(mega\.nz|mediafire|terabox|gofile|pixeldrain)/i.test(blob)) return "file_host";
    return "unauthorized_streaming";
  }
  if (TORRENT_HINTS.some((h) => blob.includes(h))) return "torrent_index";
  if (host.includes("t.me") || host.includes("telegram")) return "social_distribution_lead";
  if (FILE_HOST_HINTS.some((h) => host.endsWith(h))) return "file_host";
  if (VIDEO_HOST_HINTS.some((h) => host.endsWith(h))) return "video_host_reupload";
  if (
    /(watch\s*online|stream|player|embed|hdrip|webrip|full\s*movie|movierulz|filmy|123movies|fmovies|ibomma|tamilrockers|soap2day|putlocker)/.test(
      blob,
    )
  ) {
    return "unauthorized_streaming";
  }
  if (/(download|dl\.|\.mkv|\.mp4|download\s*link)/.test(blob)) return "download_page";
  if (/(reddit\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|pinterest\.com)/.test(host)) {
    return "social_distribution_lead";
  }
  if (/(mirror|redirect|fast-link|shortened)/.test(blob)) return "mirror_or_redirect";
  return "unrelated";
}

/** Quantitative priority scoring to ensure illegal streaming/download sites rank first. */
export function calculatePriorityScore(
  url: string,
  pageTitle: string | null,
  text: string,
  workTitle: string,
): number {
  let score = 0;
  const host = hostOf(url) ?? "";
  const titleLower = workTitle.toLowerCase();
  const slugLower = url.toLowerCase();
  const pageTitleLower = (pageTitle ?? "").toLowerCase();
  const blob = `${host} ${url} ${pageTitle ?? ""} ${text}`.toLowerCase();

  if (isExcludedHost(url)) return -100;
  if (/(review|recap|explained|box office|interview|news)/i.test(pageTitleLower)) return -50;

  // Title in slug
  const titleSlug = titleLower.replace(/[^a-z0-9]+/g, "");
  if (titleSlug && slugLower.replace(/[^a-z0-9]+/g, "").includes(titleSlug)) {
    score += 50;
  }

  // Title in page title
  if (titleLower && pageTitleLower.includes(titleLower)) {
    score += 40;
  }

  // Piracy domain match (e.g. OgoMovies, Movierulz)
  if (isPiracyDomain(url)) {
    score += 60;
  }

  // High-intent keywords
  if (
    /(watch\s*online|free\s*download|full\s*movie|720p|1080p|hdrip|web-dl|camrip|mkv|mp4|torrent|telegram|dual\s*audio)/i.test(
      blob,
    )
  ) {
    score += 30;
  }

  // File host / embed player
  if (/(embed|player|mega\.nz|mediafire|terabox|gofile|pixeldrain|doodstream)/i.test(blob)) {
    score += 30;
  }

  // Penalize generic social without download/watch intent
  if (
    /(reddit\.com|x\.com|facebook\.com|instagram\.com|pinterest\.com)/i.test(host) &&
    !/(watch\s*online|download|full\s*movie|mkv|torrent)/i.test(blob)
  ) {
    score -= 40;
  }

  return score;
}

export function isSuspiciousType(type: string): boolean {
  return type !== "official_or_authorized" && type !== "review_or_news" && type !== "unrelated";
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function canonicalUrl(url: string): string {
  try {
    const p = new URL(url);
    p.hash = "";
    for (const k of [...p.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/i.test(k)) p.searchParams.delete(k);
    }
    p.hostname = p.hostname.toLowerCase().replace(/^www\./, "");
    p.pathname = p.pathname.replace(/\/$/, "") || "/";
    return p.toString();
  } catch {
    return url.trim();
  }
}
