/**
 * Exact-page classification for Copyright Intelligence.
 *
 * Pure (no network): callers scrape the page, then pass content here.
 * Poster / OCR / actor / title matches prove identity only — never piracy alone.
 */

import { isSafePublicHttpUrl } from "@/lib/deepfake/url-safety.server";
import { hostOf, isExcludedHost } from "./url.server";
import {
  type CopyrightClassification,
  riskBandFor,
  type RiskBand,
} from "./taxonomy";
import { releaseTimingFor, type ReleaseTiming } from "./release-timing";

export interface PiracyIndicator {
  key: string;
  detail: string;
  weight: number;
  strong: boolean;
}

export type PrimaryPurpose =
  | "cinema_or_showtime"
  | "trailer_or_promo"
  | "review_or_news"
  | "cast_or_information"
  | "official_or_authorized"
  | "social_discussion"
  | "artwork_gallery"
  | "listing_or_search"
  | "distribution"
  | "unknown";

export interface PageClassifyInput {
  url: string;
  pageTitle?: string | null;
  markdown?: string;
  html?: string;
  links?: string[];
  /** Protected work title + verified alternates */
  titles: string[];
  releaseYear?: string | null;
  releaseDate?: string | null;
  /** false when crawl failed — fail closed */
  pageInspected: boolean;
  /** true when only a search snippet is available */
  snippetOnly?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface PageClassifyResult {
  classification: CopyrightClassification;
  clientVisible: boolean;
  primaryPurpose: PrimaryPurpose;
  identityMatch: boolean;
  identityEvidence: string[];
  accessEvidence: string[];
  strongAccess: boolean;
  indicators: PiracyIndicator[];
  indicatorKeys: string[];
  distributionLinks: string[];
  qualityTags: string[];
  embedSources: string[];
  confidence: number;
  confidenceBreakdown: {
    identity: number;
    access: number;
    releaseWindow: number;
    penalties: number;
  };
  domainRisk: RiskBand;
  releaseTiming: ReleaseTiming;
  releaseOffsetDays: number | null;
  reason: string;
  canonicalHints: string[];
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

const CINEMA_HOST_HINTS =
  /(voxcinemas|vox\s*cinemas|district\.|bookmyshow|fandango|atomtickets|pvrcinemas|inox\.|cinepolis|amctheatres|regmovies|cinema\s*city|showcase\s*cinemas|odeon|cinemark|ticketnew|ticketmaster)/i;

const CINEMA_PURPOSE_RE =
  /\b(now\s*showing|showtimes?|show\s*times?|book\s*tickets?|buy\s*tickets?|get\s*tickets?|ticket\s*booking|reserve\s*seats?|cinema\s*booking|theatre\s*listing|theater\s*listing|playing\s*at|screening\s*times?|session\s*times?|book\s*now|select\s*seats?|auditorium|imax\s*showtimes?)\b/i;

const TRAILER_PURPOSE_RE =
  /\b(official\s*trailer|watch\s*trailer|trailer\s*out|teaser\s*trailer|song\s*video|lyric\s*video|music\s*video|promo\s*clip|behind\s*the\s*scenes|making\s*of)\b/i;

const REVIEW_PURPOSE_RE =
  /\b(movie\s*review|film\s*review|critic\s*review|rating|recap|explained|first\s*look|box\s*office|interview|press\s*release|news\s*article|opinion)\b/i;

const CAST_PURPOSE_RE =
  /\b(cast\s*and\s*crew|full\s*cast|actor\s*biography|actress\s*profile|character\s*list|crew\s*credits|filming\s*locations?)\b/i;

const SOCIAL_PURPOSE_RE =
  /\b(reddit\.com|r\/|discussion|comment\s*thread|what\s*did\s*you\s*think|spoiler\s*thread)\b/i;

const LISTING_PURPOSE_RE =
  /\b(\/search\b|\/category\/|\/tag\/|\/genre\/|\/latest-movies|movie\s*list|browse\s*movies|all\s*movies)\b/i;

const THEATRE_PRINT_RE =
  /\b(hdcam|camrip|cam[- ]?print|hq[- ]?cam|hd[- ]?cam|hdts|hqts|ts[- ]?print|tc[- ]?rip|theatre\s*print|theater\s*print|cinema\s*recording)\b/i;

const RELEASE_QUALITY_RE =
  /\b(webrip|web[- ]?dl|bluray|blu[- ]?ray|dvdrip|hdrip|brrip|bdrip|predvd|dvdscr|x264|x265|hevc|720p|1080p|2160p)\b/gi;

const FULL_MOVIE_RE =
  /\b(watch\s*(the\s*)?full\s*movie|download\s*(the\s*)?full\s*movie|full\s*movie\s*(online|download|free|hd|watch)?|complete\s*movie|free\s*streaming|stream\s*full\s*film)\b/i;

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(s: string): string[] {
  return normalizeTitle(s)
    .split(" ")
    .filter((t) => t.length > 1 && !/^(the|a|an|of|and|or|in|to)$/i.test(t));
}

/** Exact / near-exact work identity on the crawled page. */
export function hasExactTitleIdentity(
  blob: string,
  titles: string[],
  releaseYear?: string | null,
): { match: boolean; evidence: string[] } {
  const evidence: string[] = [];
  const normBlob = normalizeTitle(blob);
  const year = releaseYear?.slice(0, 4) || null;

  for (const raw of titles) {
    const t = normalizeTitle(raw);
    if (t.length < 3) continue;
    if (normBlob.includes(t)) {
      evidence.push(`exact_title:${raw}`);
      if (year && (normBlob.includes(year) || blob.includes(year))) {
        evidence.push(`release_year:${year}`);
      }
      return { match: true, evidence };
    }
    // Token coverage for slightly punctuated titles
    const tokens = titleTokens(raw);
    if (tokens.length >= 2) {
      const hit = tokens.filter((tok) => normBlob.includes(tok)).length;
      if (hit >= Math.ceil(tokens.length * 0.8)) {
        evidence.push(`title_tokens:${raw}`);
        if (year && (normBlob.includes(year) || blob.includes(year))) {
          evidence.push(`release_year:${year}`);
        }
        return { match: true, evidence };
      }
    }
  }
  return { match: false, evidence };
}

const DISTRIBUTION_OVERRIDE_RE =
  /\b(watch\s*(the\s*)?full\s*movie|download\s*(the\s*)?full\s*movie|watch\s*online|free\s*download|magnet:|\.torrent|webrip|web[- ]?dl|hdcam|camrip|theatre\s*print|theater\s*print|hdts|free\s*streaming|streaming\s*server|file\s*host|embedded\s*player|watch\s*server|download\s*server|\.mkv|\.mp4)\b/i;

export function detectPrimaryPurpose(opts: {
  url: string;
  pageTitle: string | null;
  text: string;
  host: string | null;
}): PrimaryPurpose {
  const blob = `${opts.host ?? ""} ${opts.url} ${opts.pageTitle ?? ""} ${opts.text.slice(0, 8000)}`;
  const hasDistributionOverride = DISTRIBUTION_OVERRIDE_RE.test(blob);

  // Official/licensed hosts without distribution override language.
  if (isExcludedHost(opts.url) && !hasDistributionOverride) {
    if (CINEMA_PURPOSE_RE.test(blob) || CINEMA_HOST_HINTS.test(opts.host ?? "") || CINEMA_HOST_HINTS.test(opts.url)) {
      return "cinema_or_showtime";
    }
    return "official_or_authorized";
  }

  // Cinema/showtime only when booking/showtime language is primary AND no piracy access language.
  // Mere mention of a cinema brand on a piracy page must not hard-reject.
  if (
    !hasDistributionOverride &&
    CINEMA_PURPOSE_RE.test(blob) &&
    (CINEMA_HOST_HINTS.test(opts.host ?? "") ||
      CINEMA_HOST_HINTS.test(opts.url) ||
      CINEMA_PURPOSE_RE.test(`${opts.pageTitle ?? ""}`))
  ) {
    return "cinema_or_showtime";
  }
  if (
    !hasDistributionOverride &&
    CINEMA_PURPOSE_RE.test(blob) &&
    !FULL_MOVIE_RE.test(blob) &&
    !THEATRE_PRINT_RE.test(blob)
  ) {
    return "cinema_or_showtime";
  }

  if (
    !hasDistributionOverride &&
    TRAILER_PURPOSE_RE.test(blob) &&
    !FULL_MOVIE_RE.test(blob) &&
    !THEATRE_PRINT_RE.test(blob) &&
    !/\b(download\s*movie|magnet:)\b/i.test(blob)
  ) {
    return "trailer_or_promo";
  }

  if (
    !hasDistributionOverride &&
    REVIEW_PURPOSE_RE.test(blob) &&
    !FULL_MOVIE_RE.test(blob) &&
    !THEATRE_PRINT_RE.test(blob) &&
    !/\b(download\s*link|magnet:|\.torrent|watch\s*server)\b/i.test(blob)
  ) {
    return "review_or_news";
  }

  if (!hasDistributionOverride && CAST_PURPOSE_RE.test(blob) && !FULL_MOVIE_RE.test(blob)) {
    return "cast_or_information";
  }

  if (
    !hasDistributionOverride &&
    (/(reddit\.com|\/r\/)/i.test(opts.url) || SOCIAL_PURPOSE_RE.test(blob)) &&
    !FULL_MOVIE_RE.test(blob) &&
    !/\b(magnet:|\.torrent|mega\.nz|mediafire|download\s*link)\b/i.test(blob)
  ) {
    return "social_discussion";
  }

  if (
    LISTING_PURPOSE_RE.test(`${opts.url} ${blob}`) &&
    !FULL_MOVIE_RE.test(opts.pageTitle ?? "") &&
    !THEATRE_PRINT_RE.test(opts.pageTitle ?? "") &&
    !hasDistributionOverride
  ) {
    return "listing_or_search";
  }

  if (
    !hasDistributionOverride &&
    /\b(poster\s*gallery|wallpaper|fan\s*art|image\s*gallery)\b/i.test(blob) &&
    !FULL_MOVIE_RE.test(blob)
  ) {
    return "artwork_gallery";
  }

  return "unknown";
}

function purposeToClassification(purpose: PrimaryPurpose): CopyrightClassification | null {
  switch (purpose) {
    case "cinema_or_showtime":
      return "CINEMA_OR_SHOWTIME";
    case "trailer_or_promo":
      return "TRAILER_OR_PROMO";
    case "review_or_news":
      return "REVIEW_OR_NEWS";
    case "cast_or_information":
      return "CAST_OR_INFORMATION";
    case "official_or_authorized":
      return "OFFICIAL_OR_AUTHORIZED";
    case "social_discussion":
      return "SOCIAL_DISCUSSION";
    case "artwork_gallery":
      return "DUPLICATE_ARTWORK_ONLY";
    case "listing_or_search":
      return "UNVERIFIED_LEAD";
    default:
      return null;
  }
}

function safeHttpLinks(links: string[]): string[] {
  const out: string[] = [];
  for (const l of links) {
    if (l.startsWith("magnet:")) {
      out.push(l);
      continue;
    }
    if (isSafePublicHttpUrl(l)) out.push(l);
  }
  return out;
}

function extractEmbedSources(html: string): string[] {
  const out = new Set<string>();
  const attrs = [
    ...html.matchAll(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi),
    ...html.matchAll(/<video[^>]+(?:src|data-src)=["']([^"']+)["']/gi),
    ...html.matchAll(/<source[^>]+src=["']([^"']+)["']/gi),
    ...html.matchAll(/data-(?:url|src|file|video)=["']([^"']+)["']/gi),
    ...html.matchAll(/og:video(?::secure_url)?["'\s]+content=["']([^"']+)["']/gi),
  ];
  for (const m of attrs) {
    const u = m[1]?.trim();
    if (!u) continue;
    if (u.startsWith("magnet:") || isSafePublicHttpUrl(u)) out.add(u);
  }
  // JSON-LD VideoObject contentUrl / embedUrl
  for (const m of html.matchAll(
    /"(?:contentUrl|embedUrl)"\s*:\s*"([^"]+)"/gi,
  )) {
    const u = m[1]?.trim();
    if (u && (u.startsWith("magnet:") || isSafePublicHttpUrl(u))) out.add(u);
  }
  return [...out].slice(0, 20);
}

function decodeOutboundHints(html: string, markdown: string): string[] {
  const out = new Set<string>();
  const blob = `${html}\n${markdown}`;
  for (const m of blob.matchAll(
    /(?:https?:\/\/[^\s"'<>]+|(?:\/(?:watch|download|movie|play|stream|file|dl)\/[^\s"'<>]+))/gi,
  )) {
    const raw = m[0].replace(/[),.;]+$/, "");
    if (raw.startsWith("http") && isSafePublicHttpUrl(raw)) out.add(raw);
  }
  // Common base64-ish redirect wrappers — only accept if decodes to safe http(s)
  for (const m of blob.matchAll(/(?:[?&](?:url|dest|redirect|r|goto)=)([^&\s"'<>]+)/gi)) {
    try {
      const decoded = decodeURIComponent(m[1] ?? "");
      if (isSafePublicHttpUrl(decoded)) out.add(decoded);
    } catch {
      /* ignore */
    }
  }
  return [...out].slice(0, 30);
}

/**
 * Classify an exact crawled page (or fail closed for snippet/crawl failure).
 */
export function classifyCopyrightPage(input: PageClassifyInput): PageClassifyResult {
  const domain = hostOf(input.url);
  const empty = (
    classification: CopyrightClassification,
    reason: string,
    extras: Partial<PageClassifyResult> = {},
  ): PageClassifyResult => {
    const { timing, offsetDays } = releaseTimingFor(input.releaseDate);
    const base: PageClassifyResult = {
      classification,
      clientVisible: false,
      primaryPurpose: "unknown",
      identityMatch: false,
      identityEvidence: [],
      accessEvidence: [],
      strongAccess: false,
      indicators: [],
      indicatorKeys: [],
      distributionLinks: [],
      qualityTags: [],
      embedSources: [],
      confidence: 0,
      confidenceBreakdown: {
        identity: 0,
        access: 0,
        releaseWindow: 0,
        penalties: 0,
      },
      domainRisk: "low",
      releaseTiming: timing,
      releaseOffsetDays: offsetDays,
      reason,
      canonicalHints: [],
    };
    return {
      ...base,
      ...extras,
      classification,
      clientVisible: false,
      reason,
      indicatorKeys: (extras.indicators ?? base.indicators).map((i) => i.key),
      strongAccess: false,
    };
  };

  if (!input.pageInspected || input.snippetOnly) {
    return empty(
      "UNVERIFIED_LEAD",
      input.snippetOnly
        ? "Search snippet alone cannot become a piracy finding — exact-page crawl required."
        : "Exact-page crawl failed or returned empty content. Fail closed — not classified as distribution.",
    );
  }

  const markdown = (input.markdown ?? "").slice(0, 60_000);
  const html = (input.html ?? "").slice(0, 200_000);
  if (!markdown.trim() && !html.trim()) {
    return empty(
      "UNVERIFIED_LEAD",
      "Exact-page crawl returned empty content. Fail closed — not classified as distribution.",
    );
  }

  const links = safeHttpLinks(
    (Array.isArray(input.links) ? input.links : []).filter(
      (l): l is string => typeof l === "string",
    ),
  );
  const pageTitle = input.pageTitle ?? null;
  const textBlob = `${domain ?? ""} ${input.url} ${pageTitle ?? ""} ${markdown}`;
  const blobLower = textBlob.toLowerCase();

  const identity = hasExactTitleIdentity(
    textBlob,
    input.titles,
    input.releaseYear ?? input.releaseDate?.slice(0, 4),
  );

  // Access override for soft negatives. Do NOT treat a generic trailer iframe
  // as override — require piracy/full-movie/file/torrent language or non-YouTube
  // file-host embeds.
  const nonPromoEmbed =
    /<iframe[^>]+(src|data-src)=["'][^"']+/i.test(html) &&
    !/(youtube\.com|youtu\.be|vimeo\.com)/i.test(html) &&
    (FILE_HOSTS.some((h) => html.toLowerCase().includes(h)) ||
      /(doodstream|streamtape|mixdrop|filemoon|\/e\/|\/v\/)/i.test(html));
  const earlyAccessSignal =
    DISTRIBUTION_OVERRIDE_RE.test(blobLower) ||
    /magnet:\?xt=urn:btih/i.test(html) ||
    /\.torrent(\?|"|'|\s|$)/i.test(html) ||
    nonPromoEmbed;

  const purpose = detectPrimaryPurpose({
    url: input.url,
    pageTitle,
    text: markdown,
    host: domain,
  });
  const purposeClass = purposeToClassification(purpose);

  // Hard negative gates — never actionable piracy from these primary purposes
  // unless exact-page access signals are already present (then continue).
  if (
    purposeClass &&
    purpose !== "unknown" &&
    purpose !== "distribution" &&
    !earlyAccessSignal
  ) {
    return empty(purposeClass, `Primary page purpose is ${purpose.replace(/_/g, " ")} — rejected as unauthorized distribution.`, {
      primaryPurpose: purpose,
      identityMatch: identity.match,
      identityEvidence: identity.evidence,
      confidence: identity.match ? 25 : 5,
      confidenceBreakdown: {
        identity: identity.match ? 25 : 0,
        access: 0,
        releaseWindow: 0,
        penalties: 40,
      },
    });
  }

  if (isExcludedHost(input.url) && !earlyAccessSignal) {
    return empty("OFFICIAL_OR_AUTHORIZED", "Official, licensed, ticketing, or news host — not unauthorized distribution.", {
      primaryPurpose: "official_or_authorized",
      identityMatch: identity.match,
      identityEvidence: identity.evidence,
    });
  }

  const indicators: PiracyIndicator[] = [];
  const add = (key: string, detail: string, weight: number, strong = false) => {
    if (!indicators.some((i) => i.key === key)) {
      indicators.push({ key, detail, weight, strong });
    }
  };

  const embedSources = extractEmbedSources(html);
  const outbound = decodeOutboundHints(html, markdown);
  const allDest = [...new Set([...links, ...embedSources, ...outbound])];

  const hasIframePlayer =
    embedSources.length > 0 ||
    /<iframe[^>]+(src|data-src)=["'][^"']*(embed|player|stream|video|\/e\/|\/v\/)/i.test(html) ||
    /<video[\s>]/i.test(html) ||
    /(jwplayer|videojs|plyr\.|clappr|hls\.js|\.m3u8|\.mpd)/i.test(html);

  const playerHosts = FILE_HOSTS.filter((h) => html.toLowerCase().includes(h));
  if (hasIframePlayer || playerHosts.length) {
    add(
      "embedded_player",
      `Embedded video player detected${playerHosts.length ? ` (${playerHosts.slice(0, 3).join(", ")})` : ""}.`,
      30,
      true,
    );
  }

  const downloadLinks = allDest.filter((l) =>
    /(\.mkv|\.mp4|\.avi|\.torrent|\/download|\/dl\/|\/get\/)/i.test(l),
  );
  const downloadCta =
    /(download\s*(now|link|movie|here|hd|full)|click\s*to\s*download|<a[^>]*>\s*download)/i.test(
      `${markdown}\n${html}`,
    );
  if (downloadLinks.length >= 1 || downloadCta) {
    add(
      "download_links",
      `${downloadLinks.length || "Multiple"} download link(s)/buttons offering the file.`,
      28,
      true,
    );
  }

  const fileLinks = allDest.filter((l) => {
    const h = hostOf(l);
    return h ? FILE_HOSTS.some((f) => h === f || h.endsWith(`.${f}`)) : false;
  });
  if (fileLinks.length) {
    add(
      "file_host_links",
      `File-hosting destinations present (${[...new Set(fileLinks.map(hostOf))].slice(0, 3).join(", ")}).`,
      26,
      true,
    );
  }

  const magnets = allDest.filter((l) => l.startsWith("magnet:"));
  const torrentLinks = allDest.filter((l) => /\.torrent(\?|$)/i.test(l));
  const torrentHost = TORRENT_HOSTS.some((t) => (domain ?? "").includes(t));
  if (magnets.length || torrentLinks.length || torrentHost || /magnet:\?xt=urn:btih/i.test(html)) {
    add(
      "torrent_or_magnet",
      magnets.length || torrentLinks.length
        ? `${magnets.length + torrentLinks.length} torrent/magnet link(s) on page.`
        : "Torrent index domain with title match.",
      28,
      true,
    );
  }

  const mirrorMentions = (
    markdown.match(
      /\b(mirror\s*\d?|server\s*\d|watch\s*server|download\s*server|fast\s*server)\b/gi,
    ) ?? []
  );
  if (mirrorMentions.length >= 2 || fileLinks.length >= 2) {
    add(
      "multiple_mirrors",
      `Multiple mirror/server links offered (${mirrorMentions.slice(0, 4).join(", ") || "several file hosts"}).`,
      18,
      true,
    );
  }

  if (FULL_MOVIE_RE.test(`${pageTitle ?? ""} ${markdown}`)) {
    add("full_movie_offer", "Page advertises watching or downloading the complete movie.", 24, true);
  }

  const qualityTags = [...new Set(
    [...(`${pageTitle ?? ""} ${markdown}`).matchAll(RELEASE_QUALITY_RE)].map((m) =>
      m[0].toLowerCase(),
    ),
  )];
  if (qualityTags.length) {
    add(
      "release_quality_tags",
      `Pirate release quality tags: ${qualityTags.slice(0, 6).join(", ")}.`,
      14,
      false,
    );
  }

  const theatrePrint = THEATRE_PRINT_RE.test(blobLower);
  if (theatrePrint) {
    add("cam_theatre_print", "Cam / theatre-print release indicators on the page.", 22, true);
  }

  // Telegram / channel offering full movie explicitly
  if (
    /(t\.me|telegram\.me|telegram)/i.test(blobLower) &&
    FULL_MOVIE_RE.test(blobLower)
  ) {
    add("telegram_full_movie", "Telegram/channel link explicitly offers the full movie.", 22, true);
  }

  // Runtime / multipart hints consistent with a full work
  if (/\b(\d{2,3}\s*min(?:utes)?|runtime\s*[:\s]\s*\d|part\s*[12]\s*of\s*[12]|cd\s*[12])\b/i.test(blobLower)) {
    add("runtime_or_multipart", "Runtime or multipart evidence consistent with a full-length work.", 10, false);
  }

  const strongCount = indicators.filter((i) => i.strong).length;
  const strongAccess =
    identity.match &&
    (strongCount >= 1 ||
      (indicators.length >= 3 && qualityTags.length > 0 && FULL_MOVIE_RE.test(blobLower)));

  const accessEvidence = indicators.filter((i) => i.strong).map((i) => i.detail);

  // Identity without access → artwork / unverified only
  if (!strongAccess) {
    if (identity.match && indicators.length === 0) {
      return empty("DUPLICATE_ARTWORK_ONLY", "Title/artwork identity matched, but no distribution or access evidence on the exact page.", {
        primaryPurpose: "artwork_gallery",
        identityMatch: true,
        identityEvidence: identity.evidence,
        indicators,
        confidence: 30,
        confidenceBreakdown: { identity: 30, access: 0, releaseWindow: 0, penalties: 0 },
      });
    }
    if (identity.match) {
      return empty("UNVERIFIED_LEAD", "Exact title present with weak/incomplete access signals — retained for internal review only.", {
        primaryPurpose: purpose,
        identityMatch: true,
        identityEvidence: identity.evidence,
        accessEvidence: indicators.map((i) => i.detail),
        indicators,
        confidence: Math.min(45, indicators.reduce((s, i) => s + i.weight, 0)),
        confidenceBreakdown: {
          identity: 20,
          access: Math.min(25, indicators.reduce((s, i) => s + i.weight, 0)),
          releaseWindow: 0,
          penalties: 0,
        },
      });
    }
    return empty("UNRELATED", "Page does not establish exact work identity with distribution access evidence.", {
      primaryPurpose: purpose,
      indicators,
    });
  }

  // ---- actionable classification ------------------------------------------
  let classification: CopyrightClassification = "PROBABLE_UNAUTHORIZED_STREAM";
  if (theatrePrint) {
    classification = "THEATRE_PRINT_DISTRIBUTION";
  } else if (magnets.length || torrentLinks.length || torrentHost) {
    classification = "TORRENT_OR_MAGNET";
  } else if (fileLinks.length && !hasIframePlayer) {
    classification = "FILE_HOST_DISTRIBUTION";
  } else if (downloadLinks.length || downloadCta) {
    classification = "DOWNLOAD_PAGE";
  } else if (
    /(ok\.ru|vk\.com|dailymotion|rumble|bitchute|odysee|archive\.org)/i.test(domain ?? "") &&
    (hasIframePlayer || FULL_MOVIE_RE.test(blobLower))
  ) {
    classification = "VIDEO_HOST_REUPLOAD";
  } else if (mirrorMentions.length >= 2 && !hasIframePlayer) {
    classification = "MIRROR_OR_REDIRECT";
  } else if (
    hasIframePlayer &&
    (FULL_MOVIE_RE.test(blobLower) || qualityTags.length || theatrePrint)
  ) {
    classification = "VERIFIED_UNAUTHORIZED_STREAM";
  } else if (hasIframePlayer || FULL_MOVIE_RE.test(blobLower)) {
    classification = "PROBABLE_UNAUTHORIZED_STREAM";
  }

  const { timing, offsetDays } = releaseTimingFor(input.releaseDate);
  let identityScore = identity.evidence.length >= 2 ? 35 : 28;
  let accessScore = Math.min(50, indicators.filter((i) => i.strong).reduce((s, i) => s + i.weight, 0));
  let releaseBonus = 0;
  if (timing === "same_day" || timing === "next_day") releaseBonus = 12;
  else if (timing === "first_week") releaseBonus = 8;
  else if (timing === "first_month") releaseBonus = 4;

  let confidence = Math.max(0, Math.min(99, identityScore + accessScore + releaseBonus));
  if (classification === "VERIFIED_UNAUTHORIZED_STREAM") {
    confidence = Math.max(confidence, 85);
  } else if (classification === "THEATRE_PRINT_DISTRIBUTION" || classification === "TORRENT_OR_MAGNET") {
    confidence = Math.max(confidence, 80);
  } else {
    confidence = Math.max(70, Math.min(confidence, 88));
  }

  const domainRisk = riskBandFor({
    classification,
    strongAccess: true,
    theatrePrint,
    torrentOrFile: Boolean(magnets.length || torrentLinks.length || fileLinks.length),
    mirrorCount: Math.max(mirrorMentions.length, fileLinks.length),
    releaseTiming: timing,
  });

  const distributionLinks = [...new Set([...fileLinks, ...downloadLinks, ...magnets, ...torrentLinks, ...embedSources])]
    .filter((l) => l.startsWith("magnet:") || isSafePublicHttpUrl(l))
    .slice(0, 15);

  const reason =
    `${domain ?? "Source"} shows exact-title identity plus distribution evidence (${indicators
      .filter((i) => i.strong)
      .map((i) => i.key)
      .slice(0, 4)
      .join(", ")}). ` +
    `Classified as ${classification.replace(/_/g, " ")} for rights-holder review — not a final legal determination.` +
    (timing !== "unknown" && timing !== "later"
      ? ` Appeared within the ${timing.replace(/_/g, " ")} release window.`
      : "");

  return {
    classification,
    clientVisible: true,
    primaryPurpose: "distribution",
    identityMatch: true,
    identityEvidence: identity.evidence,
    accessEvidence,
    strongAccess: true,
    indicators,
    indicatorKeys: indicators.map((i) => i.key),
    distributionLinks,
    qualityTags,
    embedSources,
    confidence,
    confidenceBreakdown: {
      identity: identityScore,
      access: accessScore,
      releaseWindow: releaseBonus,
      penalties: 0,
    },
    domainRisk,
    releaseTiming: timing,
    releaseOffsetDays: offsetDays,
    reason,
    canonicalHints: outbound.slice(0, 5),
  };
}

/**
 * Extract same-domain detail URLs from a listing/search page that appear to
 * match the protected title. Listing pages themselves are never evidence.
 */
export function extractTitleMatchedDetailLinks(opts: {
  pageUrl: string;
  html: string;
  markdown: string;
  links: string[];
  titles: string[];
  limit?: number;
}): string[] {
  const host = hostOf(opts.pageUrl);
  if (!host) return [];
  const limit = opts.limit ?? 6;
  const titles = opts.titles.map(normalizeTitle).filter((t) => t.length > 2);
  const candidates = safeHttpLinks(opts.links);
  const out: string[] = [];
  const seen = new Set<string>();

  for (const href of candidates) {
    const h = hostOf(href);
    if (!h || h !== host) continue;
    if (href === opts.pageUrl) continue;
    // Skip obvious listing/search paths
    if (LISTING_PURPOSE_RE.test(href)) continue;
    const pathBlob = normalizeTitle(`${href} ${opts.markdown.slice(0, 2000)}`);
    const titleHit = titles.some((t) => {
      const slug = t.replace(/\s+/g, "-");
      const compact = t.replace(/\s+/g, "");
      return (
        pathBlob.includes(t) ||
        href.toLowerCase().includes(slug) ||
        href.toLowerCase().includes(compact)
      );
    });
    if (!titleHit) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
    if (out.length >= limit) break;
  }

  // Also pull anchors from HTML with title-ish text
  if (out.length < limit) {
    for (const m of opts.html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const hrefRaw = m[1]?.trim();
      const label = normalizeTitle((m[2] ?? "").replace(/<[^>]+>/g, " "));
      if (!hrefRaw) continue;
      let href = hrefRaw;
      try {
        href = new URL(hrefRaw, opts.pageUrl).toString();
      } catch {
        continue;
      }
      if (!isSafePublicHttpUrl(href)) continue;
      if (hostOf(href) !== host) continue;
      if (LISTING_PURPOSE_RE.test(href)) continue;
      if (!titles.some((t) => label.includes(t) || normalizeTitle(href).includes(t.replace(/\s+/g, "")))) {
        continue;
      }
      if (seen.has(href)) continue;
      seen.add(href);
      out.push(href);
      if (out.length >= limit) break;
    }
  }

  return out.slice(0, limit);
}
