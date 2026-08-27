/**
 * CopyrightVisionProvider backed by Lovable's AI Gateway — the original
 * implementation, unchanged in behavior, just moved behind the provider
 * interface. This is what makes classification work with zero extra
 * configuration on Lovable's own managed runtime (which auto-injects
 * LOVABLE_API_KEY); kept for compatibility everywhere else too.
 */
import type {
  AiClassificationOutcome,
  CopyrightUsage,
  CopyrightVisionProvider,
  ReferenceAnalysisResult,
  Sentiment,
  VideoIntel,
  YtVideo,
} from "../vision-provider";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

function gatewayHeaders(key: string) {
  return {
    "Content-Type": "application/json",
    "Lovable-API-Key": key,
    "X-Lovable-AIG-SDK": "vercel-ai-sdk",
  };
}

const USAGES: CopyrightUsage[] = [
  "none",
  "poster_or_screenshot",
  "trailer_footage",
  "movie_footage",
  "promotional_material",
];

const ANALYSIS_SYSTEM = `You analyse a rights-holder's reference frame (poster, artwork, still or video frame).
Identify the work as precisely as you can, using visible text, logos, cast faces and design language.
Return JSON:
{
  "title": string,              // the film/show/artwork it belongs to, "" if unsure
  "altTitles": string[],        // 0-6 alternate, translated or transliterated titles (native script welcome)
  "language": string,           // primary/original language, "" if unsure
  "audienceLanguages": string[],// 0-5 other languages dubbed/subbed audiences would search in
  "region": string,             // country or region of origin, "" if unsure
  "actors": string[],           // 0-6 recognisable actor names
  "productionCompany": string,  // studio / production house / distributor, "" if unsure
  "releaseDate": string,        // release date if visible or known, "" otherwise
  "descriptors": string[],      // 4-8 short search phrases describing this exact frame
  "ocrText": string,            // ALL visible text, verbatim ("" if none)
  "watermark": string,          // any burned-in watermark / studio / site brand ("" if none)
  "visualFeatures": string[],   // 3-6 notes: palette, composition, subjects, framing
  "mediaType": string           // poster | artwork | still | screenshot | trailer_frame | unknown
}
Respond with JSON only.`;

const CLASSIFY_SYSTEM = `You analyse a public YouTube video for a rights holder's copyright and reputation monitoring desk.
You receive the video metadata, the protected work's details, the REFERENCE frame of the protected work and the video THUMBNAIL.

Report strictly as JSON:
{
  "contentCategory": string,        // review | reaction | explainer | news | fan_edit | full_movie | clip | trailer_reupload | promo | unrelated
  "copyrightUsage": string,         // none | poster_or_screenshot | trailer_footage | movie_footage | promotional_material
  "copyrightSignals": string[],     // short evidence tags e.g. poster_in_thumbnail, scene_frame_used, logo_used, trailer_frames
  "sentiment": string,              // positive | neutral | negative
  "sentimentScore": number,         // -100 very negative .. 100 very positive
  "reputationRisk": string[],       // e.g. defamation_claim, spoiler_leak, boycott_call, abusive_language, false_claim
  "summary": string                 // one or two sentences of concrete evidence
}
Judge copyright usage from the visuals only; do not assume usage from the title alone.
If the thumbnail is unrelated to the reference work, copyrightUsage must be "none".`;

function fallbackReference(workTitle: string): ReferenceAnalysisResult {
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
}

export interface LovableProviderDeps {
  apiKey?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export function createLovableVisionProvider(
  deps: LovableProviderDeps = {},
): CopyrightVisionProvider {
  const key = deps.apiKey ?? (() => process.env.LOVABLE_API_KEY);
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    name: "lovable",
    isConfigured: () => !!key()?.trim(),

    async analyzeReference(referenceDataUrl, workTitle) {
      const apiKey = key();
      const fallback = fallbackReference(workTitle);
      if (!apiKey) return fallback;
      try {
        const res = await fetchImpl(GATEWAY_URL, {
          method: "POST",
          headers: gatewayHeaders(apiKey),
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: ANALYSIS_SYSTEM },
              {
                role: "user",
                content: [
                  { type: "text", text: `Owner-provided title: ${workTitle}. Respond JSON only.` },
                  { type: "image_url", image_url: { url: referenceDataUrl } },
                ],
              },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (!res.ok) return fallback;
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<
          string,
          unknown
        >;
        const list = (v: unknown, n: number) =>
          Array.isArray(v)
            ? v
                .map((d) => String(d).slice(0, 80))
                .filter(Boolean)
                .slice(0, n)
            : [];
        const str = (v: unknown, n: number) => (v ? String(v).slice(0, n) : null);
        return {
          title: str(parsed.title, 120) ?? workTitle,
          altTitles: list(parsed.altTitles, 6),
          language: str(parsed.language, 40),
          audienceLanguages: list(parsed.audienceLanguages, 5),
          region: str(parsed.region, 60),
          actors: list(parsed.actors, 6),
          productionCompany: str(parsed.productionCompany, 80),
          releaseDate: str(parsed.releaseDate, 40),
          descriptors: list(parsed.descriptors, 8),
          ocrText: str(parsed.ocrText, 1500),
          watermark: str(parsed.watermark, 200),
          visualFeatures: list(parsed.visualFeatures, 6),
          mediaType: str(parsed.mediaType, 40),
        };
      } catch {
        return fallback;
      }
    },

    async analyzeYoutubeVideo(opts: {
      video: YtVideo;
      workTitle: string;
      referenceDataUrl: string;
    }): Promise<AiClassificationOutcome> {
      const apiKey = key();
      if (!apiKey) return { status: "unavailable", intel: null };
      try {
        const content: unknown[] = [
          {
            type: "text",
            text:
              `Protected work: ${opts.workTitle}\n` +
              `Video title: ${opts.video.title}\n` +
              `Channel: ${opts.video.channelTitle ?? "unknown"}\n` +
              `Published: ${opts.video.publishedAt ?? "unknown"}\n` +
              `Views: ${opts.video.viewCount ?? "unknown"}\n` +
              `Description: ${opts.video.description.slice(0, 1200)}\n\n` +
              `First image = REFERENCE work. Second image = video THUMBNAIL.`,
          },
          { type: "image_url", image_url: { url: opts.referenceDataUrl } },
        ];
        if (opts.video.thumbnailUrl) {
          content.push({ type: "image_url", image_url: { url: opts.video.thumbnailUrl } });
        }

        const res = await fetchImpl(GATEWAY_URL, {
          method: "POST",
          headers: gatewayHeaders(apiKey),
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: CLASSIFY_SYSTEM },
              { role: "user", content },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (!res.ok) {
          const body = (await res.text().catch(() => "")).slice(0, 200);
          console.warn("[lovable-vision] gateway", res.status, body);
          return { status: "error", intel: null, errorMessage: `gateway ${res.status}: ${body}` };
        }
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const p = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<
          string,
          unknown
        >;
        const usage = String(p.copyrightUsage ?? "none") as CopyrightUsage;
        const sentiment = String(p.sentiment ?? "neutral");
        const score = Number(p.sentimentScore);
        const intel: VideoIntel = {
          contentCategory: String(p.contentCategory ?? "unrelated").slice(0, 40),
          copyrightUsage: USAGES.includes(usage) ? usage : "none",
          copyrightSignals: Array.isArray(p.copyrightSignals)
            ? p.copyrightSignals.map((s) => String(s).slice(0, 48)).slice(0, 10)
            : [],
          sentiment: (["positive", "neutral", "negative"].includes(sentiment)
            ? sentiment
            : "neutral") as Sentiment,
          sentimentScore: Number.isFinite(score)
            ? Math.max(-100, Math.min(100, Math.round(score)))
            : 0,
          summary: String(p.summary ?? "").slice(0, 500),
          reputationRisk: Array.isArray(p.reputationRisk)
            ? p.reputationRisk.map((s) => String(s).slice(0, 48)).slice(0, 8)
            : [],
        };
        return { status: "classified", intel };
      } catch (e) {
        const message = (e as Error).message;
        console.warn("[lovable-vision] analyze failed", message);
        return { status: "error", intel: null, errorMessage: message };
      }
    },
  };
}
