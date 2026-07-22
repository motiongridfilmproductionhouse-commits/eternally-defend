/**
 * Caption and spoken-content analysis for Channel Watch.
 * Uses real YouTube caption timestamps and the existing classifier.
 */

export interface ChannelCaptionFinding {
  startSeconds: number;
  endSeconds: number;
  text: string;
  translatedText: string | null;
  matchedEntity: string | null;
  claimSummary: string | null;
  contextType: string;
  speakerStance: string;
  riskCategory: string;
  severity: string;
  confidence: number;
  watchUrl: string;
}

export interface ChannelCaptionResult {
  state: "captions_analysed" | "partial_captions" | "captions_unavailable" | "caption_error";
  language: string | null;
  source: string | null;
  segmentCount: number;
  mentionCount: number;
  maxRisk: number;
  findings: ChannelCaptionFinding[];
  reason?: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function severityRisk(severity: string): number {
  switch (severity.toLowerCase()) {
    case "critical": return 95;
    case "high": return 80;
    case "medium": return 60;
    case "low": return 35;
    default: return 0;
  }
}

export async function analyzeChannelWatchCaptions(
  videoId: string,
  aliases: string[],
): Promise<ChannelCaptionResult> {
  try {
    const { fetchYoutubeCaptions } = await import(
      "@/lib/mm/youtube-captions.server"
    );

    const captions = await fetchYoutubeCaptions(videoId);

    if (!captions.available || !captions.segments?.length) {
      return {
        state: "captions_unavailable",
        language: captions.language ?? null,
        source: captions.source ?? null,
        segmentCount: 0,
        mentionCount: 0,
        maxRisk: 0,
        findings: [],
        reason: captions.reason ?? "No usable caption track",
      };
    }

    const segments = [...captions.segments].sort(
      (a, b) => a.startSeconds - b.startSeconds,
    );

    const normalizedAliases = aliases
      .map(normalize)
      .filter((alias) => alias.length >= 2);

    const mentionCount = segments.reduce((count, segment) => {
      const text = normalize(segment.text);
      return count + normalizedAliases.filter((alias) =>
        text.includes(alias)
      ).length;
    }, 0);

    const { classifyTranscriptSegments } = await import(
      "@/lib/mm/video-classify.server"
    );

    const classified = await classifyTranscriptSegments(
      segments.map((segment, index) => ({ ...segment, index })),
      aliases,
      captions.language,
    );

    const findings: ChannelCaptionFinding[] = classified.findings
      .map((finding) => {
        const segment = segments[finding.segmentIndex];
        if (!segment) return null;

        const startSeconds = segment.startSeconds ?? 0;
        const endSeconds = segment.endSeconds ?? startSeconds;

        return {
          startSeconds,
          endSeconds,
          text: segment.text.slice(0, 2000),
          translatedText: finding.translatedText ?? null,
          matchedEntity: finding.matchedEntity || null,
          claimSummary: finding.claimSummary || null,
          contextType: finding.contextType,
          speakerStance: finding.speakerStance,
          riskCategory: finding.riskCategory,
          severity: finding.severity,
          confidence: finding.confidence,
          watchUrl:
            `https://www.youtube.com/watch?v=${videoId}` +
            `&t=${Math.floor(startSeconds)}s`,
        };
      })
      .filter((finding): finding is ChannelCaptionFinding => finding !== null)
      .slice(0, 50);

    const maxRisk = findings.reduce(
      (maximum, finding) =>
        Math.max(maximum, severityRisk(finding.severity)),
      0,
    );

    return {
      state: segments.length > 20
        ? "captions_analysed"
        : "partial_captions",
      language: captions.language ?? null,
      source: captions.source ?? "youtube_caption",
      segmentCount: segments.length,
      mentionCount,
      maxRisk,
      findings,
    };
  } catch (error) {
    return {
      state: "caption_error",
      language: null,
      source: null,
      segmentCount: 0,
      mentionCount: 0,
      maxRisk: 0,
      findings: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
