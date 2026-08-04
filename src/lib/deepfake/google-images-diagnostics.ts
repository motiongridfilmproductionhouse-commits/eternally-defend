/**
 * Google Images investigation diagnostics for Deepfake Intelligence.
 */

export type GoogleImagesProviderStatus =
  | "success"
  | "degraded"
  | "unavailable"
  | "not_started";

export interface GoogleImagesInvestigationDiagnostics {
  queries_executed: number;
  queries_planned: number;
  pages_loaded: number;
  images_discovered: number;
  images_downloaded: number;
  duplicate_images: number;
  valid_faces: number;
  high_confidence_matches: number;
  candidate_pages_crawled: number;
  source_pages_discovered: number;
  evidence_packages_created: number;
  failed_downloads: number;
  face_comparisons: number;
  rejected_identities: number;
  provider_status: GoogleImagesProviderStatus;
  failure_reason: string | null;
  used_browser: boolean;
  browser_available: boolean;
}

export function emptyGoogleImagesDiagnostics(): GoogleImagesInvestigationDiagnostics {
  return {
    queries_executed: 0,
    queries_planned: 0,
    pages_loaded: 0,
    images_discovered: 0,
    images_downloaded: 0,
    duplicate_images: 0,
    valid_faces: 0,
    high_confidence_matches: 0,
    candidate_pages_crawled: 0,
    source_pages_discovered: 0,
    evidence_packages_created: 0,
    failed_downloads: 0,
    face_comparisons: 0,
    rejected_identities: 0,
    provider_status: "not_started",
    failure_reason: null,
    used_browser: false,
    browser_available: false,
  };
}

export function parseGoogleImagesDiagnostics(
  metrics: Record<string, unknown> | null | undefined,
): GoogleImagesInvestigationDiagnostics {
  const raw = metrics?.google_images_diagnostic;
  if (!raw || typeof raw !== "object") return emptyGoogleImagesDiagnostics();
  const d = raw as Record<string, unknown>;
  const n = (key: string) => {
    const v = d[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const status = d.provider_status;
  const providerStatus: GoogleImagesInvestigationDiagnostics["provider_status"] =
    status === "success" ||
    status === "degraded" ||
    status === "unavailable" ||
    status === "not_started"
      ? status
      : "not_started";

  const diagnostics: GoogleImagesInvestigationDiagnostics = {
    queries_executed: n("queries_executed"),
    queries_planned:
      n("queries_planned") ||
      (typeof metrics?.google_images_jobs_total === "number"
        ? metrics.google_images_jobs_total
        : 0),
    pages_loaded: n("pages_loaded"),
    images_discovered: n("images_discovered"),
    images_downloaded: n("images_downloaded"),
    duplicate_images: n("duplicate_images"),
    valid_faces: n("valid_faces"),
    high_confidence_matches: n("high_confidence_matches"),
    candidate_pages_crawled: n("candidate_pages_crawled"),
    source_pages_discovered: n("source_pages_discovered"),
    evidence_packages_created: n("evidence_packages_created"),
    failed_downloads: n("failed_downloads"),
    face_comparisons: n("face_comparisons"),
    rejected_identities: n("rejected_identities"),
    provider_status: providerStatus,
    failure_reason:
      typeof d.failure_reason === "string" ? d.failure_reason : null,
    used_browser: d.used_browser === true,
    browser_available: d.browser_available === true,
  };

  return diagnostics;
}

export function googleImagesBackgroundStatus(
  metrics: Record<string, unknown> | null | undefined,
): "queued" | "running" | "completed" | "failed" | null {
  const raw = metrics?.google_images_background_status;
  if (
    raw === "queued" ||
    raw === "running" ||
    raw === "completed" ||
    raw === "failed"
  ) {
    return raw;
  }
  return null;
}

export function googleImagesBackgroundProgress(metrics: Record<string, unknown> | null | undefined): {
  completed: number;
  total: number;
  percent: number;
  running: boolean;
} {
  const total =
    typeof metrics?.google_images_jobs_total === "number"
      ? metrics.google_images_jobs_total
      : 0;
  const completed =
    typeof metrics?.google_images_jobs_completed === "number"
      ? metrics.google_images_jobs_completed
      : 0;
  const percent =
    typeof metrics?.google_images_progress_percent === "number"
      ? metrics.google_images_progress_percent
      : total > 0
        ? Math.round((completed / total) * 100)
        : 0;
  const status = googleImagesBackgroundStatus(metrics);
  return {
    completed,
    total,
    percent,
    running: status === "queued" || status === "running",
  };
}

export function formatGoogleImagesDiagnosticLines(
  d: GoogleImagesInvestigationDiagnostics,
): string[] {
  return [
    `Queries Executed: ${d.queries_executed}`,
    `Images Discovered: ${d.images_discovered}`,
    `Source Pages Discovered: ${d.source_pages_discovered}`,
    `Pages Crawled: ${d.candidate_pages_crawled}`,
    `Images Downloaded: ${d.images_downloaded}`,
    `Faces Compared: ${d.face_comparisons}`,
    `Candidate Matches: ${d.high_confidence_matches}`,
    `Evidence Generated: ${d.evidence_packages_created}`,
    `Duplicate Images: ${d.duplicate_images}`,
    `Valid Faces: ${d.valid_faces}`,
    `Failed Downloads: ${d.failed_downloads}`,
    `Provider Status: ${d.provider_status}`,
    ...(d.used_browser ? ["Collection Mode: Browser"] : []),
    ...(d.failure_reason ? [`Failure: ${d.failure_reason}`] : []),
  ];
}
