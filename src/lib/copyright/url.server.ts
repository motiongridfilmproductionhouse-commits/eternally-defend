/**
 * Shared URL helpers + candidate shape for the Copyright Intelligence engine.
 * Discovery is Firecrawl + AI Vision only (no SerpApi / Google Lens).
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
  /** classified website type (piracy_stream, file_host, official_platform, ...) */
  websiteType?: string | null;
}

/**
 * Official studios, licensed streamers, ticketing, databases, news, reviews and
 * commentary. Matches here are legitimate references and are excluded from
 * unauthorized-distribution discovery.
 */
const OFFICIAL_HOSTS = [
  // licensed streaming / storefronts
  "netflix.com", "primevideo.com", "amazon.com", "amazon.in", "hotstar.com", "disneyplus.com",
  "disney.com", "hulu.com", "max.com", "hbomax.com", "peacocktv.com", "paramountplus.com",
  "appletv.com", "apple.com", "itunes.apple.com", "play.google.com", "tv.apple.com",
  "sonyliv.com", "zee5.com", "jiocinema.com", "jiohotstar.com", "aha.video", "sunnxt.com",
  "mubi.com", "crunchyroll.com", "roku.com", "vudu.com", "fandangonow.com", "microsoft.com",
  "manoramamax.com", "simplysouth.tv", "erosnow.com", "voot.com", "lionsgateplay.com",
  // studios / distributors / official
  "marvel.com", "sonypictures.com", "warnerbros.com", "universalpictures.com", "paramount.com",
  "20thcenturystudios.com", "focusfeatures.com", "a24films.com", "lionsgate.com", "mgm.com",
  "netflixstudios.com", "spiderman.movie",
  // ticketing / cinema / showtimes / listings / databases
  "bookmyshow.com", "fandango.com", "atomtickets.com", "pvrcinemas.com", "inox.co.in",
  "cinepolis.com", "amctheatres.com", "regmovies.com", "voxcinemas.com", "voxcinemas.ae",
  "district.com", "district.in", "novacinemas.com", "reelcinemas.ae", "muvicinemas.com",
  "cinepax.com", "cinegold.com", "cinema.com", "showtimes.com",
  "imdb.com", "themoviedb.org",
  "letterboxd.com", "rottentomatoes.com", "metacritic.com", "justwatch.com", "wikipedia.org",
  "fandom.com", "boxofficemojo.com", "allmovie.com", "moviefone.com",
  // news / reviews / commentary / trade
  "variety.com", "hollywoodreporter.com", "deadline.com", "screenrant.com", "collider.com",
  "ign.com", "polygon.com", "gamespot.com", "empireonline.com", "indiewire.com", "slashfilm.com",
  "cinemablend.com", "comicbook.com", "thewrap.com", "cbr.com", "nytimes.com", "theguardian.com",
  "bbc.com", "bbc.co.uk", "cnn.com", "forbes.com", "reuters.com", "usatoday.com", "people.com",
  "ndtv.com", "indiatimes.com", "timesofindia.indiatimes.com", "hindustantimes.com", "news18.com",
  "firstpost.com", "thehindu.com", "indianexpress.com", "pinkvilla.com", "koimoi.com",
  "bollywoodhungama.com", "filmibeat.com", "onmanorama.com", "mathrubhumi.com", "manoramaonline.com",
  // storefront / merch / social-official noise
  "shop.marvel.com", "walmart.com", "target.com", "ebay.com", "etsy.com", "amazon.co.uk",
];

const FILE_HOST_HINTS = [
  "mega.nz", "mediafire.com", "drive.google.com", "dropbox.com", "1fichier.com", "pixeldrain.com",
  "gofile.io", "krakenfiles.com", "anonfiles.com", "workupload.com", "send.cm", "doodstream.com",
  "streamtape.com", "mixdrop.co", "vidmoly.to", "filemoon.sx", "streamsb.net", "upstream.to",
];

const VIDEO_HOST_HINTS = [
  "dailymotion.com", "ok.ru", "vk.com", "rumble.com", "bitchute.com", "archive.org",
  "vimeo.com", "youtube.com", "youtu.be", "streamable.com", "odysee.com",
];

const TORRENT_HINTS = [
  "1337x", "yts", "rarbg", "torrent", "magnet", "piratebay", "nyaa", "limetorrents", "torlock",
];

/** true when the host is an official / licensed / news / review source. */
export function isExcludedHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Coarse website-type label used for evidence and ranking. */
export function websiteTypeFor(url: string, text = ""): string {
  const host = hostOf(url) ?? "";
  const blob = `${host} ${url} ${text}`.toLowerCase();
  if (isExcludedHost(url)) return "official_platform";
  if (TORRENT_HINTS.some((h) => blob.includes(h))) return "torrent_index";
  if (host.includes("t.me") || host.includes("telegram")) return "telegram_channel";
  if (FILE_HOST_HINTS.some((h) => host.endsWith(h))) return "file_host";
  if (/(download|dl\.|\.mkv|\.mp4|download\s*link)/.test(blob)) return "download_page";
  if (VIDEO_HOST_HINTS.some((h) => host.endsWith(h))) return "video_host_reupload";
  if (/(watch\s*online|stream|player|embed|hdrip|webrip|full\s*movie|movierulz|filmy|123movies|fmovies|ibomma|tamilrockers|soap2day|putlocker)/.test(blob))
    return "unauthorized_streaming";
  if (/(forum|thread|board|community|reddit)/.test(blob)) return "forum_post";
  if (/(poster|artwork|wallpaper|image|still)/.test(blob)) return "duplicate_artwork";
  return "unverified_source";
}

/** true when the classified type represents a suspicious distribution source. */
export function isSuspiciousType(type: string): boolean {
  return type !== "official_platform" && type !== "unverified_source";
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
