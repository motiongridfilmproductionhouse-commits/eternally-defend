/**
 * Pre-Enrollment Intelligence — two separate risk states.
 *
 *  A) Preliminary Exposure Signal (preliminary-exposure-v1)
 *     Computed from MATCHED discoveries including unverified findings.
 *     ALWAYS labelled "Preliminary · Not yet human verified".
 *     Unverified findings are capped so they can never look like verified ones.
 *
 *  B) Verified Risk Assessment (verified-risk-v1)
 *     Computed ONLY from human-VERIFIED findings. No verified finding →
 *     PENDING_VERIFICATION. Unverified findings can never influence it.
 *
 * Both store their model version and their numeric factor breakdown; history is
 * append-only, so a new row is written whenever staff verify or reject.
 * Coverage overrides: never report LOW off thin coverage.
 */

import type { CoverageState } from "./coverage";
import type { IdentityBucket } from "./identity-resolution";

export const PRELIMINARY_MODEL_VERSION = "preliminary-exposure-v1";
export const VERIFIED_MODEL_VERSION = "verified-risk-v1";

export type RiskBand = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type PreliminaryBand = RiskBand | "INSUFFICIENT_DATA";
export type VerifiedBand = RiskBand | "PENDING_VERIFICATION" | "INSUFFICIENT_DATA";

export type FindingState =
  | "DISCOVERED"
  | "CLASSIFIED"
  | "NEEDS_HUMAN_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "ESCALATED";

export interface RiskFindingInput {
  id: string;
  state: FindingState;
  identityBucket: IdentityBucket;
  /** 0–10, set by the stage classifier from stored signals. */
  severity: number;
  /** 0–10 authority of the hosting source. */
  sourceAuthority?: number;
  /** 1-based search rank when the item appeared in search results. */
  searchRank?: number | null;
  platform?: string | null;
  /** Number of additional copies clustered to this item. */
  reuploadCount?: number;
  publishedAt?: string | null;
  /** 0–100 AI-manipulation confidence, only when the analysis actually ran. */
  aiManipulationConfidence?: number | null;
  /** 0–100 identity confidence of the underlying discovery. */
  identityConfidence?: number;
}

export interface RiskFactor {
  key: string;
  label: string;
  contribution: number;
  max: number;
  detail: string;
}

export interface RiskScoreResult {
  kind: "PRELIMINARY" | "VERIFIED";
  modelVersion: string;
  score: number;
  band: PreliminaryBand | VerifiedBand;
  factors: RiskFactor[];
  findingsConsidered: number;
  findingsAwaitingVerification: number;
  coverageState: CoverageState;
  /** Free-text qualifier the UI must print next to the band. */
  qualifier: string;
}

const FACTOR_MAX = {
  severity: 30,
  authority: 10,
  visibility: 10,
  spread: 8,
  propagation: 10,
  recency: 7,
  manipulation: 10,
  identity: 5,
} as const;

/** Unverified findings are deliberately capped to 40% of their weight. */
const UNVERIFIED_WEIGHT = 0.4;

function bandFor(score: number): RiskBand {
  if (score >= 70) return "CRITICAL";
  if (score >= 45) return "HIGH";
  if (score >= 20) return "MODERATE";
  return "LOW";
}

function monthsSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.4);
}

function computeFactors(findings: RiskFindingInput[], weight: number): RiskFactor[] {
  if (!findings.length) return [];

  const severitySum = findings.reduce((s, f) => s + Math.max(0, Math.min(10, f.severity)), 0);
  const severityScore = Math.min(FACTOR_MAX.severity, severitySum * 1.2) * weight;

  const authorityPeak = Math.max(0, ...findings.map((f) => f.sourceAuthority ?? 0));
  const authorityScore = Math.min(FACTOR_MAX.authority, authorityPeak) * weight;

  const ranked = findings
    .map((f) => f.searchRank)
    .filter((r): r is number => typeof r === "number" && r > 0);
  const bestRank = ranked.length ? Math.min(...ranked) : null;
  const visibilityScore =
    (bestRank === null ? 0 : bestRank <= 3 ? 10 : bestRank <= 10 ? 6 : bestRank <= 30 ? 3 : 1) * weight;

  const platforms = new Set(findings.map((f) => f.platform).filter(Boolean));
  const spreadScore = Math.min(FACTOR_MAX.spread, platforms.size * 2) * weight;

  const reuploads = findings.reduce((s, f) => s + Math.max(0, f.reuploadCount ?? 0), 0);
  const propagationScore = Math.min(FACTOR_MAX.propagation, reuploads * 1.5) * weight;

  const ages = findings.map((f) => monthsSince(f.publishedAt)).filter((m): m is number => m !== null);
  const freshest = ages.length ? Math.min(...ages) : null;
  const recencyScore =
    (freshest === null ? 2 : freshest <= 1 ? 7 : freshest <= 3 ? 5 : freshest <= 12 ? 3 : 1) * weight;

  const manipulation = findings
    .map((f) => f.aiManipulationConfidence)
    .filter((c): c is number => typeof c === "number");
  const manipulationScore =
    (manipulation.length ? (Math.max(...manipulation) / 100) * FACTOR_MAX.manipulation : 0) * weight;

  const identityAvg =
    findings.reduce((s, f) => s + (f.identityConfidence ?? 0), 0) / findings.length / 100;
  const identityScore = identityAvg * FACTOR_MAX.identity * weight;

  const round = (n: number) => Math.round(n * 10) / 10;

  return [
    {
      key: "severity",
      label: "Finding severity",
      contribution: round(severityScore),
      max: FACTOR_MAX.severity,
      detail: `${findings.length} finding(s), severity total ${severitySum}`,
    },
    {
      key: "authority",
      label: "Source authority",
      contribution: round(authorityScore),
      max: FACTOR_MAX.authority,
      detail: `highest source authority ${authorityPeak}/10`,
    },
    {
      key: "visibility",
      label: "Search visibility",
      contribution: round(visibilityScore),
      max: FACTOR_MAX.visibility,
      detail: bestRank === null ? "no search-ranked items" : `best observed rank #${bestRank}`,
    },
    {
      key: "spread",
      label: "Platform spread",
      contribution: round(spreadScore),
      max: FACTOR_MAX.spread,
      detail: `${platforms.size} platform(s)`,
    },
    {
      key: "propagation",
      label: "Propagation / reuploads",
      contribution: round(propagationScore),
      max: FACTOR_MAX.propagation,
      detail: `${reuploads} related copy/copies clustered`,
    },
    {
      key: "recency",
      label: "Recency",
      contribution: round(recencyScore),
      max: FACTOR_MAX.recency,
      detail:
        freshest === null
          ? "no publication dates available"
          : `most recent item ~${Math.max(0, Math.round(freshest))} month(s) old`,
    },
    {
      key: "manipulation",
      label: "AI-manipulation confidence",
      contribution: round(manipulationScore),
      max: FACTOR_MAX.manipulation,
      detail: manipulation.length
        ? `peak analysis confidence ${Math.round(Math.max(...manipulation))}%`
        : "manipulation analysis did not run or returned no signal",
    },
    {
      key: "identity",
      label: "Identity confidence",
      contribution: round(identityScore),
      max: FACTOR_MAX.identity,
      detail: `average identity confidence ${Math.round(identityAvg * 100)}% across matched items`,
    },
  ];
}

function sum(factors: RiskFactor[]): number {
  return Math.round(factors.reduce((s, f) => s + f.contribution, 0));
}

function thinCoverage(coverage: CoverageState): boolean {
  return coverage === "LIMITED" || coverage === "INSUFFICIENT";
}

/** A) Preliminary Exposure Signal — includes unverified findings, capped. */
export function computePreliminaryExposure(
  findings: RiskFindingInput[],
  coverage: CoverageState,
): RiskScoreResult {
  const matched = findings.filter(
    (f) => f.identityBucket === "MATCHED" && f.state !== "REJECTED",
  );
  const verified = matched.filter((f) => f.state === "VERIFIED" || f.state === "ESCALATED");
  const unverified = matched.filter((f) => f.state !== "VERIFIED" && f.state !== "ESCALATED");

  const verifiedFactors = computeFactors(verified, 1);
  const provisionalFactors = computeFactors(unverified, UNVERIFIED_WEIGHT);

  const factors: RiskFactor[] = [
    ...verifiedFactors.map((f) => ({ ...f, key: `verified.${f.key}`, label: `${f.label} (verified)` })),
    ...provisionalFactors.map((f) => ({
      ...f,
      key: `provisional.${f.key}`,
      label: `${f.label} (provisional)`,
      max: Math.round(f.max * UNVERIFIED_WEIGHT * 10) / 10,
    })),
  ];

  const score = Math.min(100, sum(factors));
  const awaiting = unverified.length;

  let band: PreliminaryBand = bandFor(score);
  let qualifier = "Preliminary · Not yet human verified";

  if (matched.length === 0 || thinCoverage(coverage)) {
    band = "INSUFFICIENT_DATA";
    qualifier =
      matched.length === 0
        ? "Insufficient data · no identity-matched relevant records in scanned sources"
        : `Insufficient data · coverage ${coverage.toLowerCase()}`;
  } else if (coverage !== "COMPLETE") {
    qualifier = "Preliminary · Not yet human verified · Risk assessment based on available sources";
  }

  return {
    kind: "PRELIMINARY",
    modelVersion: PRELIMINARY_MODEL_VERSION,
    score: band === "INSUFFICIENT_DATA" ? 0 : score,
    band,
    factors,
    findingsConsidered: matched.length,
    findingsAwaitingVerification: awaiting,
    coverageState: coverage,
    qualifier,
  };
}

/** B) Verified Risk Assessment — human-verified findings only. */
export function computeVerifiedRisk(
  findings: RiskFindingInput[],
  coverage: CoverageState,
): RiskScoreResult {
  const verified = findings.filter(
    (f) => f.identityBucket === "MATCHED" && (f.state === "VERIFIED" || f.state === "ESCALATED"),
  );
  const awaiting = findings.filter(
    (f) =>
      f.identityBucket === "MATCHED" &&
      (f.state === "CLASSIFIED" || f.state === "NEEDS_HUMAN_REVIEW" || f.state === "DISCOVERED"),
  ).length;

  const factors = computeFactors(verified, 1);
  const score = Math.min(100, sum(factors));

  let band: VerifiedBand;
  let qualifier: string;
  if (verified.length === 0) {
    band = "PENDING_VERIFICATION";
    qualifier =
      awaiting > 0
        ? `Pending verification · ${awaiting} finding(s) awaiting human review`
        : "Pending verification · no findings verified yet";
  } else if (thinCoverage(coverage)) {
    band = "INSUFFICIENT_DATA";
    qualifier = `Insufficient data · coverage ${coverage.toLowerCase()}`;
  } else {
    band = bandFor(score);
    qualifier =
      coverage === "COMPLETE"
        ? `Based on ${verified.length} human-verified finding(s)`
        : `Based on ${verified.length} human-verified finding(s) · Risk assessment based on available sources`;
  }

  return {
    kind: "VERIFIED",
    modelVersion: VERIFIED_MODEL_VERSION,
    score: band === "PENDING_VERIFICATION" || band === "INSUFFICIENT_DATA" ? 0 : score,
    band,
    factors,
    findingsConsidered: verified.length,
    findingsAwaitingVerification: awaiting,
    coverageState: coverage,
    qualifier,
  };
}
