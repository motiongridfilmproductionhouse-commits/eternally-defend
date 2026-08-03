/**
 * Deepfake Intelligence investigation diagnostics and no-results explanations.
 */

import type { ReferenceImageProviderStats } from "./reference-images";
import { providerLabel } from "./reference-images";

export type InvestigationStage =
  | "collecting_reference_images"
  | "generating_face_embeddings"
  | "searching_google"
  | "searching_bing"
  | "searching_yandex"
  | "searching_public_websites"
  | "scanning_candidate_pages"
  | "extracting_images"
  | "comparing_faces"
  | "evaluating_evidence"
  | "generating_report"
  | "discovering"
  | "verifying"
  | "classifying"
  | "done";

export interface InvestigationDiagnostics {
  reference_images: number;
  embeddings: number;
  aliases_generated: number;
  queries_generated: number;
  providers_used: number;
  pages_crawled: number;
  images_downloaded: number;
  images_compared: number;
  potential_matches: number;
  verified_matches: number;
  rejected_matches: number;
  domains_investigated: number;
  coverage_score_percent: number | null;
  confidence_label: "low" | "medium" | "high" | null;
  investigation_stage: InvestigationStage | string;
  no_results_reason: string | null;
  provider_stats: ReferenceImageProviderStats[];
}

export function diagnosticsFromMetrics(
  metrics: Record<string, unknown> | null | undefined,
): InvestigationDiagnostics {
  const n = (key: string) => {
    const v = metrics?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };

  const referenceImages = n("reference_images_count") || n("final_reference_images");
  const embeddings = n("embeddings_indexed") || referenceImages;
  const queries = n("queries_generated");
  const crawled = n("crawl_succeeded") + n("crawl_failed");
  const verified = n("verified") || n("client_visible");
  const probable = n("probable");
  const rejected =
    n("identity_rejected") +
    n("page_type_rejected") +
    n("url_rejected") +
    n("serpapi_face_rejected");

  const providersUsed = [
    n("serpapi_requests") > 0,
    n("reference_google_images_found") > 0,
    n("reference_bing_images_found") > 0,
    n("reference_yandex_images_found") > 0,
  ].filter(Boolean).length;

  const coverage =
    queries > 0
      ? Math.min(100, Math.round((n("unique_candidates") / Math.max(queries, 1)) * 100))
      : null;

  let confidence: InvestigationDiagnostics["confidence_label"] = null;
  if (verified >= 5) confidence = "high";
  else if (verified >= 1 || probable >= 3) confidence = "medium";
  else if (referenceImages >= 100) confidence = "medium";
  else if (referenceImages > 0) confidence = "low";

  const stageRaw = metrics?.investigation_stage ?? metrics?.stage;
  const stage =
    typeof stageRaw === "string" ? stageRaw : ("discovering" as InvestigationStage);

  return {
    reference_images: referenceImages,
    embeddings,
    aliases_generated: n("aliases_generated"),
    queries_generated: queries,
    providers_used: providersUsed,
    pages_crawled: crawled,
    images_downloaded: n("images_downloaded") || n("reference_images_downloaded"),
    images_compared: n("images_compared") || n("face_comparisons"),
    potential_matches: probable + verified,
    verified_matches: verified,
    rejected_matches: rejected,
    domains_investigated: n("unique_candidates"),
    coverage_score_percent: coverage,
    confidence_label: confidence,
    investigation_stage: stage,
    no_results_reason:
      typeof metrics?.no_results_reason === "string" ? metrics.no_results_reason : null,
    provider_stats: Array.isArray(metrics?.reference_image_provider_stats)
      ? (metrics.reference_image_provider_stats as ReferenceImageProviderStats[])
      : [],
  };
}

export function explainNoDeepfakeResults(
  metrics: Record<string, unknown> | null | undefined,
  status?: string | null,
): { headline: string; reasons: string[] } {
  if (status === "running") {
    return {
      headline: "Investigation in progress",
      reasons: ["Results appear as verified batches are saved."],
    };
  }

  const d = diagnosticsFromMetrics(metrics);
  const reasons: string[] = [];

  if (d.reference_images === 0) {
    reasons.push("No reference images were collected — image providers may be unavailable or returned no usable faces.");
  } else if (d.reference_images < 30) {
    reasons.push(
      `Only ${d.reference_images} reference images collected (target 300+ when publicly available).`,
    );
  }

  if (d.aliases_generated < 3) {
    reasons.push("Limited identity aliases were generated for this target.");
  }

  if (d.queries_generated === 0) {
    reasons.push("No discovery queries were generated.");
  } else if (typeof metrics?.queries_executed === "number" && metrics.queries_executed === 0) {
    reasons.push("Discovery queries were generated but none executed before the scan ended.");
  }

  if (d.pages_crawled === 0 && d.queries_generated > 0) {
    reasons.push("No candidate pages were crawled — providers may have timed out or been blocked.");
  }

  if (d.images_compared === 0 && d.reference_images > 0) {
    reasons.push("Reference images exist but no candidate images were compared via face embeddings.");
  }

  if (d.potential_matches === 0 && d.pages_crawled > 0) {
    reasons.push("No similarity scores exceeded the verification threshold.");
  }

  if (d.rejected_matches > 0 && d.verified_matches === 0) {
    reasons.push(
      `${d.rejected_matches} candidates were rejected by identity, page-type, or face-mismatch gates.`,
    );
  }

  if (typeof metrics?.provider_failures === "number" && metrics.provider_failures > 0) {
    reasons.push(`${metrics.provider_failures} provider request(s) failed — other providers continued independently.`);
  }

  if (status === "failed" && typeof metrics?.failure_reason === "string") {
    reasons.push(String(metrics.failure_reason));
  }

  if (!reasons.length) {
    reasons.push("No client-visible threats matched the selected risk filters.");
  }

  return {
    headline: d.verified_matches > 0 ? "Investigation complete" : "No verified threats found",
    reasons,
  };
}

export function formatProviderStatsLines(stats: ReferenceImageProviderStats[]): string[] {
  return stats
    .filter((s) => s.configured || s.images_found > 0 || s.images_accepted > 0)
    .map((s) => {
      const label = providerLabel(s.provider);
      return `${label}: Found ${s.images_found}, Downloaded ${s.images_downloaded}, Accepted ${s.images_accepted}, Duplicates removed ${s.duplicates_removed}, Embeddings ${s.images_used_for_embeddings}`;
    });
}

export const INVESTIGATION_TIMELINE_STAGES: Array<{ key: InvestigationStage; label: string }> = [
  { key: "collecting_reference_images", label: "Collecting Reference Images…" },
  { key: "generating_face_embeddings", label: "Generating Face Embeddings…" },
  { key: "searching_google", label: "Searching Google…" },
  { key: "searching_bing", label: "Searching Bing…" },
  { key: "searching_yandex", label: "Searching Yandex…" },
  { key: "searching_public_websites", label: "Searching Public Websites…" },
  { key: "discovering", label: "Scanning Candidate Pages…" },
  { key: "extracting_images", label: "Extracting Images…" },
  { key: "comparing_faces", label: "Comparing Faces…" },
  { key: "verifying", label: "Evaluating Evidence…" },
  { key: "classifying", label: "Evaluating Evidence…" },
  { key: "generating_report", label: "Generating Report…" },
  { key: "done", label: "Investigation complete" },
];
