/**
 * Single source of truth for perceptual-similarity confidence bands.
 *
 * The numeric thresholds here are the ONLY place the discovery/verification
 * pipeline defines match bands. They are intentionally unchanged from the
 * validated production behaviour — this module exists so that band names,
 * detection-type labels and UI copy can never drift apart again.
 *
 * A band is evidence of visual similarity. It is never a finding of
 * infringement and never grants enforcement eligibility.
 */

export type SimilarityBand = "exact" | "probable" | "possible" | "unrelated";

/** Inclusive lower bounds, in percent, of each band. Do not relax. */
export const SIMILARITY_BAND_MIN = {
  exact: 92,
  probable: 84,
  possible: 75,
} as const;

export function classifySimilarityBand(similarity: number): SimilarityBand {
  if (similarity >= SIMILARITY_BAND_MIN.exact) return "exact";
  if (similarity >= SIMILARITY_BAND_MIN.probable) return "probable";
  if (similarity >= SIMILARITY_BAND_MIN.possible) return "possible";
  return "unrelated";
}

/** Human-readable percentage range for a band, derived from the thresholds. */
export function similarityBandRange(band: SimilarityBand): string {
  switch (band) {
    case "exact":
      return `${SIMILARITY_BAND_MIN.exact}-100%`;
    case "probable":
      return `${SIMILARITY_BAND_MIN.probable}-${SIMILARITY_BAND_MIN.exact - 1}%`;
    case "possible":
      return `${SIMILARITY_BAND_MIN.possible}-${SIMILARITY_BAND_MIN.probable - 1}%`;
    default:
      return `<${SIMILARITY_BAND_MIN.possible}%`;
  }
}

export function similarityBandLabel(band: SimilarityBand): string {
  switch (band) {
    case "exact":
      return `Exact match (${similarityBandRange("exact")})`;
    case "probable":
      return `Probable match (${similarityBandRange("probable")})`;
    case "possible":
      return `Possible match (${similarityBandRange("possible")})`;
    default:
      return "No match";
  }
}

/**
 * Detection type stored alongside a promoted match. Terminology mirrors the
 * band exactly: probable band -> probable_*, possible band -> possible_*.
 */
export function detectionTypeForBand(band: SimilarityBand): string {
  switch (band) {
    case "exact":
      return "verified_reupload";
    case "probable":
      return "probable_reupload";
    case "possible":
      return "possible_match";
    default:
      return "unverified_candidate";
  }
}

/**
 * Normalises every band vocabulary present in the product (perceptual
 * discovery: exact/probable/possible; legacy AI classifier:
 * confirmed/probable/review) onto the canonical band names so UI labels and
 * filters stay consistent regardless of which pipeline wrote the row.
 */
export function normalizeBandName(value: string | null | undefined): SimilarityBand {
  const band = (value ?? "").trim().toLowerCase();
  if (band === "exact" || band === "confirmed" || band === "verified") return "exact";
  if (band === "probable") return "probable";
  if (band === "possible" || band === "review" || band === "needs_review") return "possible";
  return "unrelated";
}
