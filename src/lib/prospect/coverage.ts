/**
 * Pre-Enrollment Intelligence — coverage model.
 *
 * Incomplete coverage must never read as low risk. Coverage is computed from
 * the stored prospect_scan_sources rows, never from intent, and qualifies every
 * headline the UI prints.
 */

import { SOURCE_FAMILY_SET_VERSION, intendedFamilies, type SourceFamilyKey } from "./source-registry";

export type CoverageState = "COMPLETE" | "PARTIAL" | "LIMITED" | "INSUFFICIENT";

export type SourceState =
  | "not_scanned"
  | "connecting"
  | "scanning"
  | "results_found"
  | "no_results"
  | "unavailable"
  | "provider_error"
  | "policy_disabled";

export interface SourceRow {
  family_key: string;
  state: SourceState;
  weight_class?: string | null;
  direct_access?: boolean | null;
}

export interface CoverageReport {
  setVersion: string;
  intended: number;
  queriedOk: number;
  failed: number;
  unavailable: number;
  policyDisabled: number;
  majorUnavailable: SourceFamilyKey[];
  state: CoverageState;
  /** e.g. "7 of 12 intended source families successfully queried (set v1)" */
  label: string;
  /** True when the UI must print "Risk assessment based on available sources". */
  qualified: boolean;
}

const SUCCESS_STATES: SourceState[] = ["results_found", "no_results"];

export function computeCoverage(rows: SourceRow[]): CoverageReport {
  const intendedKeys = new Set(intendedFamilies().map((f) => f.key as string));
  const relevant = rows.filter((r) => intendedKeys.has(r.family_key));
  const intended = intendedKeys.size;

  const queriedOk = relevant.filter((r) => SUCCESS_STATES.includes(r.state)).length;
  const failed = relevant.filter((r) => r.state === "provider_error").length;
  const unavailable = relevant.filter((r) => r.state === "unavailable" || r.state === "not_scanned").length;
  const policyDisabled = rows.filter((r) => r.state === "policy_disabled").length;

  const majorUnavailable = relevant
    .filter(
      (r) =>
        (r.weight_class ?? "supporting") === "major" &&
        (r.state === "unavailable" || r.state === "provider_error" || r.state === "not_scanned"),
    )
    .map((r) => r.family_key as SourceFamilyKey);

  const ratio = intended > 0 ? queriedOk / intended : 0;
  const coreFamilies = ["google_search", "web_general"];
  const coreOk = relevant.some((r) => coreFamilies.includes(r.family_key) && SUCCESS_STATES.includes(r.state));

  let state: CoverageState;
  if (!coreOk || ratio < 0.3) {
    state = "INSUFFICIENT";
  } else if (ratio < 0.6) {
    state = "LIMITED";
  } else if (majorUnavailable.length > 0) {
    // Any unavailable major family caps the result at PARTIAL, whatever the ratio.
    state = "PARTIAL";
  } else {
    state = "COMPLETE";
  }

  return {
    setVersion: SOURCE_FAMILY_SET_VERSION,
    intended,
    queriedOk,
    failed,
    unavailable,
    policyDisabled,
    majorUnavailable,
    state,
    label: `${queriedOk} of ${intended} intended source families successfully queried (set ${SOURCE_FAMILY_SET_VERSION})`,
    qualified: state !== "COMPLETE",
  };
}

export function coverageWord(state: CoverageState): string {
  switch (state) {
    case "COMPLETE":
      return "Complete";
    case "PARTIAL":
      return "Partial";
    case "LIMITED":
      return "Limited";
    case "INSUFFICIENT":
      return "Insufficient";
  }
}

/** Headline used when a scan stored zero relevant findings. */
export function zeroFindingsLabel(state: CoverageState): string {
  return `No relevant findings in scanned sources · Coverage: ${coverageWord(state)}`;
}
