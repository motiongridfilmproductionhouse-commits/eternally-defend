/**
 * Risk scoring — combines transcript, visual, fact-check, and translation signals
 * into the 9 scores in the Multimedia Intelligence spec.
 *
 * Every score is *explainable*: `explainRiskScores` returns the exact formula
 * terms used to compute each axis, so the UI can render a "Why this score?"
 * breakdown without recomputing.
 *
 * Contribution formula:  severity × confidence × entity_relevance
 * (see `SIGNAL_WEIGHTS`).
 */
export interface RiskInputs {
  transcriptHits: number;
  visualHits: number;
  assetMatches: number;
  factChecksFalse: number;
  factChecksReviewed: number;
  criticalFindings: number;
  highFindings: number;
  reachEstimate: number;
  translationLowConfidence: boolean;
  transcriptAvgConfidence: number; // 0..1
}

export interface RiskScores {
  reputation: number;
  defamation: number;
  copyright: number;
  misinformation: number;
  harassment: number;
  impersonation: number;
  viralAmplification: number;
  entityRelevance: number;
  evidenceConfidence: number;
}

export interface SignalContribution {
  signal: string;         // "fact_checks_false"
  label: string;          // human label
  points: number;         // points contributed to this axis
  confidence: number;     // 0..1
  weight: number;         // configured weight
  count: number;          // count of the underlying evidence
}

export interface AxisExplanation {
  score: number;
  contributions: SignalContribution[];
  missing: string[];      // signals with zero evidence that would raise this score
  model_version: string;
  calculated_at: string;
  formula: string;
}

export interface RiskExplanation {
  scores: RiskScores;
  explanations: Record<keyof RiskScores, AxisExplanation>;
  model_version: string;
  calculated_at: string;
}

const MODEL_VERSION = "risk-v2.1";
const FORMULA = "score = Σ (severity × confidence × entity_relevance × count)  — clamped 0..100";

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

function reachTier(reach: number) {
  if (reach > 1_000_000) return { pts: 30, tier: "viral (>1M)" };
  if (reach > 100_000)   return { pts: 20, tier: "large (>100K)" };
  if (reach > 10_000)    return { pts: 12, tier: "medium (>10K)" };
  return { pts: 5, tier: "low (<10K)" };
}

function axis(
  contribs: Array<Omit<SignalContribution, "points"> & { severity: number }>,
  missing: string[],
): AxisExplanation {
  const contributions = contribs.map((c) => ({
    signal: c.signal, label: c.label,
    count: c.count, confidence: c.confidence, weight: c.weight,
    points: Math.round(c.severity * c.confidence * c.weight * Math.max(1, c.count)),
  }));
  const raw = contributions.reduce((s, c) => s + c.points, 0);
  return {
    score: clamp(raw),
    contributions,
    missing,
    model_version: MODEL_VERSION,
    calculated_at: new Date().toISOString(),
    formula: FORMULA,
  };
}

export function explainRiskScores(i: RiskInputs): RiskExplanation {
  const reach = reachTier(i.reachEstimate);
  const evConf = 0.85; // baseline evidence confidence for tallied counts
  const entityRel = i.transcriptHits + i.visualHits > 0 ? 1 : 0.5;

  const factCheckSig = {
    signal: "fact_checks_false", label: "Fact checks rated false / misleading",
    severity: 8, count: i.factChecksFalse, confidence: 0.9, weight: 1,
  };
  const factCheckReviewed = {
    signal: "fact_checks_reviewed", label: "Fact-check reviews found (any rating)",
    severity: 2, count: i.factChecksReviewed, confidence: 0.75, weight: 1,
  };
  const criticalFinding = {
    signal: "critical_findings", label: "Critical timeline findings",
    severity: 20, count: i.criticalFindings, confidence: 0.95, weight: 1,
  };
  const highFinding = {
    signal: "high_findings", label: "High-severity findings",
    severity: 10, count: i.highFindings, confidence: 0.9, weight: 1,
  };
  const mention = {
    signal: "transcript_hits", label: "Protected name mentions in text/transcript",
    severity: 3, count: i.transcriptHits, confidence: evConf, weight: entityRel,
  };
  const visual = {
    signal: "visual_hits", label: "Visual/logo/photo matches",
    severity: 6, count: i.visualHits, confidence: evConf, weight: entityRel,
  };
  const asset = {
    signal: "asset_matches", label: "Protected asset matches (>0.8 similarity)",
    severity: 12, count: i.assetMatches, confidence: 0.95, weight: 1,
  };
  const reachSig = {
    signal: "reach", label: `Audience reach — ${reach.tier}`,
    severity: reach.pts, count: 1, confidence: 0.8, weight: 1,
  };

  const explanations = {
    reputation: axis(
      [criticalFinding, highFinding, factCheckSig, reachSig,
       { ...mention, severity: 15, count: i.transcriptHits ? 1 : 0 }],
      missingFor(["fact_checks_false", "critical_findings", "visual_hits"], i),
    ),
    defamation: axis(
      [criticalFinding, highFinding, { ...mention, severity: 6 }],
      missingFor(["transcript_hits", "critical_findings"], i),
    ),
    copyright: axis(
      [{ ...asset, severity: 25 }, visual],
      missingFor(["asset_matches", "visual_hits"], i),
    ),
    misinformation: axis(
      [{ ...factCheckSig, severity: 22 }, { ...factCheckReviewed, severity: 6 }],
      missingFor(["fact_checks_false", "fact_checks_reviewed"], i),
    ),
    harassment: axis(
      [{ ...highFinding, severity: 8 }, { ...criticalFinding, severity: 15 }],
      missingFor(["critical_findings", "high_findings"], i),
    ),
    impersonation: axis(
      [{ ...asset, severity: 18 }, { ...visual, severity: 8 }],
      missingFor(["asset_matches", "visual_hits"], i),
    ),
    viralAmplification: axis(
      [{ ...reachSig, severity: reach.pts * 2, count: 1 },
       { ...criticalFinding, severity: 5 }],
      missingFor(["critical_findings"], i),
    ),
    entityRelevance: axis(
      [{ ...mention, severity: 12 }, { ...visual, severity: 12 }],
      missingFor(["transcript_hits", "visual_hits"], i),
    ),
    evidenceConfidence: axis(
      [{ signal: "transcript_confidence", label: "Transcript avg confidence",
         severity: Math.round(i.transcriptAvgConfidence * 60),
         count: 1, confidence: 1, weight: 1 },
       { signal: "fact_check_present", label: "Fact-check evidence available",
         severity: i.factChecksReviewed ? 20 : 0, count: 1, confidence: 1, weight: 1 },
       { signal: "translation_ok", label: "Translation confidence adequate",
         severity: i.translationLowConfidence ? 0 : 20, count: 1, confidence: 1, weight: 1 }],
      i.transcriptAvgConfidence < 0.6 ? ["transcript_confidence"] : [],
    ),
  } satisfies Record<keyof RiskScores, AxisExplanation>;

  const scores: RiskScores = {
    reputation: explanations.reputation.score,
    defamation: explanations.defamation.score,
    copyright: explanations.copyright.score,
    misinformation: explanations.misinformation.score,
    harassment: explanations.harassment.score,
    impersonation: explanations.impersonation.score,
    viralAmplification: explanations.viralAmplification.score,
    entityRelevance: explanations.entityRelevance.score,
    evidenceConfidence: explanations.evidenceConfidence.score,
  };

  return {
    scores,
    explanations,
    model_version: MODEL_VERSION,
    calculated_at: new Date().toISOString(),
  };
}

function missingFor(signals: string[], i: RiskInputs): string[] {
  const map: Record<string, number> = {
    fact_checks_false: i.factChecksFalse,
    fact_checks_reviewed: i.factChecksReviewed,
    critical_findings: i.criticalFindings,
    high_findings: i.highFindings,
    transcript_hits: i.transcriptHits,
    visual_hits: i.visualHits,
    asset_matches: i.assetMatches,
  };
  return signals.filter((s) => (map[s] ?? 0) === 0);
}

/** Backwards-compat helper used by existing pipeline. */
export function computeRiskScores(i: RiskInputs): RiskScores {
  return explainRiskScores(i).scores;
}
