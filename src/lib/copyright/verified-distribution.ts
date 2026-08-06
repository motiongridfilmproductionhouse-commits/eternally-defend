/**
 * Verified illegal distribution gate.
 *
 * The user-facing Copyright Investigation surfaces (threat results, timeline,
 * map, reports, PDF) must only ever show websites where unauthorized
 * distribution of the protected work was actually verified. Platforms that were
 * merely searched, queried or crawled during discovery stay in internal logs.
 */

import { isActionablePiracy, resolveClassification } from "./taxonomy";

/** Confidence a finding must exceed to be presented as verified infringement. */
export const VERIFIED_DISTRIBUTION_THRESHOLD = 70;

/**
 * Mainstream platforms, catalogs, reference and news sites. These are visited
 * during discovery but must never be presented as infringement targets.
 */
const NEVER_DISPLAY_HOSTS = [
  // Social platforms
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "messenger.com",
  "x.com",
  "twitter.com",
  "t.co",
  "reddit.com",
  "redd.it",
  "tiktok.com",
  "pinterest.com",
  "pinimg.com",
  "linkedin.com",
  "threads.net",
  "snapchat.com",
  "tumblr.com",
  "quora.com",
  "medium.com",
  // Video / audio platforms
  "youtube.com",
  "youtu.be",
  "spotify.com",
  "soundcloud.com",
  "twitch.tv",
  "vimeo.com",
  // Reference / catalog
  "imdb.com",
  "wikipedia.org",
  "wikimedia.org",
  "letterboxd.com",
  "rottentomatoes.com",
  "metacritic.com",
  "themoviedb.org",
  "justwatch.com",
  "bookmyshow.com",
  // Search engines and portals
  "google.com",
  "google.co.in",
  "bing.com",
  "duckduckgo.com",
  "yahoo.com",
  "yandex.com",
  "baidu.com",
  "ask.com",
  // Official / authorized distribution
  "netflix.com",
  "primevideo.com",
  "amazon.com",
  "amazon.in",
  "hotstar.com",
  "disneyplus.com",
  "sonyliv.com",
  "zee5.com",
  "aha.video",
  "jiocinema.com",
  "jiohotstar.com",
  "sunnxt.com",
  "manoramamax.com",
  "simplysouth.tv",
  "appletv.com",
  "apple.com",
  "itunes.apple.com",
  "play.google.com",
  "pluto.tv",
  "tubitv.com",
  "mxplayer.in",
  "erosnow.com",
  "hulu.com",
  "max.com",
  "peacocktv.com",
  "paramountplus.com",
  // News / press
  "timesofindia.indiatimes.com",
  "indiatimes.com",
  "hindustantimes.com",
  "thehindu.com",
  "ndtv.com",
  "news18.com",
  "indianexpress.com",
  "firstpost.com",
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "variety.com",
  "deadline.com",
  "hollywoodreporter.com",
  "onmanorama.com",
  "mathrubhumi.com",
  "manoramaonline.com",
  "asianetnews.com",
  "cinemaexpress.com",
  "pinkvilla.com",
  "koimoi.com",
  "bollywoodhungama.com",
  // Blog / CMS platforms used for commentary rather than distribution
  "blogspot.com",
  "wordpress.com",
  "substack.com",
];

/**
 * Cloud storage and generic hosting: allowed only when the protected content
 * itself was verified on the page (handled by the evidence checks below).
 */
const CONDITIONAL_HOSTS = [
  "drive.google.com",
  "docs.google.com",
  "mega.nz",
  "mediafire.com",
  "dropbox.com",
  "onedrive.live.com",
  "1fichier.com",
  "gofile.io",
  "pixeldrain.com",
  "terabox.com",
  "terabox.app",
  "1024terabox.com",
];

function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;
  let host = value.trim().toLowerCase();
  if (!host) return null;
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, "").split("/")[0] ?? "";
  return host || null;
}

function hostMatches(host: string, list: string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** True when a host is a mainstream platform that must never be shown as a target. */
export function isNeverDisplayHost(value: string | null | undefined): boolean {
  const host = normalizeHost(value);
  if (!host) return true;
  return hostMatches(host, NEVER_DISPLAY_HOSTS);
}

/** True when the host only qualifies if the protected file is verified on it. */
export function isConditionalHost(value: string | null | undefined): boolean {
  const host = normalizeHost(value);
  if (!host) return false;
  return hostMatches(host, CONDITIONAL_HOSTS);
}

const OFFICIAL_CLASSIFICATIONS = new Set([
  "OFFICIAL_OR_AUTHORIZED",
  "OFFICIAL_OR_AUTHORIZED_PAGE",
  "CATALOG_OR_LISTING",
  "CINEMA_OR_SHOWTIME",
  "TRAILER_OR_PROMO",
  "TRAILER_OR_PROMOTIONAL",
  "REVIEW_OR_NEWS",
  "CAST_OR_INFORMATION",
  "SOCIAL_DISCUSSION",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export interface VerifiedDistributionInput {
  source_url?: string | null;
  url?: string | null;
  detection_type?: string | null;
  confidence?: number | null;
  evidence?: unknown;
}

export interface VerifiedDistributionVerdict {
  verified: boolean;
  /** Machine-readable reason a source was excluded from user-facing results. */
  reason:
    | "verified"
    | "platform_not_displayable"
    | "not_publicly_accessible"
    | "title_not_identified"
    | "no_distribution_evidence"
    | "below_threshold"
    | "official_or_authorized";
}

/**
 * All five verification conditions: publicly accessible, protected title
 * positively identified, unauthorized distribution evidence present, confidence
 * above the configured threshold, and not an official/authorized source.
 */
export function verifyIllegalDistribution(
  input: VerifiedDistributionInput,
  threshold: number = VERIFIED_DISTRIBUTION_THRESHOLD,
): VerifiedDistributionVerdict {
  const url = input.source_url ?? input.url ?? null;
  if (isNeverDisplayHost(url)) {
    return { verified: false, reason: "platform_not_displayable" };
  }

  const ev = record(input.evidence);
  const dist = record(ev.distribution);
  const pageEvidence = record(ev.page_evidence);

  const crawlFailed = ev.crawl_failed === true || dist.crawl_failed === true;
  const reachability = typeof ev.current_reachability === "string" ? ev.current_reachability : null;
  if (crawlFailed || reachability === "unreachable") {
    return { verified: false, reason: "not_publicly_accessible" };
  }

  const classification = resolveClassification({
    detectionType: input.detection_type,
    distributionClassification:
      (typeof dist.classification === "string" && dist.classification) ||
      (typeof ev.classification === "string" ? ev.classification : null),
    contentType:
      (typeof dist.content_type === "string" && dist.content_type) ||
      (typeof ev.website_type === "string" ? ev.website_type : null),
    strongEvidence: typeof dist.strong_evidence === "boolean" ? dist.strong_evidence : undefined,
  });

  if (OFFICIAL_CLASSIFICATIONS.has(classification) || ev.official_source === true) {
    return { verified: false, reason: "official_or_authorized" };
  }
  if (!isActionablePiracy(classification)) {
    return { verified: false, reason: "no_distribution_evidence" };
  }

  // Historical rows that were confirmed as piracy in an earlier verified scan
  // carry their evidence in prior_* fields; treat that as identity/access proof.
  const priorConfirmed =
    ev.historical_preservation === true &&
    typeof ev.prior_classification === "string" &&
    isActionablePiracy(ev.prior_classification) &&
    !OFFICIAL_CLASSIFICATIONS.has(ev.prior_classification);

  const titleIdentity = record(pageEvidence.titleIdentity);
  const identityMatched =
    titleIdentity.matched === true ||
    stringArray(dist.identity_evidence).length > 0 ||
    stringArray(ev.identity_evidence).length > 0;
  const strongDistributionEvidence = dist.strong_evidence === true || ev.strong_evidence === true;
  // A VERIFIED_* classification with strong page evidence already encodes a
  // positive title identification made by the analysis pipeline.
  const identityProven =
    identityMatched ||
    priorConfirmed ||
    (strongDistributionEvidence && classification.startsWith("VERIFIED_"));
  if (!identityProven) {
    return { verified: false, reason: "title_not_identified" };
  }

  const accessEvidence = record(pageEvidence.accessEvidence);
  const accessStrength =
    typeof accessEvidence.strength === "string" ? accessEvidence.strength : null;
  const accessSignals = [
    ...stringArray(accessEvidence.signals),
    ...stringArray(dist.access_evidence),
    ...stringArray(ev.access_evidence),
  ];
  const strongEvidence =
    dist.strong_evidence === true || ev.strong_evidence === true || accessStrength === "strong";
  if (!strongEvidence && accessSignals.length === 0 && !priorConfirmed) {
    return { verified: false, reason: "no_distribution_evidence" };
  }
  // Cloud storage and generic hosts require the file itself, not just a mention.
  if (isConditionalHost(url) && !strongEvidence) {
    return { verified: false, reason: "no_distribution_evidence" };
  }

  const confidence = Math.round(input.confidence ?? 0);
  if (confidence < threshold) {
    return { verified: false, reason: "below_threshold" };
  }

  return { verified: true, reason: "verified" };
}

/** Convenience predicate for filtering user-facing lists. */
export function isVerifiedIllegalDistribution(
  input: VerifiedDistributionInput,
  threshold: number = VERIFIED_DISTRIBUTION_THRESHOLD,
): boolean {
  return verifyIllegalDistribution(input, threshold).verified;
}
