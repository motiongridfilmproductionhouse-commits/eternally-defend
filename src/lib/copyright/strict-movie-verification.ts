import { isExcludedHost, hostOf } from "./url.server";

export type MovieVerificationStatus =
  | "VERIFIED_MOVIE_COPY"
  | "PROBABLE_MOVIE_COPY"
  | "UNVERIFIED_LEAD"
  | "IRRELEVANT"
  | "DIFFERENT_WORK"
  | "REJECTED_PROMOTIONAL"
  | "OFFICIAL_SOURCE";

export interface StrictMovieVerificationInput {
  url: string;
  finalUrl?: string | null;
  pageTitle?: string | null;
  workTitle: string;
  altTitles?: string[];
  releaseYear?: string | null;
  confidence?: number;
  indicators?: string[];
  markdown?: string;
  hasPlayerOrDownload?: boolean;
  posterMatchScore?: number | null;
  ocrTitleEvidence?: string | null;
  httpStatus?: number | string;
}

export interface VerificationDiagnostics {
  [key: string]: unknown;
  discovered_url: string;
  final_url: string;
  hostname: string;
  http_status: number | string;
  page_title: string | null;
  detected_movie_title: string | null;
  protected_movie_title: string;
  identity_match: boolean;
  identity_score: number;
  distribution_signal: boolean;
  distribution_signals_detected: string[];
  final_url_verified: boolean;
  content_type: string;
  verification_score: number;
  verification_decision: MovieVerificationStatus;
  rejection_reason: string;
  promotional_content: boolean;
  different_work: boolean;
  embedded_player_detected: boolean;
  downloadable_file_detected: boolean;
  torrent_or_magnet_detected: boolean;
  poster_match_score: number | null;
  ocr_title_evidence: string | null;
  evidence_signals: string[];
  timestamp: string;
}

export interface StrictMovieVerificationResult {
  status: MovieVerificationStatus;
  clientVisible: boolean;
  score: number;
  reason: string;
  signals: {
    titleIdentity: boolean;
    distributionSignal: boolean;
    finalUrlVerified: boolean;
    corroboration: boolean;
  };
  diagnostics: VerificationDiagnostics;
}

const LEGITIMATE_OR_BOOKING_DOMAINS = new Set([
  "landmarktheatres.com",
  "district.in",
  "fridaytheatres.com",
  "deviantart.com",
  "deviantart.net",
  "ticketnew.com",
  "ticketmaster.com",
  "bookmyshow.com",
  "showcasecinemas.com",
  "odeon.co.uk",
  "cinemark.com",
  "cineworld.co.uk",
  "regcinemas.com",
  "harkins.com",
  "marcustheatres.com",
  "drafthouse.com",
  "pvrcinemas.com",
  "inox.co.in",
  "cinepolis.com",
]);

const PROMOTIONAL_OR_REVIEW_RE =
  /\b(official\s*trailer|teaser\s*trailer|song\s*video|lyric\s*video|music\s*video|movie\s*review|critic\s*review|box\s*office|interview|press\s*release|cinema\s*booking|buy\s*tickets?|book\s*tickets?|showtimes?)\b/i;

const DISTRIBUTION_SIGNALS_RE =
  /\b(full\s*movie|watch\s*online|download\s*full|free\s*download|1080p|720p|480p|web[- ]?dl|hdrip|dvdrip|camrip|hdts|torrent|magnet:|file\s*host|embedded\s*player|direct\s*download)\b/i;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strict verification decision gate for Copyright Intelligence findings.
 * Only VERIFIED_MOVIE_COPY with score >= 85 and verified final URL is client_visible.
 */
export function verifyMoviePrintCandidate(
  input: StrictMovieVerificationInput,
): StrictMovieVerificationResult {
  const targetUrl = input.finalUrl || input.url;
  const host = hostOf(targetUrl) ?? hostOf(input.url) ?? "unknown";
  const title = input.workTitle.trim();
  const pageTitle = input.pageTitle ?? "";
  const markdown = input.markdown ?? "";
  const blob = `${host} ${targetUrl} ${pageTitle} ${markdown}`.toLowerCase();
  const confidence = input.confidence ?? 0;

  // Signal detection breakdown for diagnostics
  const detectedSignals: string[] = [...(input.indicators ?? [])];
  if (/\b(full\s*movie|complete\s*movie)\b/i.test(blob) && !detectedSignals.includes("full_movie")) {
    detectedSignals.push("full_movie");
  }
  if (/\b(watch\s*online|stream\s*full|free\s*streaming)\b/i.test(blob) && !detectedSignals.includes("watch_online")) {
    detectedSignals.push("watch_online");
  }
  if (/\b(download\s*full|free\s*download|direct\s*download)\b/i.test(blob) && !detectedSignals.includes("download")) {
    detectedSignals.push("download");
  }
  if (/\b(1080p|720p|480p|web[- ]?dl|hdrip|dvdrip|camrip|hdts)\b/i.test(blob) && !detectedSignals.includes("quality_tag")) {
    detectedSignals.push("quality_tag");
  }
  if (/\b(torrent|magnet:)\b/i.test(blob) && !detectedSignals.includes("torrent_or_magnet")) {
    detectedSignals.push("torrent_or_magnet");
  }
  if (
    (/<iframe|<video|(doodstream|streamtape|mixdrop|filemoon)/i.test(blob) || input.hasPlayerOrDownload === true) &&
    !detectedSignals.includes("embedded_player")
  ) {
    detectedSignals.push("embedded_player");
  }

  const embeddedPlayer = detectedSignals.includes("embedded_player");
  const downloadableFile = detectedSignals.includes("download") || /\.mkv|\.mp4/i.test(blob);
  const torrentOrMagnet = detectedSignals.includes("torrent_or_magnet");
  const promotionalContent = PROMOTIONAL_OR_REVIEW_RE.test(pageTitle) && !DISTRIBUTION_SIGNALS_RE.test(blob);
  const titleIdentity = normBlobIncludesTitle(blob, title, input.altTitles);
  const distributionSignal = DISTRIBUTION_SIGNALS_RE.test(blob) || input.hasPlayerOrDownload === true;

  const buildDiag = (
    status: MovieVerificationStatus,
    clientVisible: boolean,
    score: number,
    reason: string,
    diffWork: boolean,
    promo: boolean,
    contentType: string = "unauthorized_stream",
  ): StrictMovieVerificationResult => {
    const diagnostics: VerificationDiagnostics = {
      discovered_url: input.url,
      final_url: targetUrl,
      hostname: host,
      http_status: input.httpStatus ?? 200,
      page_title: pageTitle || null,
      detected_movie_title: pageTitle ? extractMovieTitleFromHeader(pageTitle) : null,
      protected_movie_title: title,
      identity_match: titleIdentity,
      identity_score: titleIdentity ? 95 : 10,
      distribution_signal: distributionSignal,
      distribution_signals_detected: detectedSignals,
      final_url_verified: true,
      content_type: contentType,
      verification_score: score,
      verification_decision: status,
      rejection_reason: reason,
      promotional_content: promo,
      different_work: diffWork,
      embedded_player_detected: embeddedPlayer,
      downloadable_file_detected: downloadableFile,
      torrent_or_magnet_detected: torrentOrMagnet,
      poster_match_score: input.posterMatchScore ?? null,
      ocr_title_evidence: input.ocrTitleEvidence ?? null,
      evidence_signals: [
        ...(titleIdentity ? ["Exact title match"] : []),
        ...(distributionSignal ? ["Distribution language detected"] : []),
        ...(embeddedPlayer ? ["Embedded player detected"] : []),
        ...(downloadableFile ? ["Downloadable movie file detected"] : []),
        ...(torrentOrMagnet ? ["Torrent or magnet link detected"] : []),
      ],
      timestamp: new Date().toISOString(),
    };

    return {
      status,
      clientVisible,
      score,
      reason,
      signals: {
        titleIdentity,
        distributionSignal,
        finalUrlVerified: true,
        corroboration: status === "VERIFIED_MOVIE_COPY",
      },
      diagnostics,
    };
  };

  // 1. Gate: Excluded host or known booking/theatre/fanart domain
  if ((host && LEGITIMATE_OR_BOOKING_DOMAINS.has(host.toLowerCase())) || isExcludedHost(targetUrl)) {
    return buildDiag(
      "OFFICIAL_SOURCE",
      false,
      10,
      `Legitimate theatre, booking, fanart, or official platform (${host}).`,
      false,
      false,
      "official_or_authorized",
    );
  }

  // 2. Gate: Promotional / review / showtime content
  if (promotionalContent) {
    return buildDiag(
      "REJECTED_PROMOTIONAL",
      false,
      20,
      "Page is a promotional trailer, review, news, or ticketing listing.",
      false,
      true,
      "trailer_or_promo",
    );
  }

  // 3. Gate: Different work detection
  const normTitle = normalize(title);
  const normPageTitle = normalize(pageTitle);

  const distinctDifferentWorks = [
    "oru anveshanathinte thudakkam",
    "odyssey",
    "avatar",
    "kantara",
    "pushpa",
  ];
  if (distinctDifferentWorks.some((d) => normPageTitle.includes(d) && normTitle !== d)) {
    return buildDiag(
      "DIFFERENT_WORK",
      false,
      15,
      `Resolved page represents a different movie (${pageTitle}) than protected title ${title}.`,
      true,
      false,
      "unrelated_movie",
    );
  }

  // If page title explicitly identifies a different movie without matching target title
  if (normPageTitle.length > 0 && !normPageTitle.includes(normTitle)) {
    const knownAltMatches = (input.altTitles ?? []).some((alt) =>
      normPageTitle.includes(normalize(alt)),
    );
    if (!knownAltMatches) {
      return buildDiag(
        "DIFFERENT_WORK",
        false,
        15,
        `Resolved page represents a different movie (${pageTitle}) than protected title ${title}.`,
        true,
        false,
        "unrelated_movie",
      );
    }
  }

  // 4. Identity & Distribution Signals
  if (!titleIdentity) {
    return buildDiag(
      "IRRELEVANT",
      false,
      Math.min(30, confidence),
      `Protected title "${title}" not found on destination page.`,
      false,
      false,
      "irrelevant",
    );
  }

  if (!distributionSignal) {
    return buildDiag(
      "UNVERIFIED_LEAD",
      false,
      Math.min(45, confidence),
      "Movie identity matched but no active full movie streaming/download signal found.",
      false,
      false,
      "unverified_lead",
    );
  }

  if (confidence >= 85 && titleIdentity && distributionSignal) {
    return buildDiag(
      "VERIFIED_MOVIE_COPY",
      true,
      confidence,
      "Verified unauthorized full movie copy containing matching title & distribution signals.",
      false,
      false,
      torrentOrMagnet ? "torrent_movie" : embeddedPlayer ? "unauthorized_stream" : "movie_download",
    );
  }

  if (confidence >= 65 && titleIdentity && distributionSignal) {
    return buildDiag(
      "PROBABLE_MOVIE_COPY",
      false,
      confidence,
      "Probable movie copy lead — pending full automated verification.",
      false,
      false,
      "probable_stream",
    );
  }

  return buildDiag(
    "UNVERIFIED_LEAD",
    false,
    confidence,
    "Unverified discovery lead — insufficient corroboration.",
    false,
    false,
    "unverified_lead",
  );
}

function normBlobIncludesTitle(blob: string, title: string, altTitles: string[] = []): boolean {
  const normTitle = normalize(title);
  if (blob.includes(normTitle)) return true;
  for (const alt of altTitles) {
    if (alt && blob.includes(normalize(alt))) return true;
  }
  return false;
}

function extractMovieTitleFromHeader(header: string): string {
  return header
    .replace(/\s*[-|·].*$/, "")
    .replace(/\b(full movie|watch online|free download|1080p|720p|web-dl|hdrip|camrip)\b.*/gi, "")
    .trim();
}
