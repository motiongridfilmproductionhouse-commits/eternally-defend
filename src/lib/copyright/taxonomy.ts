/**
 * Copyright Intelligence illegal-distribution classification taxonomy.
 *
 * Identity signals (poster, OCR, faces, title text) prove relevance only.
 * Client-visible piracy findings require identity + exact-page access evidence.
 */

export const COPYRIGHT_CLASSIFICATIONS = [
  "VERIFIED_UNAUTHORIZED_STREAM",
  "PROBABLE_UNAUTHORIZED_STREAM",
  "DOWNLOAD_PAGE",
  "FILE_HOST_DISTRIBUTION",
  "TORRENT_OR_MAGNET",
  "VIDEO_HOST_REUPLOAD",
  "THEATRE_PRINT_DISTRIBUTION",
  "MIRROR_OR_REDIRECT",
  "DUPLICATE_ARTWORK_ONLY",
  "OFFICIAL_OR_AUTHORIZED",
  "OFFICIAL_OR_AUTHORIZED_PAGE",
  "TRAILER_OR_PROMO",
  "TRAILER_OR_PROMOTIONAL",
  "CINEMA_OR_SHOWTIME",
  "REVIEW_OR_NEWS",
  "CAST_OR_INFORMATION",
  "SOCIAL_DISCUSSION",
  "CATALOG_OR_LISTING",
  "INVESTIGATION_LEAD",
  "UNVERIFIED_LEAD",
  "UNRELATED",
] as const;

export type CopyrightClassification = (typeof COPYRIGHT_CLASSIFICATIONS)[number];

/** First eight classifications may appear as actionable piracy findings. */
export const ACTIONABLE_PIRACY_CLASSIFICATIONS: ReadonlySet<CopyrightClassification> =
  new Set([
    "VERIFIED_UNAUTHORIZED_STREAM",
    "PROBABLE_UNAUTHORIZED_STREAM",
    "DOWNLOAD_PAGE",
    "FILE_HOST_DISTRIBUTION",
    "TORRENT_OR_MAGNET",
    "VIDEO_HOST_REUPLOAD",
    "THEATRE_PRINT_DISTRIBUTION",
    "MIRROR_OR_REDIRECT",
  ]);

export const TYPE_LABEL: Record<CopyrightClassification, string> = {
  VERIFIED_UNAUTHORIZED_STREAM: "Verified unauthorized stream",
  PROBABLE_UNAUTHORIZED_STREAM: "Probable unauthorized stream",
  DOWNLOAD_PAGE: "Download page",
  FILE_HOST_DISTRIBUTION: "File-host distribution",
  TORRENT_OR_MAGNET: "Torrent or magnet",
  VIDEO_HOST_REUPLOAD: "Video-host reupload",
  THEATRE_PRINT_DISTRIBUTION: "Theatre-print distribution",
  MIRROR_OR_REDIRECT: "Mirror or redirect",
  DUPLICATE_ARTWORK_ONLY: "Duplicate artwork only",
  OFFICIAL_OR_AUTHORIZED: "Official or authorized",
  OFFICIAL_OR_AUTHORIZED_PAGE: "Official or authorized page",
  TRAILER_OR_PROMO: "Trailer or promo",
  TRAILER_OR_PROMOTIONAL: "Trailer or promotional",
  CINEMA_OR_SHOWTIME: "Cinema or showtime",
  REVIEW_OR_NEWS: "Review or news",
  CAST_OR_INFORMATION: "Cast or information",
  SOCIAL_DISCUSSION: "Social discussion",
  CATALOG_OR_LISTING: "Catalog or listing",
  INVESTIGATION_LEAD: "Investigation lead",
  UNVERIFIED_LEAD: "Unverified lead",
  UNRELATED: "Unrelated",
};

/**
 * Legacy detection_type → taxonomy.
 * Ambiguous legacy labels (ripped_copy, video_clip) stay UNVERIFIED unless
 * distribution strong_evidence is present (see resolveClassification).
 */
const LEGACY_TO_TAXONOMY: Record<string, CopyrightClassification> = {
  ripped_copy: "UNVERIFIED_LEAD",
  cam_recording: "THEATRE_PRINT_DISTRIBUTION",
  video_clip: "UNVERIFIED_LEAD",
  trailer_copy: "TRAILER_OR_PROMO",
  poster_copy: "DUPLICATE_ARTWORK_ONLY",
  reuploaded_artwork: "DUPLICATE_ARTWORK_ONLY",
  movie_screenshot: "DUPLICATE_ARTWORK_ONLY",
  edited_derivative: "DUPLICATE_ARTWORK_ONLY",
  unrelated: "UNRELATED",
  cam_theatre_leak: "THEATRE_PRINT_DISTRIBUTION",
  streaming_site: "PROBABLE_UNAUTHORIZED_STREAM",
  torrent: "TORRENT_OR_MAGNET",
  file_sharing: "FILE_HOST_DISTRIBUTION",
  forum_post: "SOCIAL_DISCUSSION",
  artwork_reupload: "DUPLICATE_ARTWORK_ONLY",
  web_lead: "UNVERIFIED_LEAD",
  OFFICIAL_OR_AUTHORIZED_PAGE: "OFFICIAL_OR_AUTHORIZED",
  TRAILER_OR_PROMOTIONAL: "TRAILER_OR_PROMO",
  INVESTIGATION_LEAD: "UNVERIFIED_LEAD",
};

const LEGACY_CONTENT_TYPE_TO_TAXONOMY: Record<string, CopyrightClassification> = {
  unauthorized_streaming_site: "PROBABLE_UNAUTHORIZED_STREAM",
  movie_download_site: "DOWNLOAD_PAGE",
  torrent_index_site: "TORRENT_OR_MAGNET",
  file_distribution_site: "FILE_HOST_DISTRIBUTION",
  reupload_platform: "VIDEO_HOST_REUPLOAD",
  linking_page: "MIRROR_OR_REDIRECT",
};

export function isCopyrightClassification(
  value: string,
): value is CopyrightClassification {
  return (COPYRIGHT_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function normalizeClassification(
  value: string | null | undefined,
): CopyrightClassification {
  if (!value) return "UNVERIFIED_LEAD";
  if (isCopyrightClassification(value)) return value;
  return LEGACY_TO_TAXONOMY[value] ?? "UNVERIFIED_LEAD";
}

/**
 * Resolve classification for persisted matches, including legacy rows that
 * stored ripped_copy/video_clip with distribution.strong_evidence.
 */
export function resolveClassification(opts: {
  detectionType?: string | null;
  distributionClassification?: string | null;
  contentType?: string | null;
  strongEvidence?: boolean | null;
}): CopyrightClassification {
  if (
    opts.distributionClassification &&
    isCopyrightClassification(opts.distributionClassification)
  ) {
    return opts.distributionClassification;
  }

  const raw = opts.detectionType ?? "";
  if (isCopyrightClassification(raw)) return raw;

  // Legacy actionable distribution rows: keep visible when strong evidence exists.
  if (
    opts.strongEvidence === true &&
    (raw === "ripped_copy" || raw === "video_clip" || raw === "cam_recording")
  ) {
    if (opts.contentType && LEGACY_CONTENT_TYPE_TO_TAXONOMY[opts.contentType]) {
      return LEGACY_CONTENT_TYPE_TO_TAXONOMY[opts.contentType]!;
    }
    if (raw === "cam_recording") return "THEATRE_PRINT_DISTRIBUTION";
    if (raw === "video_clip") return "PROBABLE_UNAUTHORIZED_STREAM";
    return "DOWNLOAD_PAGE";
  }

  return normalizeClassification(raw);
}

export function isActionablePiracy(
  classification: string | null | undefined,
): boolean {
  const cls = normalizeClassification(classification);
  // YouTube-style VIDEO_HOST_REUPLOAD is actionable only when client-visible
  // gates also pass; official aliases never are.
  if (
    cls === "OFFICIAL_OR_AUTHORIZED" ||
    cls === "OFFICIAL_OR_AUTHORIZED_PAGE" ||
    cls === "CATALOG_OR_LISTING" ||
    cls === "TRAILER_OR_PROMO" ||
    cls === "TRAILER_OR_PROMOTIONAL" ||
    cls === "INVESTIGATION_LEAD"
  ) {
    return false;
  }
  return ACTIONABLE_PIRACY_CLASSIFICATIONS.has(cls);
}

/** Alias normalization for newer outcome labels. */
export function canonicalClassification(
  value: string | null | undefined,
): CopyrightClassification {
  const raw = value ?? "";
  if (raw === "OFFICIAL_OR_AUTHORIZED_PAGE") return "OFFICIAL_OR_AUTHORIZED";
  if (raw === "TRAILER_OR_PROMOTIONAL") return "TRAILER_OR_PROMO";
  if (raw === "INVESTIGATION_LEAD") return "UNVERIFIED_LEAD";
  return normalizeClassification(raw);
}

export function isClientVisiblePiracyMatch(opts: {
  detectionType: string | null | undefined;
  clientVisible?: boolean | null;
  strongEvidence?: boolean | null;
  distributionClassification?: string | null;
  contentType?: string | null;
}): boolean {
  if (opts.clientVisible === false) return false;

  const cls = resolveClassification({
    detectionType: opts.detectionType,
    distributionClassification: opts.distributionClassification,
    contentType: opts.contentType,
    strongEvidence: opts.strongEvidence,
  });

  if (!ACTIONABLE_PIRACY_CLASSIFICATIONS.has(cls)) return false;

  // Legacy ambiguous labels require explicit strong distribution evidence.
  const raw = opts.detectionType ?? "";
  if (
    (raw === "ripped_copy" || raw === "video_clip" || raw === "cam_recording") &&
    opts.strongEvidence !== true
  ) {
    return false;
  }

  if (opts.strongEvidence === false) return false;
  return true;
}

export type RiskBand = "critical" | "high" | "medium" | "low";

export function riskBandFor(opts: {
  classification: CopyrightClassification;
  strongAccess: boolean;
  theatrePrint: boolean;
  torrentOrFile: boolean;
  mirrorCount: number;
  releaseTiming?: string | null;
}): RiskBand {
  if (!ACTIONABLE_PIRACY_CLASSIFICATIONS.has(opts.classification)) return "low";

  const early =
    opts.releaseTiming === "same_day" ||
    opts.releaseTiming === "next_day" ||
    opts.releaseTiming === "first_week";

  if (
    opts.classification === "VERIFIED_UNAUTHORIZED_STREAM" ||
    (opts.theatrePrint && early) ||
    opts.torrentOrFile ||
    opts.mirrorCount >= 2
  ) {
    return "critical";
  }

  if (opts.strongAccess || opts.classification === "PROBABLE_UNAUTHORIZED_STREAM") {
    return "high";
  }

  return "medium";
}

export function labelForDetectionType(value: string | null | undefined): string {
  const cls = normalizeClassification(value);
  return TYPE_LABEL[cls] ?? value ?? "Unknown";
}
