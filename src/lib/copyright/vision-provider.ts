/**
 * Provider-agnostic contract for Copyright Intelligence's AI vision
 * classification (YouTube Monitoring's per-video classifier, plus the
 * once-per-scan reference-frame analysis that seeds discovery queries).
 *
 * Business logic (youtube-monitor.functions.ts, decideVideoOutcome in
 * youtube-monitor.server.ts) consumes ONLY the normalized types below —
 * never a Gemini-specific or Lovable-gateway-specific response shape. This
 * is what lets the pipeline swap providers (or add a third one later)
 * without touching decideVideoOutcome, the keep/needs_review/drop routing,
 * or any test that exercises them.
 */

export interface YtVideo {
  videoId: string;
  videoUrl: string;
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string | null;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  durationSeconds: number | null;
  matchedQuery: string;
}

export type CopyrightUsage =
  | "none"
  | "poster_or_screenshot"
  | "trailer_footage"
  | "movie_footage"
  | "promotional_material"
  /** Classification never ran (provider unavailable/error) — distinct from
   * a confident "none". Must never be treated as safe/approved. */
  | "unknown";
export type Sentiment = "positive" | "neutral" | "negative";

export interface VideoIntel {
  contentCategory: string;
  copyrightUsage: CopyrightUsage;
  copyrightSignals: string[];
  sentiment: Sentiment;
  sentimentScore: number;
  summary: string;
  reputationRisk: string[];
}

/**
 * Three-way AI classification outcome — "unavailable" (no provider
 * configured) and "error" (the call was attempted but failed, including
 * after exhausting retries) are BOTH distinct from "classified": neither
 * may ever be treated as a confident "no relevant usage" result. This is
 * the exact contract decideVideoOutcome() (Stage A) was built against —
 * every provider implementation must return this shape unchanged.
 */
export type AiClassificationStatus = "classified" | "unavailable" | "error";

export interface AiClassificationOutcome {
  status: AiClassificationStatus;
  /** Present only when status === "classified". */
  intel: VideoIntel | null;
  /** Present only when status === "error". Never contains secret material. */
  errorMessage?: string;
}

export interface ReferenceAnalysisResult {
  title: string | null;
  altTitles: string[];
  language: string | null;
  audienceLanguages: string[];
  region: string | null;
  actors: string[];
  productionCompany: string | null;
  releaseDate: string | null;
  descriptors: string[];
  ocrText: string | null;
  watermark: string | null;
  visualFeatures: string[];
  mediaType: string | null;
}

export interface CopyrightVisionProvider {
  readonly name: string;
  /** Cheap, synchronous — an env-var/config check only, no I/O. */
  isConfigured(): boolean;
  /**
   * Always resolves to a usable result, degrading to a title-only fallback
   * on any failure — this only seeds search-query construction, it never
   * feeds decideVideoOutcome, so it has no discriminated failure status.
   */
  analyzeReference(referenceDataUrl: string, workTitle: string): Promise<ReferenceAnalysisResult>;
  analyzeYoutubeVideo(opts: {
    video: YtVideo;
    workTitle: string;
    referenceDataUrl: string;
  }): Promise<AiClassificationOutcome>;
}

/**
 * An explicit no-op provider: reports itself as unconfigured and returns
 * "unavailable" for every classification. This is what a Vercel deployment
 * with neither GEMINI_API_KEY nor LOVABLE_API_KEY gets — the SAME honest
 * "unavailable" outcome as either real provider reports when unconfigured,
 * never a silent success or a fabricated classification.
 */
export function createNullVisionProvider(): CopyrightVisionProvider {
  return {
    name: "none",
    isConfigured: () => false,
    async analyzeReference(_referenceDataUrl, workTitle) {
      return {
        title: workTitle,
        altTitles: [],
        language: null,
        audienceLanguages: [],
        region: null,
        actors: [],
        productionCompany: null,
        releaseDate: null,
        descriptors: [],
        ocrText: null,
        watermark: null,
        visualFeatures: [],
        mediaType: null,
      };
    },
    async analyzeYoutubeVideo() {
      return { status: "unavailable", intel: null };
    },
  };
}

export interface VisionProviderFactoryDeps {
  hasGeminiKey?: () => boolean;
  hasLovableKey?: () => boolean;
  createGemini?: () => CopyrightVisionProvider;
  createLovable?: () => CopyrightVisionProvider;
}

/**
 * Deterministic provider selection: Gemini first (a Vercel production
 * deployment can run entirely without LOVABLE_API_KEY once this is
 * configured), then Lovable (kept for compatibility — this is what makes
 * classification work today on Lovable's own managed runtime, which
 * auto-injects LOVABLE_API_KEY, with zero extra configuration), then an
 * explicit no-op provider. Selection never changes mid-request based on a
 * failure — a provider that starts a classification finishes it (as
 * "classified"/"error") rather than silently falling over to a different
 * provider, which would make the "error" vs "classified" split ambiguous.
 */
export async function getCopyrightVisionProvider(
  deps: VisionProviderFactoryDeps = {},
): Promise<CopyrightVisionProvider> {
  const hasGeminiKey = deps.hasGeminiKey ?? (() => !!process.env.GEMINI_API_KEY?.trim());
  const hasLovableKey = deps.hasLovableKey ?? (() => !!process.env.LOVABLE_API_KEY?.trim());

  if (hasGeminiKey()) {
    if (deps.createGemini) return deps.createGemini();
    const { createGeminiVisionProvider } = await import("./providers/gemini-vision-provider");
    return createGeminiVisionProvider();
  }
  if (hasLovableKey()) {
    if (deps.createLovable) return deps.createLovable();
    const { createLovableVisionProvider } = await import("./providers/lovable-vision-provider");
    return createLovableVisionProvider();
  }
  return createNullVisionProvider();
}
