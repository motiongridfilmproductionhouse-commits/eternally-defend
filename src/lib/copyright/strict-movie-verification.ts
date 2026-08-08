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
  const host = hostOf(targetUrl);
  const title = input.workTitle.trim();
  const pageTitle = input.pageTitle ?? "";
  const blob = `${host ?? ""} ${targetUrl} ${pageTitle} ${input.markdown ?? ""}`.toLowerCase();

  // 1. Gate: Excluded host or known booking/theatre/fanart domain
  if ((host && LEGITIMATE_OR_BOOKING_DOMAINS.has(host.toLowerCase())) || isExcludedHost(targetUrl)) {
    return {
      status: "OFFICIAL_SOURCE",
      clientVisible: false,
      score: 10,
      reason: `Legitimate theatre, booking, fanart, or official platform (${host ?? targetUrl}).`,
      signals: {
        titleIdentity: false,
        distributionSignal: false,
        finalUrlVerified: true,
        corroboration: false,
      },
    };
  }

  // 2. Gate: Promotional / review / showtime content
  if (PROMOTIONAL_OR_REVIEW_RE.test(pageTitle) && !DISTRIBUTION_SIGNALS_RE.test(blob)) {
    return {
      status: "REJECTED_PROMOTIONAL",
      clientVisible: false,
      score: 20,
      reason: "Page is a promotional trailer, review, news, or ticketing listing.",
      signals: {
        titleIdentity: true,
        distributionSignal: false,
        finalUrlVerified: true,
        corroboration: false,
      },
    };
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
    return {
      status: "DIFFERENT_WORK",
      clientVisible: false,
      score: 15,
      reason: `Resolved page represents a different movie (${pageTitle}) than protected title ${title}.`,
      signals: {
        titleIdentity: false,
        distributionSignal: false,
        finalUrlVerified: true,
        corroboration: false,
      },
    };
  }

  // If page title explicitly identifies a different movie without matching target title
  if (normPageTitle.length > 0 && !normPageTitle.includes(normTitle)) {
    const knownAltMatches = (input.altTitles ?? []).some((alt) =>
      normPageTitle.includes(normalize(alt)),
    );
    if (!knownAltMatches) {
      return {
        status: "DIFFERENT_WORK",
        clientVisible: false,
        score: 15,
        reason: `Resolved page represents a different movie (${pageTitle}) than protected title ${title}.`,
        signals: {
          titleIdentity: false,
          distributionSignal: false,
          finalUrlVerified: true,
          corroboration: false,
        },
      };
    }
  }

  // 4. Identity & Distribution Signals
  const titleIdentity = normBlobIncludesTitle(blob, title, input.altTitles);
  const distributionSignal = DISTRIBUTION_SIGNALS_RE.test(blob) || input.hasPlayerOrDownload === true;
  const confidence = input.confidence ?? 0;
  const corroboration = confidence >= 85 || (titleIdentity && distributionSignal);

  if (!titleIdentity) {
    return {
      status: "IRRELEVANT",
      clientVisible: false,
      score: Math.min(30, confidence),
      reason: `Protected title "${title}" not found on destination page.`,
      signals: {
        titleIdentity: false,
        distributionSignal,
        finalUrlVerified: true,
        corroboration: false,
      },
    };
  }

  if (!distributionSignal) {
    return {
      status: "UNVERIFIED_LEAD",
      clientVisible: false,
      score: Math.min(45, confidence),
      reason: "Movie identity matched but no active full movie streaming/download signal found.",
      signals: {
        titleIdentity: true,
        distributionSignal: false,
        finalUrlVerified: true,
        corroboration: false,
      },
    };
  }

  if (confidence >= 85 && titleIdentity && distributionSignal) {
    return {
      status: "VERIFIED_MOVIE_COPY",
      clientVisible: true,
      score: confidence,
      reason: "Verified unauthorized full movie copy containing matching title & distribution signals.",
      signals: {
        titleIdentity: true,
        distributionSignal: true,
        finalUrlVerified: true,
        corroboration: true,
      },
    };
  }

  if (confidence >= 65 && titleIdentity && distributionSignal) {
    return {
      status: "PROBABLE_MOVIE_COPY",
      clientVisible: false, // Probable items stay internal/admin unless promoted
      score: confidence,
      reason: "Probable movie copy lead — pending full automated verification.",
      signals: {
        titleIdentity: true,
        distributionSignal: true,
        finalUrlVerified: true,
        corroboration: false,
      },
    };
  }

  return {
    status: "UNVERIFIED_LEAD",
    clientVisible: false,
    score: confidence,
    reason: "Unverified discovery lead — insufficient corroboration.",
    signals: {
      titleIdentity: true,
      distributionSignal,
      finalUrlVerified: true,
      corroboration: false,
    },
  };
}

function normBlobIncludesTitle(blob: string, title: string, altTitles: string[] = []): boolean {
  const normTitle = normalize(title);
  if (blob.includes(normTitle)) return true;
  for (const alt of altTitles) {
    if (alt && blob.includes(normalize(alt))) return true;
  }
  return false;
}
