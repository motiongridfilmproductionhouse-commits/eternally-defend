/**
 * Unauthorized movie-distribution site detection.
 *
 * Discovery hands us candidate pages; this module fetches each page with
 * Firecrawl (markdown + html + links + screenshot) and looks for HARD
 * distribution evidence: embedded video players, download buttons, mirror
 * lists, file-host links, torrent/magnet links and full-movie availability.
 *
 * A page is only classified as piracy when strong evidence exists. Title,
 * poster, trailer or news mentions alone are never enough.
 *
 * Evidence collection only — nothing here reports or takes down content.
 */

import { firecrawlFetch } from "@/lib/firecrawl-client.server";
import { hostOf, isExcludedHost } from "./url.server";

export type DomainRisk = "high" | "medium" | "low";

export type DistributionContentType =
  | "unauthorized_streaming_site"
  | "movie_download_site"
  | "torrent_index_site"
  | "file_distribution_site"
  | "linking_page"
  | "reupload_platform"
  | "official_platform"
  | "news_or_review"
  | "discussion"
  | "unknown";

export type ReleaseTiming =
  | "same_day"
  | "next_day"
  | "first_week"
  | "first_month"
  | "later"
  | "unknown";

export interface PiracyIndicator {
  /** machine key, e.g. embedded_player */
  key: string;
  /** human sentence used as evidence */
  detail: string;
  /** how much this contributes to the confidence score */
  weight: number;
  /** true when this alone justifies a piracy classification */
  strong: boolean;
}

export interface DistributionAnalysis {
  url: string;
  domain: string | null;
  domainRisk: DomainRisk;
  contentType: DistributionContentType;
  releaseTiming: ReleaseTiming;
  /** days between theatrical/release date and the page being seen */
  releaseOffsetDays: number | null;
  indicators: PiracyIndicator[];
  /** subset of indicator keys */
  indicatorKeys: string[];
  /** the hard-evidence gate: full movie / player / download / file / multi-signal */
  strongEvidence: boolean;
  confidence: number;
  /** data URL or hosted URL of the page screenshot */
  screenshot: string | null;
  pageTitle: string | null;
  /** mirror / download / file-host links found on the page */
  distributionLinks: string[];
  qualityTags: string[];
  reason: string;
}

const FILE_HOSTS = [
  "mega.nz", "mega.co.nz", "mediafire.com", "gofile.io", "pixeldrain.com", "krakenfiles.com",
  "1fichier.com", "anonfiles.com", "workupload.com", "send.cm", "dropbox.com", "drive.google.com",
  "doodstream.com", "dood.to", "streamtape.com", "mixdrop.co", "mixdrop.to", "filemoon.sx",
  "streamsb.net", "upstream.to", "vidmoly.to", "vidhide.com", "streamwish.to", "abyss.to",
];

const TORRENT_HOSTS = [
  "1337x", "yts", "rarbg", "thepiratebay", "piratebay", "nyaa", "limetorrents", "torlock",
  "torrentgalaxy", "kickass", "extratorrent", "torrentz",
];

const KNOWN_PIRACY_BRANDS = [
  "movierulz", "tamilrockers", "ibomma", "isaimini", "kuttymovies", "tamilyogi", "filmyzilla",
  "filmywap", "9xmovies", "katmovie", "vegamovies", "mp4moviez", "uwatchfree", "123movies",
  "fmovies", "soap2day", "putlocker", "primewire", "hdhub", "bolly4u", "moviesda", "jiorockers",
  "cinevood", "skymovies", "downloadhub", "worldfree4u", "afdah", "gomovies", "yesmovies",
];

const REUPLOAD_HOSTS = [
  "ok.ru", "vk.com", "dailymotion.com", "rumble.com", "bitchute.com", "odysee.com",
  "archive.org", "streamable.com", "t.me", "telegram.me",
];

const NEWS_DISCUSSION_HINTS =
  /(review|recap|explained|reaction|interview|press\s*release|box\s*office|first\s*look|trailer\s*out|news)/i;

const QUALITY_RE =
  /\b(hdcam|cam[- ]?rip|camrip|cam[- ]?print|hdts|ts[- ]?print|predvd|dvdscr|dvdrip|hdrip|web[- ]?dl|webrip|bluray|brrip|hq\s*print|theatre\s*print|theater\s*print|360p|480p|720p|1080p|2160p|4k|x264|x265|hevc|dual\s*audio)\b/gi;

interface ScrapeInner {
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, unknown>;
}
interface ScrapeResponse extends ScrapeInner {
  success?: boolean;
  data?: ScrapeInner;
  error?: string;
}

async function scrapePage(url: string): Promise<ScrapeInner | null> {
  try {
    const res = await firecrawlFetch("/scrape", {
      url,
      formats: ["markdown", "html", "links", "screenshot"],
      onlyMainContent: false,
      waitFor: 1200,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as ScrapeResponse;
    const inner = json.data ?? json;
    return inner ?? null;
  } catch {
    return null;
  }
}

function normalizeShot(shot: string | undefined): string | null {
  if (!shot) return null;
  return shot.startsWith("data:") || shot.startsWith("http")
    ? shot
    : `data:image/png;base64,${shot}`;
}

/** Release timing bucket from the number of days between release and now. */
export function releaseTimingFor(releaseDate: string | null | undefined): {
  timing: ReleaseTiming;
  offsetDays: number | null;
} {
  if (!releaseDate) return { timing: "unknown", offsetDays: null };
  const t = Date.parse(releaseDate);
  if (!Number.isFinite(t)) return { timing: "unknown", offsetDays: null };
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 0) return { timing: "unknown", offsetDays: days };
  if (days === 0) return { timing: "same_day", offsetDays: days };
  if (days === 1) return { timing: "next_day", offsetDays: days };
  if (days <= 7) return { timing: "first_week", offsetDays: days };
  if (days <= 30) return { timing: "first_month", offsetDays: days };
  return { timing: "later", offsetDays: days };
}

function countMatches(text: string, re: RegExp): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(re)) out.add(m[0].toLowerCase());
  return [...out];
}

/**
 * Inspect one candidate page for unauthorized-distribution evidence.
 * Returns null when the page cannot be fetched.
 */
export async function analyzeDistributionPage(opts: {
  url: string;
  title?: string | null;
  /** protected work title + alternates, used for on-page relevance */
  titles: string[];
  releaseDate?: string | null;
  /** reuse an already-captured screenshot instead of scraping a new one */
  screenshot?: string | null;
}): Promise<DistributionAnalysis | null> {
  const domain = hostOf(opts.url);
  const page = await scrapePage(opts.url);
  if (!page) return null;

  const markdown = (page.markdown ?? "").slice(0, 60_000);
  const html = (page.html ?? "").slice(0, 200_000);
  const links = (Array.isArray(page.links) ? page.links : []).filter(
    (l): l is string => typeof l === "string",
  );
  const meta = (page.metadata ?? {}) as Record<string, unknown>;
  const pageTitle =
    (typeof meta.title === "string" && meta.title) ||
    opts.title ||
    null;

  const blob = `${domain ?? ""} ${opts.url} ${pageTitle ?? ""} ${markdown}`.toLowerCase();
  const htmlLower = html.toLowerCase();

  // ---- relevance: the protected work must actually appear on the page -----
  const titleHit = opts.titles
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 2)
    .some((t) => blob.includes(t));

  const indicators: PiracyIndicator[] = [];
  const add = (key: string, detail: string, weight: number, strong = false) => {
    if (!indicators.some((i) => i.key === key)) indicators.push({ key, detail, weight, strong });
  };

  // ---- 1. embedded video player ------------------------------------------
  const playerHosts = FILE_HOSTS.filter((h) => htmlLower.includes(h));
  const hasIframePlayer =
    /<iframe[^>]+(src|data-src)=["'][^"']*(embed|player|stream|video|\/e\/|\/v\/)/i.test(html) ||
    /<video[\s>]/i.test(html) ||
    /(jwplayer|videojs|plyr\.|clappr|hls\.js|\.m3u8|\.mpd)/i.test(html);
  if (hasIframePlayer || playerHosts.length) {
    add(
      "embedded_player",
      `Embedded video player detected on page${playerHosts.length ? ` (${playerHosts.slice(0, 3).join(", ")})` : ""}.`,
      30,
      true,
    );
  }

  // ---- 2. download buttons / links ---------------------------------------
  const downloadLinks = links.filter((l) =>
    /(\.mkv|\.mp4|\.avi|\.torrent|download|dl\.|\/get\/|\/dl\/)/i.test(l),
  );
  const downloadCta =
    /(download\s*(now|link|movie|here|hd|full)|click\s*to\s*download|<a[^>]*>\s*download)/i.test(
      `${markdown}\n${html}`,
    );
  if (downloadLinks.length >= 1 || downloadCta) {
    add(
      "download_links",
      `${downloadLinks.length || "Multiple"} download link(s)/buttons offering the file directly.`,
      28,
      true,
    );
  }

  // ---- 3. file-hosting links ---------------------------------------------
  const fileLinks = links.filter((l) => {
    const h = hostOf(l);
    return h ? FILE_HOSTS.some((f) => h === f || h.endsWith(`.${f}`)) : false;
  });
  if (fileLinks.length) {
    add(
      "file_host_links",
      `File-hosting links present (${[...new Set(fileLinks.map(hostOf))].slice(0, 3).join(", ")}).`,
      26,
      true,
    );
  }

  // ---- 4. torrent / magnet ------------------------------------------------
  const magnets = links.filter((l) => l.startsWith("magnet:"));
  const torrentHost = TORRENT_HOSTS.some((t) => (domain ?? "").includes(t));
  if (magnets.length || torrentHost || /magnet:\?xt=urn:btih/i.test(html)) {
    add(
      "torrent_or_magnet",
      magnets.length ? `${magnets.length} magnet/torrent link(s) on page.` : "Torrent index domain.",
      28,
      true,
    );
  }

  // ---- 5. multiple mirrors -----------------------------------------------
  const mirrorMentions = countMatches(
    `${markdown}`,
    /\b(mirror\s*\d?|server\s*\d|link\s*\d|watch\s*server|download\s*server|resumable|fast\s*server)\b/gi,
  );
  if (mirrorMentions.length >= 2 || fileLinks.length >= 2) {
    add("multiple_mirrors", `Multiple mirror/server links offered (${mirrorMentions.slice(0, 4).join(", ") || "several file hosts"}).`, 18);
  }

  // ---- 6. full-movie availability language --------------------------------
  const fullMovie =
    /(full\s*movie\s*(online|download|watch|free|hd)?|watch\s*(the\s*)?full\s*movie|complete\s*movie|full\s*film)/i.test(
      `${pageTitle ?? ""} ${markdown}`,
    );
  if (fullMovie) add("full_movie_offer", "Page advertises the complete movie for viewing or download.", 24, true);

  // ---- 7. quality / rip tags ----------------------------------------------
  const qualityTags = countMatches(`${pageTitle ?? ""} ${markdown}`, QUALITY_RE);
  if (qualityTags.length) {
    add("release_quality_tags", `Pirate release quality tags: ${qualityTags.slice(0, 6).join(", ")}.`, 14);
  }
  if (/(hdcam|camrip|cam[- ]?print|hdts|theatre print|theater print)/i.test(blob)) {
    add("cam_theatre_print", "Cam / theatre print of a theatrical release offered.", 20);
  }

  // ---- 8. large movie library / known piracy brand -------------------------
  const libraryHits = countMatches(
    markdown,
    /\b(latest\s*movies|movies\s*\d{4}|category|genre|bollywood|hollywood|tamil\s*movies|telugu\s*movies|dubbed\s*movies|web\s*series)\b/gi,
  );
  if (libraryHits.length >= 4) {
    add("large_movie_library", "Domain hosts a large indexed library of movie titles.", 12);
  }
  const brand = KNOWN_PIRACY_BRANDS.find((b) => (domain ?? "").includes(b));
  if (brand) add("known_piracy_domain", `Domain matches a known unauthorized distribution brand (${brand}).`, 22, true);

  // ---- 9. telegram / reupload channels -------------------------------------
  const reupload = REUPLOAD_HOSTS.some((h) => (domain ?? "").endsWith(h));
  if (reupload && (hasIframePlayer || fullMovie || qualityTags.length)) {
    add("reupload_platform", "Full-length re-upload hosted on a general video/file platform.", 18);
  }

  // ---- classification ------------------------------------------------------
  const official = isExcludedHost(opts.url);
  const newsy = NEWS_DISCUSSION_HINTS.test(`${pageTitle ?? ""} ${markdown.slice(0, 4000)}`);

  const strongCount = indicators.filter((i) => i.strong).length;
  const strongEvidence = !official && titleHit && (strongCount >= 1 || indicators.length >= 3);

  let contentType: DistributionContentType = "unknown";
  let domainRisk: DomainRisk = "low";

  if (official) {
    contentType = "official_platform";
    domainRisk = "low";
  } else if (!strongEvidence && newsy) {
    contentType = "news_or_review";
    domainRisk = "low";
  } else if (!strongEvidence) {
    contentType = /(forum|thread|community|discussion|comments)/i.test(blob) ? "discussion" : "unknown";
    domainRisk = "low";
  } else if (torrentHost || magnets.length) {
    contentType = "torrent_index_site";
    domainRisk = "high";
  } else if (fileLinks.length && !hasIframePlayer) {
    contentType = "file_distribution_site";
    domainRisk = "high";
  } else if (hasIframePlayer && (fullMovie || qualityTags.length || brand)) {
    contentType = "unauthorized_streaming_site";
    domainRisk = "high";
  } else if (downloadLinks.length || downloadCta || brand) {
    contentType = "movie_download_site";
    domainRisk = "high";
  } else if (reupload) {
    contentType = "reupload_platform";
    domainRisk = "medium";
  } else {
    contentType = "linking_page";
    domainRisk = "medium";
  }

  // ---- confidence ----------------------------------------------------------
  const { timing, offsetDays } = releaseTimingFor(opts.releaseDate);
  let confidence = indicators.reduce((sum, i) => sum + i.weight, 0);
  if (!titleHit) confidence = Math.min(confidence, 30);
  if (timing === "same_day" || timing === "next_day") confidence += 12;
  else if (timing === "first_week") confidence += 8;
  else if (timing === "first_month") confidence += 4;
  if (official || contentType === "news_or_review") confidence = Math.min(confidence, 20);
  if (!strongEvidence) confidence = Math.min(confidence, 45);
  confidence = Math.max(0, Math.min(99, Math.round(confidence)));

  const distributionLinks = [...new Set([...fileLinks, ...downloadLinks, ...magnets])].slice(0, 15);

  const reason = strongEvidence
    ? `${domain ?? "Source"} shows hard distribution evidence: ${indicators
        .filter((i) => i.strong)
        .map((i) => i.detail)
        .slice(0, 3)
        .join(" ")}${timing !== "unknown" && timing !== "later" ? ` Appeared within the ${timing.replace("_", " ")} release window.` : ""}`
    : `${domain ?? "Source"} mentions the title but no full copy, player, download or file link was found — not classified as distribution.`;

  return {
    url: opts.url,
    domain,
    domainRisk,
    contentType,
    releaseTiming: timing,
    releaseOffsetDays: offsetDays,
    indicators,
    indicatorKeys: indicators.map((i) => i.key),
    strongEvidence,
    confidence,
    screenshot: normalizeShot(page.screenshot) ?? opts.screenshot ?? null,
    pageTitle,
    distributionLinks,
    qualityTags,
    reason,
  };
}
