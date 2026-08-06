/**
 * Release Protection & Automatic Leak Monitoring — core logic (public sources only).
 */

export type ReleaseType =
  "theatrical" | "festival" | "streaming" | "television" | "direct-to-video";

export type AlertThreshold =
  "critical_only" | "high_and_critical" | "all_verified" | "daily_summary";

export type CadenceProfile = "default" | "custom";

export type ReadinessLevel = "not_ready" | "basic" | "strong" | "high_confidence";

export type LeakRiskLevel = "critical" | "high" | "medium" | "low" | "contextual";

export type YoutubeLeakClassification =
  | "official_trailer"
  | "teaser"
  | "song"
  | "review"
  | "reaction"
  | "interview"
  | "news"
  | "fan_edit"
  | "suspected_long_form"
  | "suspected_leaked_footage"
  | "suspected_full_film"
  | "unrelated";

export interface ReleaseProtectionSettings {
  enabled: boolean;
  release_date: string;
  release_timezone: string;
  release_type: ReleaseType;
  release_countries: string[];
  languages: string[];
  primary_language: string;
  alternate_titles?: string[];
  alternate_languages?: string[];
  studio?: string;
  distributor?: string;
  ott_platform?: string;
  premiere_date?: string;
  censor_date?: string;
  press_screening_date?: string;
  trailer_release_date?: string;
  embargo_date?: string;
  digital_release_date?: string;
  home_video_release_date?: string;
  alert_threshold: AlertThreshold;
  cadence_profile: CadenceProfile;
  custom_cadence_minutes?: number;
  paused?: boolean;
}

export interface ReferencePackage {
  primary_poster_key?: string;
  additional_visual_keys: string[];
  video_reference_keys: string[];
  metadata?: Record<string, unknown>;
}

export const MIN_CADENCE_MINUTES = 60;
export const MAX_CADENCE_MINUTES = 24 * 60;
export const MONITORING_DISCLAIMER =
  "Monitoring configured public discovery sources and known-risk domains.";

const PRE_RELEASE_LEAK_TERMS = [
  "leaked",
  "censor copy",
  "censor print",
  "CBFC copy",
  "review copy",
  "preview copy",
  "screener",
  "workprint",
  "rough cut",
  "unfinished cut",
  "pre-release copy",
  "leaked scene",
  "leaked climax",
  "leaked song",
  "leaked trailer",
  "leaked footage",
  "cam recording",
  "theatre print",
  "theater print",
  "full movie",
  "download",
  "watch online",
  "torrent",
  "magnet",
  "telegram",
  "drive link",
  "streaming player",
  "mirror upload",
  "HDTS",
  "CAM",
] as const;

const YOUTUBE_POST_RELEASE_TERMS = [
  "full movie",
  "theatre print",
  "theater print",
  "censor copy",
  "leaked",
  "climax",
  "scene",
  "CAM",
  "HDTS",
  "download",
  "watch online",
] as const;

const OFFICIAL_EXCLUSION_PATTERNS = [
  /\bofficial trailer\b/i,
  /\bteaser\b/i,
  /\breview\b/i,
  /\breaction\b/i,
  /\binterview\b/i,
  /\bnews\b/i,
  /\bcinema\b/i,
  /\bshowtime\b/i,
  /\bpromo(tional)?\b/i,
];

const CENSOR_WORKPRINT_PATTERNS = [
  /\bcensor\b/i,
  /\bworkprint\b/i,
  /\bscreener\b/i,
  /\bpreview copy\b/i,
  /\bCBFC\b/i,
];

const THEATRE_PRINT_PATTERNS = [
  /\btheatre print\b/i,
  /\btheater print\b/i,
  /\bcam\b/i,
  /\bhdts\b/i,
  /\btsrip\b/i,
];

const NEWS_REPORT_PATTERNS = [
  /\breport(s|ed|ing)?\b/i,
  /\balleged\b/i,
  /\brumou?r\b/i,
  /\barticle\b/i,
];

export function daysUntilRelease(releaseDateIso: string, nowMs = Date.now()): number {
  const release = Date.parse(releaseDateIso);
  if (!Number.isFinite(release)) return 0;
  return Math.ceil((release - nowMs) / 86_400_000);
}

export function daysSinceRelease(releaseDateIso: string, nowMs = Date.now()): number {
  const release = Date.parse(releaseDateIso);
  if (!Number.isFinite(release)) return 0;
  return Math.max(0, Math.ceil((nowMs - release) / 86_400_000));
}

/** Default cadence in minutes based on distance to/from release date. */
export function monitoringCadenceMinutes(
  releaseDateIso: string,
  nowMs = Date.now(),
  customMinutes?: number,
): number {
  if (customMinutes != null && Number.isFinite(customMinutes)) {
    return clampCadence(customMinutes);
  }
  const until = daysUntilRelease(releaseDateIso, nowMs);
  const since = daysSinceRelease(releaseDateIso, nowMs);

  if (until > 30) return 24 * 60;
  if (until >= 8) return 12 * 60;
  if (until >= 1) return 3 * 60;
  if (since <= 3) return 60;
  if (since <= 14) return 3 * 60;
  if (since <= 30) return 12 * 60;
  return 24 * 60;
}

export function clampCadence(minutes: number): number {
  return Math.min(MAX_CADENCE_MINUTES, Math.max(MIN_CADENCE_MINUTES, Math.round(minutes)));
}

export function validateReleaseProtectionSettings(
  settings: Partial<ReleaseProtectionSettings>,
): string[] {
  const errors: string[] = [];
  if (!settings.enabled) return errors;
  if (!settings.release_date?.trim())
    errors.push("Release date is required when automatic monitoring is enabled.");
  if (!settings.release_timezone?.trim())
    errors.push("Release timezone is required when automatic monitoring is enabled.");
  if (!settings.release_type)
    errors.push("Release type is required when automatic monitoring is enabled.");
  if (!settings.release_countries?.length) errors.push("At least one release country is required.");
  if (!settings.primary_language?.trim()) errors.push("Primary language is required.");
  if (!settings.languages?.length) errors.push("At least one language is required.");
  if (!settings.studio?.trim()) errors.push("Official studio/producer is required.");
  if (!settings.distributor?.trim()) errors.push("Authorized distributor is required.");
  if (
    (settings.release_type === "streaming" || settings.ott_platform) &&
    !settings.ott_platform?.trim()
  ) {
    errors.push("Official OTT platform is required for streaming releases.");
  }
  if (settings.cadence_profile === "custom" && settings.custom_cadence_minutes != null) {
    const clamped = clampCadence(settings.custom_cadence_minutes);
    if (clamped !== settings.custom_cadence_minutes) {
      errors.push(
        `Custom cadence must be between ${MIN_CADENCE_MINUTES} and ${MAX_CADENCE_MINUTES} minutes.`,
      );
    }
  }
  return errors;
}

export function calculateProtectionReadiness(input: {
  settings: Partial<ReleaseProtectionSettings>;
  referencePackage: ReferencePackage;
  metadataComplete?: boolean;
}): {
  score: number;
  level: ReadinessLevel;
  checklist: Array<{ label: string; status: "complete" | "incomplete" | "partial" }>;
} {
  const checklist: Array<{ label: string; status: "complete" | "incomplete" | "partial" }> = [];
  let points = 0;
  const maxPoints = 100;

  const titleComplete = Boolean(input.settings.release_date && input.settings.primary_language);
  checklist.push({ label: "Title metadata", status: titleComplete ? "complete" : "incomplete" });
  if (titleComplete) points += 15;

  const releaseComplete = Boolean(input.settings.release_date && input.settings.release_timezone);
  checklist.push({ label: "Release date", status: releaseComplete ? "complete" : "incomplete" });
  if (releaseComplete) points += 15;

  const posterCount =
    (input.referencePackage.primary_poster_key ? 1 : 0) +
    input.referencePackage.additional_visual_keys.length;
  checklist.push({
    label: "Poster coverage",
    status: posterCount >= 3 ? "complete" : posterCount >= 1 ? "partial" : "incomplete",
  });
  if (posterCount >= 3) points += 25;
  else if (posterCount >= 1) points += 10;

  const videoCount = input.referencePackage.video_reference_keys.length;
  checklist.push({
    label: "Video coverage",
    status: videoCount >= 1 ? "complete" : "incomplete",
  });
  if (videoCount >= 1) points += 20;

  const castComplete = input.metadataComplete ?? false;
  checklist.push({
    label: "Cast context",
    status: castComplete ? "complete" : "partial",
  });
  if (castComplete) points += 10;

  const diversity =
    posterCount >= 3 && videoCount >= 1 ? "medium" : posterCount >= 1 ? "low" : "none";
  checklist.push({
    label: "Visual diversity",
    status: diversity === "medium" ? "complete" : diversity === "low" ? "partial" : "incomplete",
  });
  if (diversity === "medium") points += 15;
  else if (diversity === "low") points += 5;

  const score = Math.min(maxPoints, points);
  let level: ReadinessLevel = "not_ready";
  if (score >= 85 && posterCount >= 3 && videoCount >= 1 && releaseComplete) {
    level = "high_confidence";
  } else if (score >= 70 && posterCount >= 3 && videoCount >= 1) {
    level = "strong";
  } else if (score >= 40) {
    level = "basic";
  }

  return { score, level, checklist };
}

export function meetsAutomaticMonitoringReferenceMinimum(pkg: ReferencePackage): boolean {
  const visuals =
    (pkg.primary_poster_key ? 1 : 0) + pkg.additional_visual_keys.filter(Boolean).length;
  return visuals >= 3 && pkg.video_reference_keys.filter(Boolean).length >= 1;
}

export function buildPreReleaseLeakQueries(title: string, altTitles: string[] = []): string[] {
  const bases = [title, ...altTitles].filter(Boolean);
  const out = new Set<string>();
  for (const base of bases) {
    for (const term of PRE_RELEASE_LEAK_TERMS) {
      out.add(`"${base}" ${term}`);
    }
  }
  return [...out];
}

/** Release-aware discovery queries for scheduled protection scans. */
export function buildReleaseProtectionDiscoveryQueries(
  title: string,
  releaseDateIso: string,
  altTitles: string[] = [],
  originalLanguageTitle?: string,
  nowMs = Date.now(),
  limit = 24,
): string[] {
  const queries =
    daysUntilRelease(releaseDateIso, nowMs) > 0
      ? buildPreReleaseLeakQueries(title, altTitles)
      : buildPostReleaseMonitorQueries(title, altTitles, originalLanguageTitle);
  return queries.slice(0, limit);
}

export function buildPostReleaseMonitorQueries(
  title: string,
  altTitles: string[] = [],
  originalLanguageTitle?: string,
): string[] {
  const bases = [title, originalLanguageTitle, ...altTitles].filter(Boolean);
  const out = new Set<string>();
  for (const base of bases) {
    out.add(`"${base}"`);
    for (const term of YOUTUBE_POST_RELEASE_TERMS) {
      out.add(`"${base}" ${term}`);
    }
  }
  return [...out];
}

export function classifyYoutubeLeakCandidate(input: {
  title: string;
  description?: string;
  durationSeconds?: number | null;
  publishedAt?: string | null;
  releaseDate?: string | null;
  channelTitle?: string | null;
}): { classification: YoutubeLeakClassification; risk: LeakRiskLevel } {
  const text = `${input.title} ${input.description ?? ""}`;
  const duration = input.durationSeconds ?? 0;
  const beforeRelease =
    input.releaseDate && input.publishedAt
      ? Date.parse(input.publishedAt) < Date.parse(input.releaseDate)
      : false;

  if (OFFICIAL_EXCLUSION_PATTERNS.some((p) => p.test(text))) {
    if (/\btrailer\b/i.test(text))
      return { classification: "official_trailer", risk: "contextual" };
    if (/\bteaser\b/i.test(text)) return { classification: "teaser", risk: "contextual" };
    if (/\breview\b/i.test(text)) return { classification: "review", risk: "contextual" };
    if (/\breaction\b/i.test(text)) return { classification: "reaction", risk: "contextual" };
    if (/\bnews\b/i.test(text)) return { classification: "news", risk: "contextual" };
    if (/\binterview\b/i.test(text)) return { classification: "interview", risk: "contextual" };
  }

  if (NEWS_REPORT_PATTERNS.some((p) => p.test(text)) && duration < 600) {
    return { classification: "news", risk: "contextual" };
  }

  const censor = CENSOR_WORKPRINT_PATTERNS.some((p) => p.test(text));
  const theatre = THEATRE_PRINT_PATTERNS.some((p) => p.test(text));
  const fullFilmClaim = /\bfull movie\b/i.test(text) || duration >= 3600;

  if (beforeRelease && (censor || fullFilmClaim || theatre)) {
    return {
      classification: censor ? "suspected_leaked_footage" : "suspected_full_film",
      risk: "critical",
    };
  }

  if (censor) {
    return {
      classification: "suspected_leaked_footage",
      risk: beforeRelease ? "critical" : "high",
    };
  }

  if (theatre) {
    return { classification: "suspected_full_film", risk: beforeRelease ? "critical" : "high" };
  }

  if (duration >= 2400) {
    return { classification: "suspected_full_film", risk: beforeRelease ? "critical" : "high" };
  }

  if (/\bleaked\b/i.test(text) && duration >= 120) {
    return { classification: "suspected_leaked_footage", risk: beforeRelease ? "high" : "medium" };
  }

  if (duration >= 600) {
    return { classification: "suspected_long_form", risk: "medium" };
  }

  return { classification: "unrelated", risk: "low" };
}

export function classifyWebLeakCandidate(input: {
  pageTitle?: string;
  pageText?: string;
  hasDownloadLink?: boolean;
  hasTorrentMagnet?: boolean;
  hasEmbeddedPlayer?: boolean;
  releaseDate?: string | null;
  isNewsArticle?: boolean;
  isOfficialDomain?: boolean;
}): { risk: LeakRiskLevel; labels: string[] } {
  const text = `${input.pageTitle ?? ""} ${input.pageText ?? ""}`;
  const labels: string[] = [];
  const beforeRelease = input.releaseDate != null ? daysUntilRelease(input.releaseDate) > 0 : false;

  if (input.isOfficialDomain) {
    return { risk: "contextual", labels: ["official_domain"] };
  }
  if (input.isNewsArticle || NEWS_REPORT_PATTERNS.some((p) => p.test(text))) {
    return { risk: "contextual", labels: ["news_report"] };
  }

  if (CENSOR_WORKPRINT_PATTERNS.some((p) => p.test(text))) labels.push("censor_copy");
  if (THEATRE_PRINT_PATTERNS.some((p) => p.test(text))) labels.push("theatre_print");
  if (input.hasTorrentMagnet) labels.push("torrent_magnet");
  if (input.hasDownloadLink) labels.push("download_link");
  if (input.hasEmbeddedPlayer) labels.push("embedded_player");
  if (/\bfull movie\b/i.test(text)) labels.push("full_film_claim");

  if (beforeRelease && (labels.includes("censor_copy") || labels.includes("full_film_claim"))) {
    return { risk: "critical", labels };
  }
  if (labels.includes("torrent_magnet") && beforeRelease) {
    return { risk: "critical", labels };
  }
  if (labels.includes("theatre_print") || labels.includes("torrent_magnet")) {
    return { risk: "high", labels };
  }
  if (labels.length) return { risk: "medium", labels };
  return { risk: "low", labels };
}

export function shouldAlertForIncident(risk: LeakRiskLevel, threshold: AlertThreshold): boolean {
  switch (threshold) {
    case "critical_only":
      return risk === "critical";
    case "high_and_critical":
      return risk === "critical" || risk === "high";
    case "all_verified":
      return risk === "critical" || risk === "high" || risk === "medium";
    case "daily_summary":
      return false;
    default:
      return false;
  }
}

export function shouldImmediateAlert(input: {
  risk: LeakRiskLevel;
  beforeRelease: boolean;
  labels: string[];
  classification?: YoutubeLeakClassification;
}): boolean {
  if (input.risk === "critical") return true;
  if (input.beforeRelease && input.labels.includes("full_film_claim")) return true;
  if (input.labels.includes("censor_copy") || input.labels.includes("theatre_print")) return true;
  if (input.labels.includes("torrent_magnet")) return true;
  if (input.classification === "suspected_full_film") return true;
  return false;
}

export function computeNextScanAt(
  releaseDateIso: string,
  fromMs = Date.now(),
  customMinutes?: number,
): string {
  const minutes = monitoringCadenceMinutes(releaseDateIso, fromMs, customMinutes);
  return new Date(fromMs + minutes * 60_000).toISOString();
}

export function computeMonitoringWindow(releaseDateIso: string): {
  monitoring_start_at: string;
  monitoring_end_at: string;
} {
  const release = Date.parse(releaseDateIso);
  const start = new Date(release - 30 * 86_400_000);
  const end = new Date(release + 30 * 86_400_000);
  return {
    monitoring_start_at: start.toISOString(),
    monitoring_end_at: end.toISOString(),
  };
}

export function incidentDedupKey(sourceUrl: string, incidentType: string): string {
  return `${incidentType}::${sourceUrl}`;
}

export function mergeIncidentRecurrence<
  T extends { recurrence_count: number; last_seen_at: string },
>(existing: T, seenAt: string): T {
  return {
    ...existing,
    recurrence_count: existing.recurrence_count + 1,
    last_seen_at: seenAt,
  };
}

export function isPrivateOrUnsafeMonitorUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      (host.includes("drive.google.com") && parsed.pathname.includes("/folders/"))
    ) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function providerFailureIsolation(results: Array<{ ok: boolean }>): {
  attempted: number;
  succeeded: number;
  failed: number;
  shouldFailRun: boolean;
} {
  const attempted = results.length;
  const succeeded = results.filter((r) => r.ok).length;
  const failed = attempted - succeeded;
  return {
    attempted,
    succeeded,
    failed,
    shouldFailRun: attempted > 0 && succeeded === 0,
  };
}

export function formatCadenceLabel(minutes: number): string {
  if (minutes < 60) return `every ${minutes} minutes`;
  if (minutes === 60) return "every hour";
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? "once daily" : `every ${days} days`;
  }
  if (minutes % 60 === 0) return `every ${minutes / 60} hours`;
  return `every ${minutes} minutes`;
}
