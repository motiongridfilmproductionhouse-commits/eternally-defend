/**
 * YouTube Removal Intelligence — Multi-Signal Removal Classifier, Provenance & Action Recommendation Engine.
 *
 * Evaluates target-verified candidates against independent legal and platform policy grounds:
 *  - COPYRIGHT (unauthorized footage, full movie leak, copied media)
 *  - IMPERSONATION (fake channel, deceptive identity, scam ad)
 *  - MANIPULATED / SYNTHETIC MEDIA (deepfake, AI face swap, fabricated voice)
 *  - PRIVACY (doxxing, exposed private identifiers, non-consensual imagery)
 *  - HARASSMENT / THREATS (targeted abusive campaign, threats)
 *  - DEFAMATION / FALSE FACTUAL CLAIMS (verifiable false factual assertions; opinion/criticism strictly excluded)
 *
 * Explicit evidence provenance, sufficiency rules, and separated reason code namespaces:
 *  - Evidence Reasons: EVIDENCE_TRANSCRIPT_MISSING, EVIDENCE_DESCRIPTION_MISSING, EVIDENCE_TITLE_ONLY, EVIDENCE_LOW_CONFIDENCE, EVIDENCE_UNAVAILABLE
 *  - Removal Reasons: NO_ACTIONABLE_VIOLATION, COMMENTARY_OR_OPINION, POSSIBLE_FAIR_USE, NO_COPYRIGHT_MATCH, NO_IMPERSONATION, NO_DEFAMATORY_ASSERTION, POLICY_NOT_IDENTIFIED
 *  - Infrastructure Reasons: CLASSIFIER_FAILURE, TRANSCRIPT_PROVIDER_FAILURE, OCR_FAILURE
 */

export type TerminalRemovalClassification =
  | "HIGH_REMOVAL"
  | "MEDIUM_REMOVAL"
  | "LOW_REMOVAL"
  | "NOT_ELIGIBLE"
  | "ANALYSIS_FAILED";

export type EvidenceReasonCode =
  | "EVIDENCE_TRANSCRIPT_MISSING"
  | "EVIDENCE_DESCRIPTION_MISSING"
  | "EVIDENCE_TITLE_ONLY"
  | "EVIDENCE_LOW_CONFIDENCE"
  | "EVIDENCE_UNAVAILABLE";

export type RemovalReasonCode =
  | "NO_ACTIONABLE_VIOLATION"
  | "COMMENTARY_OR_OPINION"
  | "POSSIBLE_FAIR_USE"
  | "NO_COPYRIGHT_MATCH"
  | "NO_IMPERSONATION"
  | "NO_DEFAMATORY_ASSERTION"
  | "POLICY_NOT_IDENTIFIED";

export type InfrastructureReasonCode =
  | "CLASSIFIER_FAILURE"
  | "TRANSCRIPT_PROVIDER_FAILURE"
  | "OCR_FAILURE";

export type ReasonCode = EvidenceReasonCode | RemovalReasonCode | InfrastructureReasonCode;

export type EvidenceStatus = "SUFFICIENT" | "INSUFFICIENT" | "UNAVAILABLE";

export type EvidenceSource =
  | "TITLE"
  | "DESCRIPTION"
  | "THUMBNAIL_OCR"
  | "THUMBNAIL_VISUAL"
  | "CHANNEL_METADATA"
  | "CAPTIONS"
  | "TRANSCRIPT"
  | "EXTERNAL_EVIDENCE"
  | "MULTI_SOURCE"
  | "NONE";

export type ActionRecommendation =
  | "PLATFORM_REPORT_CANDIDATE"
  | "COPYRIGHT_REVIEW"
  | "LEGAL_REVIEW"
  | "IMPERSONATION_REVIEW"
  | "PRIVACY_REVIEW"
  | "HARASSMENT_REVIEW"
  | "MONITOR"
  | "NO_ACTION"
  | "INSUFFICIENT_EVIDENCE";

export interface RemovalAnalysisTarget {
  title: string;
  description?: string;
  snippet?: string;
  author?: string;
  transcript?: string;
  hasTranscript?: boolean;
  ocrText?: string;
  url: string;
  subjectVerificationStatus: string;
  verificationScore: number;
}

export interface DetectedPolicySignals {
  hasCopyrightMatch: boolean;
  hasImpersonation: boolean;
  hasManipulatedMedia: boolean;
  hasPrivacyViolation: boolean;
  hasHarassmentOrThreats: boolean;
  hasFactualAllegation: boolean;
  isOpinionOrCommentary: boolean;
  isOfficialOrSupportive: boolean;
}

export interface RemovalAnalysisResult {
  removalClassification: TerminalRemovalClassification;
  removalScore: number; // 0..100
  evidenceReasons: EvidenceReasonCode[];
  removalReasons: RemovalReasonCode[];
  infrastructureReasons: InfrastructureReasonCode[];
  allReasonCodes: ReasonCode[];
  supportingEvidence: string[];
  evidenceStatus: EvidenceStatus;
  evidenceConfidence: number; // 0..100
  evidenceSources: EvidenceSource[];
  evidenceSourceCount: number;
  meaningfulIndependentSourceCount: number;
  actionRecommendation: ActionRecommendation;
  policySignals: DetectedPolicySignals;
  humanReadableReason: string;
  analysisVersion: string; // "2.3.0"
}

export function inspectClassifierInput(target: RemovalAnalysisTarget) {
  return {
    videoId: target.url.match(/(?:v=|\/embed\/|\/shorts\/|\/watch\?v=)([\w-]{6,})/)?.[1] || target.url,
    titleLength: (target.title || "").length,
    descriptionLength: (target.description || target.snippet || "").length,
    transcriptLength: (target.transcript || "").length,
    hasTranscript: Boolean(target.transcript || target.hasTranscript),
    hasOcr: Boolean(target.ocrText),
    author: target.author || "Unknown Channel",
  };
}

export function classifyRemovalEligibility(
  target: RemovalAnalysisTarget,
): RemovalAnalysisResult {
  const analysisVersion = "2.3.0";
  const evidenceReasons: EvidenceReasonCode[] = [];
  const removalReasons: RemovalReasonCode[] = [];
  const infrastructureReasons: InfrastructureReasonCode[] = [];
  const supportingEvidence: string[] = [];
  const rawEvidenceSources: EvidenceSource[] = [];

  try {
    const title = (target.title || "").trim();
    const snippet = (target.snippet || target.description || "").trim();
    const transcript = (target.transcript || "").trim();
    const author = (target.author || "").trim();
    const ocrText = (target.ocrText || "").trim();

    const hasTranscript = Boolean(transcript || target.hasTranscript);
    const combinedText = `${title} ${snippet} ${transcript} ${ocrText} ${author}`.toLowerCase();

    // 1. EVIDENCE PROVENANCE & SUFFICIENCY EVALUATION
    if (title) rawEvidenceSources.push("TITLE");
    if (author) rawEvidenceSources.push("CHANNEL_METADATA");

    if (hasTranscript) {
      rawEvidenceSources.push("TRANSCRIPT");
      supportingEvidence.push("Full video transcript available and analyzed");
    }

    if (snippet.length >= 25) {
      rawEvidenceSources.push("DESCRIPTION");
      supportingEvidence.push("Detailed description and metadata analyzed");
    }

    if (ocrText) {
      rawEvidenceSources.push("THUMBNAIL_OCR");
      supportingEvidence.push("Thumbnail OCR text analyzed");
    }

    // Meaningful independent content sources exclude metadata derived from title/channel
    const independentContentSources = rawEvidenceSources.filter(
      (s) => s !== "NONE" && s !== "TITLE" && s !== "CHANNEL_METADATA",
    );

    const meaningfulIndependentSourceCount =
      independentContentSources.length + (title ? 1 : 0);

    const evidenceSources = [...rawEvidenceSources];
    if (meaningfulIndependentSourceCount >= 2 && independentContentSources.length >= 1) {
      evidenceSources.push("MULTI_SOURCE");
    }

    let evidenceStatus: EvidenceStatus = "INSUFFICIENT";
    let evidenceConfidence = 30;

    if (hasTranscript) {
      evidenceStatus = "SUFFICIENT";
      evidenceConfidence = 95;
    } else if (snippet.length >= 25 && title) {
      evidenceStatus = "SUFFICIENT";
      evidenceConfidence = 75;
      evidenceReasons.push("EVIDENCE_TRANSCRIPT_MISSING");
    } else if (ocrText && title) {
      evidenceStatus = "SUFFICIENT";
      evidenceConfidence = 75;
      evidenceReasons.push("EVIDENCE_TRANSCRIPT_MISSING");
    } else if (title) {
      evidenceStatus = "INSUFFICIENT";
      evidenceConfidence = 30;
      evidenceReasons.push("EVIDENCE_TITLE_ONLY");
      evidenceReasons.push("EVIDENCE_DESCRIPTION_MISSING");
      evidenceReasons.push("EVIDENCE_TRANSCRIPT_MISSING");
      supportingEvidence.push("Only title/channel metadata available; missing transcript and description");
    } else {
      evidenceStatus = "UNAVAILABLE";
      evidenceConfidence = 0;
      evidenceReasons.push("EVIDENCE_UNAVAILABLE");
      supportingEvidence.push("Zero usable video evidence or metadata obtained");
    }

    // 2. MULTI-SIGNAL VIOLATION GROUNDS DETECTION
    const isExplicitDefamation =
      /\b(?:defamat\w*|slander|libel|character assassination|false allegation|fabricated claim|extramarital affair scandal|bribe claim|scam allegation)\b/i.test(
        combinedText,
      );

    const isFactualAllegation =
      /\b(?:allegation|alleged|scandal|exposed|court case|fir|police complaint|investigation|corruption claim|fraud allegation|arrested|raid|it raid|cbi probe)\b/i.test(
        combinedText,
      );

    const isImpersonation =
      /\b(?:impersonat\w*|fake\s*(?:account|profile|channel|page|giveaway|video)|official\s*[\w\s]{0,25}\s*channel|scam\s*(?:giveaway|ad|crypto|investment))\b/i.test(
        combinedText,
      );

    const isCopyrightOrLeak =
      /\b(?:full movie download|leaked scene|unauthorized stream|telegram link|torrent|piracy|leaked audio|leaked video|movie rip|hd print|hdcam)\b/i.test(
        combinedText,
      );

    const isDeepfake =
      /\b(?:deepfake|ai generated|face swap|fake video|synthetic voice|ai nude|voice clone|synthetic media)\b/i.test(
        combinedText,
      );

    const isPrivacyViolation =
      /\b(?:doxx\w*|exposed phone number|home address|personal identity leaked|private WhatsApp chat|leaked photo|leaked video)\b/i.test(
        combinedText,
      );

    const isHarassmentOrThreats =
      /\b(?:kill threat|threatened|targeted harassment|abusive campaign|hate speech against|troll army)\b/i.test(
        combinedText,
      );

    const isCommentaryOrOpinion =
      /\b(?:review|opinion|reaction|discussion|analysis|news analysis|public view|commentary|fair comment|criticism|satire|roast|movie review)\b/i.test(
        combinedText,
      );

    const isSupportiveOrOfficial =
      /\b(?:official|tribute|inauguration|speech|interview|award|function|press meet|foundation|charity|audio launch|trailer launch)\b/i.test(
        combinedText,
      );

    const policySignals: DetectedPolicySignals = {
      hasCopyrightMatch: isCopyrightOrLeak,
      hasImpersonation: isImpersonation,
      hasManipulatedMedia: isDeepfake,
      hasPrivacyViolation: isPrivacyViolation,
      hasHarassmentOrThreats: isHarassmentOrThreats,
      hasFactualAllegation: isFactualAllegation || isExplicitDefamation,
      isOpinionOrCommentary: isCommentaryOrOpinion,
      isOfficialOrSupportive: isSupportiveOrOfficial,
    };

    let removalScore = 0;
    let classification: TerminalRemovalClassification = "NOT_ELIGIBLE";
    let actionRecommendation: ActionRecommendation = "NO_ACTION";
    let humanReadableReason = "";

    // 3. CLASSIFICATION & ACTION RECOMMENDATION LOGIC

    if (evidenceStatus === "INSUFFICIENT" || evidenceStatus === "UNAVAILABLE") {
      removalScore = 15;
      classification = "NOT_ELIGIBLE";
      actionRecommendation = "INSUFFICIENT_EVIDENCE";
      humanReadableReason = "Evidence could not be obtained to determine whether a policy violation exists.";
    } else if (isDeepfake) {
      removalScore = 95;
      classification = "HIGH_REMOVAL";
      actionRecommendation = "PLATFORM_REPORT_CANDIDATE";
      supportingEvidence.push("Deepfake / synthetic media manipulation signal detected");
      humanReadableReason = "Manipulated AI deepfake content violating YouTube synthetic media policy.";
    } else if (isCopyrightOrLeak) {
      removalScore = 88;
      classification = "HIGH_REMOVAL";
      actionRecommendation = "COPYRIGHT_REVIEW";
      supportingEvidence.push("Unauthorized pirated movie footage / leaked video asset detected");
      humanReadableReason = "Unauthorized reproduction of copyrighted movie footage or leaked asset.";
    } else if (isImpersonation) {
      removalScore = 82;
      classification = "HIGH_REMOVAL";
      actionRecommendation = "IMPERSONATION_REVIEW";
      supportingEvidence.push("Channel / profile impersonation signal detected");
      humanReadableReason = "Deceptive representation or channel impersonation of target entity.";
    } else if (isPrivacyViolation) {
      removalScore = 80;
      classification = "HIGH_REMOVAL";
      actionRecommendation = "PRIVACY_REVIEW";
      supportingEvidence.push("Exposed private identifiers / non-consensual personal data detected");
      humanReadableReason = "Exposure of private personal information or non-consensual imagery.";
    } else if (isHarassmentOrThreats) {
      removalScore = 78;
      classification = "HIGH_REMOVAL";
      actionRecommendation = "HARASSMENT_REVIEW";
      supportingEvidence.push("Targeted harassment campaign or explicit threat detected");
      humanReadableReason = "Targeted abusive harassment or explicit safety threat against individual.";
    } else if (isExplicitDefamation) {
      removalScore = 65;
      classification = "MEDIUM_REMOVAL";
      actionRecommendation = "LEGAL_REVIEW";
      supportingEvidence.push("Explicit defamatory assertion / character assassination claim detected");
      humanReadableReason = "Explicit factual defamation claim requiring legal counsel review.";
    } else if (isFactualAllegation) {
      removalScore = 40;
      classification = "LOW_REMOVAL";
      actionRecommendation = "LEGAL_REVIEW";
      supportingEvidence.push("Specific factual allegation identified; legal basis requires review");
      humanReadableReason = "Potential factual allegation identified, but falsity and legal basis cannot be established automatically.";
    } else if (isCommentaryOrOpinion) {
      removalScore = 20;
      classification = "NOT_ELIGIBLE";
      actionRecommendation = "MONITOR";
      removalReasons.push("COMMENTARY_OR_OPINION");
      removalReasons.push("NO_DEFAMATORY_ASSERTION");
      removalReasons.push("POSSIBLE_FAIR_USE");
      supportingEvidence.push("Protected commentary, movie review, or public discussion without explicit violation");
      humanReadableReason = "General commentary, review, or public opinion protected under fair comment/discussion.";
    } else if (isSupportiveOrOfficial) {
      removalScore = 10;
      classification = "NOT_ELIGIBLE";
      actionRecommendation = "NO_ACTION";
      removalReasons.push("NO_ACTIONABLE_VIOLATION");
      removalReasons.push("POLICY_NOT_IDENTIFIED");
      supportingEvidence.push("Neutral/supportive coverage, official speech, or public event coverage");
      humanReadableReason = "Neutral event coverage, official function speech, or supportive media.";
    } else {
      removalScore = 15;
      classification = "NOT_ELIGIBLE";
      actionRecommendation = "MONITOR";
      removalReasons.push("NO_ACTIONABLE_VIOLATION");
      supportingEvidence.push("No platform policy violation or actionable rights claim identified");
      humanReadableReason = "Content does not demonstrate actionable platform policy or copyright violation.";
    }

    const allReasonCodes: ReasonCode[] = Array.from(
      new Set([...evidenceReasons, ...removalReasons, ...infrastructureReasons]),
    );

    return {
      removalClassification: classification,
      removalScore,
      evidenceReasons: Array.from(new Set(evidenceReasons)),
      removalReasons: Array.from(new Set(removalReasons)),
      infrastructureReasons: Array.from(new Set(infrastructureReasons)),
      allReasonCodes,
      supportingEvidence,
      evidenceStatus,
      evidenceConfidence,
      evidenceSources: Array.from(new Set(evidenceSources)),
      evidenceSourceCount: Array.from(new Set(evidenceSources)).length,
      meaningfulIndependentSourceCount,
      actionRecommendation,
      policySignals,
      humanReadableReason,
      analysisVersion,
    };
  } catch (err) {
    const errorMsg = (err as Error)?.message || String(err);
    console.error("[classifyRemovalEligibility] Exception during removal classification:", errorMsg);

    infrastructureReasons.push("CLASSIFIER_FAILURE");

    return {
      removalClassification: "ANALYSIS_FAILED",
      removalScore: 0,
      evidenceReasons: ["EVIDENCE_UNAVAILABLE"],
      removalReasons: [],
      infrastructureReasons: ["CLASSIFIER_FAILURE"],
      allReasonCodes: ["CLASSIFIER_FAILURE", "EVIDENCE_UNAVAILABLE"],
      supportingEvidence: [`Classification execution failed: ${errorMsg}`],
      evidenceStatus: "UNAVAILABLE",
      evidenceConfidence: 0,
      evidenceSources: ["NONE"],
      evidenceSourceCount: 0,
      meaningfulIndependentSourceCount: 0,
      actionRecommendation: "INSUFFICIENT_EVIDENCE",
      policySignals: {
        hasCopyrightMatch: false,
        hasImpersonation: false,
        hasManipulatedMedia: false,
        hasPrivacyViolation: false,
        hasHarassmentOrThreats: false,
        hasFactualAllegation: false,
        isOpinionOrCommentary: false,
        isOfficialOrSupportive: false,
      },
      humanReadableReason: `Classifier execution failure: ${errorMsg}`,
      analysisVersion,
    };
  }
}
