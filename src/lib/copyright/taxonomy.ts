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
  "TRAILER_OR_PROMO",
  "CINEMA_OR_SHOWTIME",
  "REVIEW_OR_NEWS",
  "CAST_OR_INFORMATION",
  "SOCIAL_DISCUSSION",
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
  TRAILER_OR_PROMO: "Trailer or promo",
  CINEMA_OR_SHOWTIME: "Cinema or showtime",
  REVIEW_OR_NEWS: "Review or news",
  CAST_OR_INFORMATION: "Cast or information",
  SOCIAL_DISCUSSION: "Social discussion",
  UNVERIFIED_LEAD: "Unverified lead",
  UNRELATED: "Unrelated",
};

/** Legacy detection_type values still present in older rows / AI grader output. */
const LEGACY_TO_TAXONOMY: Record<string, CopyrightClassification> = {
  ripped_copy: "UNVERIFIED_LEAD",
  cam_recording: "THEATRE_PRINT_DISTRIBUTION",
  video_clip: "PROBABLE_UNAUTHORIZED_STREAM",
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

export function isActionablePiracy(
  classification: string | null | undefined,
): boolean {
  return ACTIONABLE_PIRACY_CLASSIFICATIONS.has(
    normalizeClassification(classification),
  );
}

export function isClientVisiblePiracyMatch(opts: {
  detectionType: string | null | undefined;
  clientVisible?: boolean | null;
  strongEvidence?: boolean | null;
}): boolean {
  if (opts.clientVisible === false) return false;
  const cls = normalizeClassification(opts.detectionType);
  if (!ACTIONABLE_PIRACY_CLASSIFICATIONS.has(cls)) return false;
  // Prefer an explicit strong-evidence flag when present.
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
