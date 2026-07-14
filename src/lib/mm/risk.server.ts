/**
 * Risk scoring — combines transcript, visual, fact-check, and translation signals
 * into the 9 scores defined in the Multimedia Intelligence spec.
 */
export interface RiskInputs {
  transcriptHits: number;         // # segments mentioning the target
  visualHits: number;             // # frames with logo/photo/product match
  assetMatches: number;           // # protected_asset_matches with similarity > 0.8
  factChecksFalse: number;        // # fact_check_matches classified rated_false/misleading
  factChecksReviewed: number;     // # fact_check_matches classified anything
  criticalFindings: number;       // # timeline findings with severity=critical
  highFindings: number;
  reachEstimate: number;          // views or equivalent
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

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

export function computeRiskScores(i: RiskInputs): RiskScores {
  const reachFactor = i.reachEstimate > 1_000_000 ? 30 : i.reachEstimate > 100_000 ? 20 : i.reachEstimate > 10_000 ? 12 : 5;
  const critical = i.criticalFindings * 20 + i.highFindings * 10;
  return {
    reputation: clamp(critical + i.factChecksFalse * 8 + reachFactor + (i.transcriptHits ? 15 : 0)),
    defamation: clamp(critical + i.transcriptHits * 6),
    copyright: clamp(i.assetMatches * 25 + i.visualHits * 6),
    misinformation: clamp(i.factChecksFalse * 22 + i.factChecksReviewed * 6),
    harassment: clamp(i.highFindings * 8 + i.criticalFindings * 15),
    impersonation: clamp(i.assetMatches * 18 + i.visualHits * 8),
    viralAmplification: clamp(reachFactor * 2 + i.criticalFindings * 5),
    entityRelevance: clamp((i.transcriptHits + i.visualHits) * 12),
    evidenceConfidence: clamp(
      (i.transcriptAvgConfidence * 60) +
      (i.factChecksReviewed ? 20 : 0) +
      (i.translationLowConfidence ? 0 : 20),
    ),
  };
}
