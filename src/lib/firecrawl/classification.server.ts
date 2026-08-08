/**
 * Strict Subject Relevance & Context Classification Engine.
 *
 * Distinguishes:
 *  - Subject Relevance: MATCH | PROBABLE_MATCH | AMBIGUOUS | NOT_SUBJECT
 *  - Reputation Context: OFFICIAL | NEUTRAL | POSITIVE | CRITICISM | NEGATIVE_OPINION |
 *                        ALLEGATION | UNVERIFIED_CLAIM | MISINFORMATION_SIGNAL |
 *                        IMPERSONATION | HARASSMENT | DEFAMATION_CANDIDATE |
 *                        DEEPFAKE_CANDIDATE | SCAM_OR_FAKE_ENDORSEMENT | OTHER_REPUTATION_RISK
 *
 * NOTE: Negative criticism or opinion is NOT automatically labeled as legal defamation.
 */

export type SubjectRelevance =
  | "MATCH"
  | "PROBABLE_MATCH"
  | "AMBIGUOUS"
  | "NOT_SUBJECT";

export type ReputationContext =
  | "OFFICIAL"
  | "NEUTRAL"
  | "POSITIVE"
  | "CRITICISM"
  | "NEGATIVE_OPINION"
  | "ALLEGATION"
  | "UNVERIFIED_CLAIM"
  | "MISINFORMATION_SIGNAL"
  | "IMPERSONATION"
  | "HARASSMENT"
  | "DEFAMATION_CANDIDATE"
  | "DEEPFAKE_CANDIDATE"
  | "SCAM_OR_FAKE_ENDORSEMENT"
  | "OTHER_REPUTATION_RISK";

export interface ClassificationResult {
  relevance: SubjectRelevance;
  context: ReputationContext;
  confidenceScore: number; // 0..100
  isDefamationCandidate: boolean;
  isDeepfakeCandidate: boolean;
  classificationReason: string;
}

export function classifyContent(
  targetQuery: string,
  aliases: string[],
  title: string,
  snippet: string,
  url: string,
  markdownContent?: string,
): ClassificationResult {
  const combinedText = `${title} ${snippet} ${markdownContent ?? ""}`.toLowerCase();
  const normalizedTarget = targetQuery.toLowerCase().trim();
  const nameTokens = normalizedTarget.split(" ").filter((t) => t.length >= 3);

  // 1. RELEVANCE DETERMINATION
  let relevance: SubjectRelevance = "NOT_SUBJECT";
  let relevanceScore = 0;

  const hasExactName = combinedText.includes(normalizedTarget);
  const aliasMatch = aliases.some((a) => a.trim() && combinedText.includes(a.toLowerCase().trim()));
  const tokenMatches = nameTokens.filter((t) => combinedText.includes(t)).length;

  if (hasExactName || aliasMatch) {
    relevance = "MATCH";
    relevanceScore = 95;
  } else if (nameTokens.length > 1 && tokenMatches >= nameTokens.length) {
    relevance = "PROBABLE_MATCH";
    relevanceScore = 80;
  } else if (tokenMatches > 0) {
    relevance = "AMBIGUOUS";
    relevanceScore = 45;
  }

  if (relevance === "NOT_SUBJECT") {
    return {
      relevance,
      context: "NEUTRAL",
      confidenceScore: 0,
      isDefamationCandidate: false,
      isDeepfakeCandidate: false,
      classificationReason: "No target name or alias match found in text or metadata",
    };
  }

  // 2. REPUTATION CONTEXT CLASSIFICATION
  let context: ReputationContext = "NEUTRAL";
  let isDefamationCandidate = false;
  let isDeepfakeCandidate = false;

  const isDeepfakeTerm = /\b(?:deepfake|ai generated|ai face|morphed|face swap|synthetic media|edited video|fake video)\b/i.test(combinedText);
  const isImpersonationTerm = /\b(?:impersonat\w*|fake account|fake profile|parody account)\b/i.test(combinedText);
  const isAllegationTerm = /\b(?:allegation|alleged|accused|police|fir|court|lawsuit|investigation|complaint)\b/i.test(combinedText);
  const isScamTerm = /\b(?:scam|fraud|fake endorsement|unauthorized ad|crypto scam)\b/i.test(combinedText);
  const isHarassmentTerm = /\b(?:harass\w*|abuse|trolled|trolling|cyberbullying)\b/i.test(combinedText);
  const isDefamationTerm = /\b(?:defamat\w*|slander|libel|false claims|character assassination)\b/i.test(combinedText);
  const isCriticismTerm = /\b(?:criticism|criticized|review|opinion|backlash|disagree)\b/i.test(combinedText);
  const isPositiveTerm = /\b(?:award|praised|stunning|beautiful|success|hit|loved|triumph|great)\b/i.test(combinedText);

  if (isDeepfakeTerm) {
    context = "DEEPFAKE_CANDIDATE";
    isDeepfakeCandidate = true;
  } else if (isImpersonationTerm) {
    context = "IMPERSONATION";
  } else if (isScamTerm) {
    context = "SCAM_OR_FAKE_ENDORSEMENT";
  } else if (isDefamationTerm) {
    context = "DEFAMATION_CANDIDATE";
    isDefamationCandidate = true;
  } else if (isAllegationTerm) {
    context = "ALLEGATION";
    // Only mark as legal defamation candidate if explicit false defamatory assertion keywords are present
    if (combinedText.includes("false allegation") || combinedText.includes("fabricated")) {
      isDefamationCandidate = true;
    }
  } else if (isHarassmentTerm) {
    context = "HARASSMENT";
  } else if (isCriticismTerm) {
    // Standard criticism / negative opinion is NOT legal defamation
    context = "CRITICISM";
  } else if (isPositiveTerm) {
    context = "POSITIVE";
  }

  const confidenceScore = Math.min(98, relevanceScore + (context !== "NEUTRAL" ? 10 : 0));

  return {
    relevance,
    context,
    confidenceScore,
    isDefamationCandidate,
    isDeepfakeCandidate,
    classificationReason: `Relevance: ${relevance} · Context: ${context}`,
  };
}
