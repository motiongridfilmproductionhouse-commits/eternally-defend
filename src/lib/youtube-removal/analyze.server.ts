/**
 * Per-video analysis for the targeted YouTube removal scan.
 *
 * Two stages, both grounded in real fetched data:
 *  1. Target verification — is this video actually about the protected person?
 *  2. Content classification + takedown-eligibility assessment.
 *
 * Hard rules enforced in the prompt and in post-processing:
 *  - Never fabricate transcripts, timestamps, violations or evidence.
 *  - Never claim guaranteed removal.
 *  - A sensational title alone can never yield HIGH removal potential; that
 *    requires verified spoken/visual evidence (transcript) or an explicit
 *    privacy/impersonation/synthetic-media/copyright signal.
 */

import { nameVariants } from "./queries";

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

const SYSTEM = `You are Eterna, a cautious reputation-intelligence and platform-enforcement analyst.

You assess whether a YouTube video about a protected person contains potentially actionable material.

ABSOLUTE RULES:
- Never invent a transcript, timestamp, quote, statistic, URL or policy violation. Only use the data supplied.
- If no transcript is supplied, you may still classify the video from its real title/description, but evidenceVerified MUST be false and removalPotential MUST NOT be "high" unless the title/description themselves explicitly disclose a privacy leak, impersonation, sexualised/non-consensual material, deepfake/synthetic media, or unauthorised full-content reupload.
- Criticism, reaction, roast, satire, commentary, opinion and legitimate reporting are NOT defamation and are usually "low" or "not_eligible".
- Never state or imply that removal is guaranteed.
- Do NOT claim a statement is false unless supplied evidence supports it; prefer UNVERIFIED_ALLEGATION.
- If the video is about a different person/movie/song/business/character with a similar name, set subjectStatus "not_subject".

CONTENT TYPES (choose 1-3 exact values): FALSE_FACTUAL_ALLEGATION, UNVERIFIED_ALLEGATION, MISLEADING_CONTENT, MANIPULATED_MEDIA, DEEPFAKE_OR_SYNTHETIC_MEDIA, IMPERSONATION, PRIVACY_VIOLATION, DOXXING_OR_PERSONAL_INFORMATION, HARASSMENT_OR_TARGETED_ABUSE, SEXUALIZED_OR_NON_CONSENSUAL_CONTENT, COPYRIGHT_CANDIDATE, MISLEADING_THUMBNAIL, CLICKBAIT, HOSTILE_COMMENTARY, NEGATIVE_OPINION, SATIRE_OR_PARODY, LEGITIMATE_CRITICISM, INSUFFICIENT_EVIDENCE.

REMOVAL POTENTIAL:
- "high": clear evidence of a potentially actionable policy, privacy, copyright, impersonation, manipulated-media or legal violation.
- "medium": a potential violation exists but more evidence, ownership proof, context or legal review is required.
- "low": mainly opinion, criticism, reaction, satire, reporting or commentary with no identifiable violation.
- "not_eligible": no reasonable removal or reporting basis.

recommendedRoute must be one of: platform_report, privacy_complaint, copyright_notice, impersonation_report, manipulated_media_report, legal_review, monitor_only.

Return JSON only.`;

interface GatewayResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function fallback(reason: string, transcriptState: string): VideoAnalysis {
  return {
    subjectStatus: "uncertain",
    subjectConfidence: 0,
    verificationReason: "Automated verification unavailable — manual review required",
    contentTypes: ["INSUFFICIENT_EVIDENCE"],
    riskLevel: "low",
    removalPotential: "not_eligible",
    potentialViolation: null,
    problematicClaim: null,
    assessmentReason: `EVIDENCE_NOT_VERIFIED — ${reason}`,
    recommendedAction: "MONITOR / REVIEW",
    recommendedRoute: "monitor_only",
    evidenceNeeded: "Human review of the video content",
    evidenceTimestamps: [],
    evidenceVerified: false,
    transcriptState,
    transcriptLanguage: null,
    narratives: [],
    modelError: reason,
  };
}

function toSeconds(ts: string): number | null {
  const m = ts.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return +(m[1] ?? 0) * 3600 + +m[2]! * 60 + +m[3]!;
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
 * Fetch captions (best effort) and analyse a single video.
 */
export async function analyzeRemovalCandidate(input: AnalyzeInput): Promise<VideoAnalysis> {
  const key = process.env["LOVABLE_API_KEY"];

  // --- transcript (real captions only; never synthesised) -----------------
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

  if (!key) return fallback("LOVABLE_API_KEY missing", transcriptState);

  const payload = {
    protectedPerson: input.targetName,
    knownAliases: input.aliases,
    video: {
      videoId: input.video.videoId,
      url: `https://www.youtube.com/watch?v=${input.video.videoId}`,
      title: input.video.title,
      channel: input.video.channelTitle,
      publishedAt: input.video.publishedAt,
      description: input.video.description.slice(0, 3000),
      tags: input.video.tags,
      views: input.video.viewCount,
      likes: input.video.likeCount,
      comments: input.video.commentCount,
      durationSeconds: input.video.durationSeconds,
      availability: input.video.isUnavailable ? "unavailable" : "available",
    },
    transcript: {
      state: transcriptState,
      language: transcriptLanguage,
      lines: transcriptLines,
    },
  };

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content:
              `Assess this video. Return JSON exactly as:\n` +
              `{ "subjectStatus": "verified|not_subject|uncertain", "subjectConfidence": 0-100, "verificationReason": string, ` +
              `"contentTypes": string[], "riskLevel": "critical|high|medium|low", "removalPotential": "high|medium|low|not_eligible", ` +
              `"potentialViolation": string|null, "problematicClaim": string|null, "assessmentReason": string, ` +
              `"recommendedAction": string, "recommendedRoute": string, "evidenceNeeded": string|null, ` +
              `"evidenceTimestamps": [{"timestamp": "mm:ss", "excerpt": string, "violationType": string}], ` +
              `"narratives": string[] }\n` +
              `Only include evidenceTimestamps that exist verbatim in the supplied transcript lines. ` +
              `narratives = short recurring allegation keywords useful for further searching.\n\n` +
              JSON.stringify(payload),
          },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fallback(`ai_gateway_${res.status}: ${body.slice(0, 140)}`, transcriptState);
    }
    const j = (await res.json()) as GatewayResponse;
    const content = j.choices?.[0]?.message?.content ?? "{}";
    const raw = JSON.parse(content) as Record<string, unknown>;

    const validLines = new Map(transcriptLines.map((l) => [l.t, l]));
    const evidenceTimestamps: EvidenceTimestamp[] = Array.isArray(raw.evidenceTimestamps)
      ? (raw.evidenceTimestamps as Array<Record<string, unknown>>)
          .map((e) => {
            const timestamp = String(e.timestamp ?? "").trim();
            const line = validLines.get(timestamp);
            return {
              timestamp,
              seconds: line ? line.seconds : toSeconds(timestamp),
              excerpt: String(e.excerpt ?? "").slice(0, 400),
              violationType: String(e.violationType ?? "unspecified").slice(0, 80),
            };
          })
          // Drop hallucinated timestamps: must map to a real caption line.
          .filter((e) => validLines.has(e.timestamp))
          .slice(0, 8)
      : [];

    const contentTypes = (Array.isArray(raw.contentTypes) ? raw.contentTypes : [])
      .map((t) => String(t).toUpperCase())
      .filter((t) => (CONTENT_TYPES as readonly string[]).includes(t))
      .slice(0, 4);

    let removalPotential = String(raw.removalPotential ?? "not_eligible").toLowerCase() as RemovalPotential;
    if (!["high", "medium", "low", "not_eligible"].includes(removalPotential)) {
      removalPotential = "not_eligible";
    }

    const evidenceVerified = evidenceTimestamps.length > 0 && transcriptState === "captions_analysed";

    // Guardrail: no transcript evidence -> cap HIGH unless the metadata itself
    // discloses a hard-signal category.
    const hardSignals = [
      "PRIVACY_VIOLATION",
      "DOXXING_OR_PERSONAL_INFORMATION",
      "IMPERSONATION",
      "SEXUALIZED_OR_NON_CONSENSUAL_CONTENT",
      "DEEPFAKE_OR_SYNTHETIC_MEDIA",
      "MANIPULATED_MEDIA",
      "COPYRIGHT_CANDIDATE",
    ];
    if (
      removalPotential === "high" &&
      !evidenceVerified &&
      !contentTypes.some((t) => hardSignals.includes(t))
    ) {
      removalPotential = "medium";
    }

    const subjectStatusRaw = String(raw.subjectStatus ?? "uncertain").toLowerCase();
    const subjectStatus: SubjectStatus =
      subjectStatusRaw === "verified" || subjectStatusRaw === "not_subject"
        ? (subjectStatusRaw as SubjectStatus)
        : "uncertain";

    let riskLevel = String(raw.riskLevel ?? "low").toLowerCase() as RiskLevel;
    if (!["critical", "high", "medium", "low"].includes(riskLevel)) riskLevel = "low";

    return {
      subjectStatus,
      subjectConfidence: Math.max(0, Math.min(100, Number(raw.subjectConfidence ?? 0) || 0)),
      verificationReason: String(raw.verificationReason ?? "").slice(0, 600),
      contentTypes: contentTypes.length ? contentTypes : ["INSUFFICIENT_EVIDENCE"],
      riskLevel,
      removalPotential,
      potentialViolation: raw.potentialViolation ? String(raw.potentialViolation).slice(0, 300) : null,
      problematicClaim: raw.problematicClaim ? String(raw.problematicClaim).slice(0, 700) : null,
      assessmentReason:
        String(raw.assessmentReason ?? "").slice(0, 900) +
        (evidenceVerified ? "" : " (EVIDENCE_NOT_VERIFIED — no verifiable transcript excerpt)"),
      recommendedAction: String(
        raw.recommendedAction ??
          (removalPotential === "high" || removalPotential === "medium"
            ? "Prepare enforcement package"
            : "MONITOR / REVIEW"),
      ).slice(0, 300),
      recommendedRoute: raw.recommendedRoute ? String(raw.recommendedRoute).slice(0, 60) : "monitor_only",
      evidenceNeeded: raw.evidenceNeeded ? String(raw.evidenceNeeded).slice(0, 500) : null,
      evidenceTimestamps,
      evidenceVerified,
      transcriptState,
      transcriptLanguage,
      narratives: Array.isArray(raw.narratives)
        ? (raw.narratives as unknown[]).map((n) => String(n).slice(0, 60)).slice(0, 6)
        : [],
    };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : "analysis_failed", transcriptState);
  }
}

/** Explainable priority score (0-100). Reach never alone drives removability. */
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
