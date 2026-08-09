/**
 * Per-video analysis for the targeted YouTube removal scan.
 *
 * Connects to the canonical Subject Entity Verification Engine (entity-verifier.ts)
 * and Removal Eligibility Classifier (removal-classifier.ts).
 */

import { nameVariants } from "./queries";
import {
  buildSubjectIdentityProfile,
  verifySubjectEntity,
  normalizeSubjectVerificationStatus,
} from "@/lib/firecrawl/entity-verifier";
import { classifyRemovalEligibility } from "@/lib/firecrawl/removal-classifier";

export type SubjectStatus = "verified" | "not_subject" | "uncertain";
export type RemovalPotential = "high" | "medium" | "low" | "not_eligible";
export type RiskLevel = "critical" | "high" | "medium" | "low";

export const CONTENT_TYPES = [
  "FALSE_FACTUAL_ALLEGATION",
  "UNVERIFIED_ALLEGATION",
  "MISLEADING_CONTENT",
  "MANIPULATED_MEDIA",
  "DEEPFAKE_OR_SYNTHETIC_MEDIA",
  "IMPERSONATION",
  "PRIVACY_VIOLATION",
  "DOXXING_OR_PERSONAL_INFORMATION",
  "HARASSMENT_OR_TARGETED_ABUSE",
  "SEXUALIZED_OR_NON_CONSENSUAL_CONTENT",
  "COPYRIGHT_CANDIDATE",
  "MISLEADING_THUMBNAIL",
  "CLICKBAIT",
  "HOSTILE_COMMENTARY",
  "NEGATIVE_OPINION",
  "SATIRE_OR_PARODY",
  "LEGITIMATE_CRITICISM",
  "INSUFFICIENT_EVIDENCE",
] as const;

export interface EvidenceTimestamp {
  timestamp: string;
  seconds: number | null;
  excerpt: string;
  violationType: string;
}

export interface VideoAnalysis {
  subjectStatus: SubjectStatus;
  subjectConfidence: number;
  verificationReason: string;
  contentTypes: string[];
  riskLevel: RiskLevel;
  removalPotential: RemovalPotential;
  potentialViolation: string | null;
  problematicClaim: string | null;
  assessmentReason: string;
  recommendedAction: string;
  recommendedRoute: string | null;
  evidenceNeeded: string | null;
  evidenceTimestamps: EvidenceTimestamp[];
  evidenceVerified: boolean;
  transcriptState: string;
  transcriptLanguage: string | null;
  narratives: string[];
  modelError?: string;
}

export interface AnalyzeInput {
  targetName: string;
  aliases: string[];
  video: {
    videoId: string;
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
    durationSeconds: number | null;
    tags: string[];
    isUnavailable: boolean;
  };
}

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/**
 * Perform canonical target entity verification & removal eligibility analysis.
 */
export async function analyzeRemovalCandidate(input: AnalyzeInput): Promise<VideoAnalysis> {
  let transcriptText = "";
  let transcriptState = "captions_unavailable";
  let transcriptLanguage: string | null = null;
  let transcriptLines: Array<{ t: string; text: string; seconds: number }> = [];

  if (!input.video.isUnavailable) {
    try {
      const { fetchYoutubeCaptions } = await import("@/lib/mm/youtube-captions.server");
      const captions = await fetchYoutubeCaptions(input.video.videoId, ["en", "ml", "hi"]);
      if (captions.available && captions.segments?.length) {
        transcriptState = "captions_analysed";
        transcriptLanguage = captions.language ?? null;
        transcriptText = captions.segments.map((s) => s.text).join(" ");
        const variants = nameVariants(input.targetName, input.aliases).map((v) => v.toLowerCase());
        const mentions = captions.segments.filter((s) => {
          const text = s.text.toLowerCase();
          return variants.some((v) => text.includes(v));
        });
        const chosen = (mentions.length ? mentions : captions.segments.slice(0, 60)).slice(0, 90);
        transcriptLines = chosen.map((s) => ({
          t: formatTs(s.startSeconds),
          text: s.text.slice(0, 300),
          seconds: Math.floor(s.startSeconds),
        }));
        if (!mentions.length) transcriptState = "captions_no_mention";
      } else {
        transcriptState = captions.reason ? `captions_unavailable:${captions.reason}` : "captions_unavailable";
      }
    } catch (e) {
      transcriptState = "caption_error";
      console.error("[yt-removal] captions", input.video.videoId, e);
    }
  } else {
    transcriptState = "video_unavailable";
  }

  // 1. CANONICAL SUBJECT ENTITY VERIFICATION
  const profile = buildSubjectIdentityProfile(input.targetName, input.aliases);
  const ver = verifySubjectEntity(
    {
      title: input.video.title,
      description: input.video.description,
      snippet: input.video.description,
      author: input.video.channelTitle,
      channelTitle: input.video.channelTitle,
      transcript: transcriptText,
      url: `https://www.youtube.com/watch?v=${input.video.videoId}`,
    },
    profile,
  );

  const normStatus = normalizeSubjectVerificationStatus(ver.subjectMatchStatus);

  // Runtime Diagnostic Logging for Live Candidates
  console.info("[YT-LIVE-VERIFY]", {
    videoId: input.video.videoId,
    title: input.video.title,
    channel: input.video.channelTitle,
    target: input.targetName,
    status: normStatus,
    score: ver.subjectMatchScore,
    matchedSignals: ver.matchedTargetSignals,
    failedSignals: ver.failedTargetSignals,
  });

  // 2. CANONICAL REMOVAL ELIGIBILITY CLASSIFICATION
  const removalRes = classifyRemovalEligibility({
    title: input.video.title,
    snippet: input.video.description,
    description: input.video.description,
    author: input.video.channelTitle,
    url: `https://www.youtube.com/watch?v=${input.video.videoId}`,
    transcript: transcriptText,
    hasTranscript: Boolean(transcriptText),
    subjectVerificationStatus: normStatus,
    verificationScore: ver.subjectMatchScore,
  });

  const isVerified = normStatus === "VERIFIED_SUBJECT" || normStatus === "PROBABLE_SUBJECT";
  const mappedSubjectStatus: SubjectStatus =
    normStatus === "NOT_SUBJECT" ? "not_subject" : isVerified ? "verified" : "uncertain";

  const mappedRemovalPotential: RemovalPotential =
    removalRes.removalClassification === "HIGH_REMOVAL"
      ? "high"
      : removalRes.removalClassification === "MEDIUM_REMOVAL"
      ? "medium"
      : removalRes.removalClassification === "LOW_REMOVAL"
      ? "low"
      : "not_eligible";

  const mappedRiskLevel: RiskLevel =
    removalRes.removalScore >= 80
      ? "critical"
      : removalRes.removalScore >= 50
      ? "high"
      : removalRes.removalScore >= 20
      ? "medium"
      : "low";

  const verificationReason =
    (ver.matchedTargetSignals && ver.matchedTargetSignals.length > 0
      ? `Matched: ${ver.matchedTargetSignals.join(", ")}`
      : ver.failedTargetSignals && ver.failedTargetSignals.length > 0
      ? `Failed: ${ver.failedTargetSignals.join(", ")}`
      : "Canonical entity verification");

  const assessmentReason =
    (removalRes.allReasonCodes && removalRes.allReasonCodes.length > 0
      ? removalRes.allReasonCodes.join(", ")
      : "Canonical evidence analysis");

  return {
    subjectStatus: mappedSubjectStatus,
    subjectConfidence: ver.subjectMatchScore,
    verificationReason,
    contentTypes: (removalRes.evidenceReasons && removalRes.evidenceReasons.length > 0)
      ? removalRes.evidenceReasons
      : ["INSUFFICIENT_EVIDENCE"],
    riskLevel: mappedRiskLevel,
    removalPotential: mappedRemovalPotential,
    potentialViolation: removalRes.removalClassification !== "NOT_ELIGIBLE" ? removalRes.actionRecommendation : null,
    problematicClaim: null,
    assessmentReason,
    recommendedAction: removalRes.actionRecommendation,
    recommendedRoute: removalRes.actionRecommendation ? removalRes.actionRecommendation.toLowerCase() : "monitor_only",
    evidenceNeeded: transcriptText ? null : "Full transcript analysis",
    evidenceTimestamps: [],
    evidenceVerified: Boolean(transcriptText),
    transcriptState,
    transcriptLanguage,
    narratives: [],
  };
}

/** Explainable priority score (0-100). */
export function priorityScore(args: {
  analysis: VideoAnalysis;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  publishedAt: string | null;
  discoveryQueryCount: number;
}): number {
  const { analysis } = args;
  const severity = { critical: 32, high: 26, medium: 16, low: 8 }[analysis.riskLevel];
  const removal = { high: 30, medium: 18, low: 6, not_eligible: 0 }[analysis.removalPotential];
  const confidence = Math.round((analysis.subjectConfidence / 100) * 10);
  const evidence = analysis.evidenceVerified ? 8 : 0;

  const views = args.viewCount ?? 0;
  const reach = views <= 0 ? 0 : Math.min(10, Math.round(Math.log10(views + 1) * 1.6));
  const engagement = Math.min(
    5,
    Math.round(Math.log10((args.likeCount ?? 0) + (args.commentCount ?? 0) + 1) * 1.4),
  );

  let recency = 0;
  if (args.publishedAt) {
    const days = (Date.now() - new Date(args.publishedAt).getTime()) / 86_400_000;
    recency = days <= 7 ? 5 : days <= 30 ? 4 : days <= 180 ? 2 : 1;
  }
  const visibility = Math.min(5, args.discoveryQueryCount);

  return Math.max(
    0,
    Math.min(100, severity + removal + confidence + evidence + reach + engagement + recency + visibility),
  );
}
