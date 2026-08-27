/**
 * CopyrightVisionProvider backed by Google's Gemini API directly — lets
 * Vercel production run AI classification without any Lovable-managed
 * credential (GEMINI_API_KEY is a dedicated, server-side-only, user-owned
 * credential — never the YouTube/Google API key used elsewhere).
 *
 * Unlike Lovable's gateway (which accepts a remote image_url and fetches it
 * itself), Gemini's generateContent endpoint needs inline base64 image
 * bytes. The YouTube thumbnail is therefore fetched here, server-side,
 * with defense-in-depth safety: an allowlist of known YouTube/Google CDN
 * hosts (never arbitrary/user-influenced URLs), HTTPS only, a bounded
 * fetch timeout, MIME-type validation, and a hard maximum size — a
 * malformed or oversized response is treated as a handled classification
 * failure, never an unhandled exception or an SSRF vector.
 *
 * Uses Gemini's structured JSON output (responseSchema) instead of
 * free-form JSON-in-prompt, and retries only genuinely transient failures
 * (HTTP 429/5xx, network-level exceptions) with a small, bounded backoff —
 * 400/401/403 and any other non-retryable status fail immediately.
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

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // YouTube thumbnails are typically well under 300KB; generous but bounded.
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
const CLASSIFY_TIMEOUT_MS = 20_000;
const REFERENCE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 300;

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Defense in depth: thumbnailUrl always originates from the YouTube Data
// API response (discoverYoutubeVideos), never end-user input, but this
// provider fetches it server-side, so it gets its own allowlist rather
// than trusting the caller. Never fetch a URL outside this set.
const ALLOWED_THUMBNAIL_HOSTS = new Set([
  "i.ytimg.com",
  "i9.ytimg.com",
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
]);

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
  "title": string,
  "altTitles": string[],
  "language": string,
  "audienceLanguages": string[],
  "region": string,
  "actors": string[],
  "productionCompany": string,
  "releaseDate": string,
  "descriptors": string[],
  "ocrText": string,
  "watermark": string,
  "visualFeatures": string[],
  "mediaType": string
}
Respond with JSON only.`;

const CLASSIFY_SYSTEM = `You analyse a public YouTube video for a rights holder's copyright and reputation monitoring desk.
You receive the video metadata, the protected work's details, the REFERENCE frame of the protected work and the video THUMBNAIL.
Judge copyright usage from the visuals only; do not assume usage from the title alone.
If the thumbnail is unrelated to the reference work, copyrightUsage must be "none".`;

const VIDEO_INTEL_SCHEMA = {
  type: "OBJECT",
  properties: {
    contentCategory: { type: "STRING" },
    copyrightUsage: {
      type: "STRING",
      enum: [
        "none",
        "poster_or_screenshot",
        "trailer_footage",
        "movie_footage",
        "promotional_material",
      ],
    },
    copyrightSignals: { type: "ARRAY", items: { type: "STRING" } },
    sentiment: { type: "STRING", enum: ["positive", "neutral", "negative"] },
    sentimentScore: { type: "NUMBER" },
    reputationRisk: { type: "ARRAY", items: { type: "STRING" } },
    summary: { type: "STRING" },
  },
  required: ["contentCategory", "copyrightUsage", "sentiment", "sentimentScore", "summary"],
};

const REFERENCE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    altTitles: { type: "ARRAY", items: { type: "STRING" } },
    language: { type: "STRING" },
    audienceLanguages: { type: "ARRAY", items: { type: "STRING" } },
    region: { type: "STRING" },
    actors: { type: "ARRAY", items: { type: "STRING" } },
    productionCompany: { type: "STRING" },
    releaseDate: { type: "STRING" },
    descriptors: { type: "ARRAY", items: { type: "STRING" } },
    ocrText: { type: "STRING" },
    watermark: { type: "STRING" },
    visualFeatures: { type: "ARRAY", items: { type: "STRING" } },
    mediaType: { type: "STRING" },
  },
};

interface InlineImage {
  mimeType: string;
  data: string;
}

function isAllowedThumbnailUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_THUMBNAIL_HOSTS.has(url.hostname);
}

function parseDataUrl(dataUrl: string): InlineImage | null {
  const m = /^data:([\w/+.-]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

type ImageFetchResult = { ok: true; image: InlineImage } | { ok: false; reason: string };

async function fetchThumbnailAsInlineData(
  url: string,
  fetchImpl: typeof fetch,
): Promise<ImageFetchResult> {
  if (!isAllowedThumbnailUrl(url)) {
    return { ok: false, reason: "thumbnail host is not on the allowed list" };
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  } catch (e) {
    return { ok: false, reason: `thumbnail fetch failed: ${(e as Error).message}` };
  }
  if (!res.ok) return { ok: false, reason: `thumbnail fetch HTTP ${res.status}` };

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
    return { ok: false, reason: `unsupported thumbnail content-type: ${contentType || "unknown"}` };
  }
  const declaredLength = Number(res.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "thumbnail exceeds maximum accepted size" };
  }

  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch (e) {
    return { ok: false, reason: `thumbnail body read failed: ${(e as Error).message}` };
  }
  if (buf.byteLength === 0) return { ok: false, reason: "empty thumbnail response" };
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "thumbnail exceeds maximum accepted size" };
  }

  return { ok: true, image: { mimeType: contentType, data: Buffer.from(buf).toString("base64") } };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

type FetchAttemptResult = { ok: true; json: unknown } | { ok: false; reason: string };

async function callGeminiWithRetry(
  fetchImpl: typeof fetch,
  sleepImpl: (ms: number) => Promise<void>,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  maxRetries: number,
  baseDelayMs: number,
): Promise<FetchAttemptResult> {
  let lastReason = "unknown error";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchImpl(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        return { ok: true, json: await res.json() };
      }
      const text = await res.text().catch(() => "");
      lastReason = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      if (!isRetryableStatus(res.status) || attempt === maxRetries) {
        return { ok: false, reason: lastReason };
      }
    } catch (e) {
      // Network-level failure (including AbortSignal timeout) — retryable,
      // since it's indistinguishable from a transient outage.
      lastReason = (e as Error).message;
      if (attempt === maxRetries) return { ok: false, reason: lastReason };
    }
    await sleepImpl(baseDelayMs * 2 ** attempt);
  }
  return { ok: false, reason: lastReason };
}

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

function extractGeminiText(json: unknown): string | null {
  const candidates = (
    json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  )?.candidates;
  return candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

export interface GeminiProviderDeps {
  apiKey?: () => string | undefined;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseDelayMs?: number;
}

export function createGeminiVisionProvider(deps: GeminiProviderDeps = {}): CopyrightVisionProvider {
  const getKey = deps.apiKey ?? (() => process.env.GEMINI_API_KEY);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleepImpl = deps.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  return {
    name: "gemini",
    isConfigured: () => !!getKey()?.trim(),

    async analyzeReference(referenceDataUrl, workTitle) {
      const apiKey = getKey();
      const fallback = fallbackReference(workTitle);
      if (!apiKey) return fallback;

      const refImage = parseDataUrl(referenceDataUrl);
      if (!refImage) return fallback;

      const body = {
        systemInstruction: { parts: [{ text: ANALYSIS_SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              { text: `Owner-provided title: ${workTitle}. Respond JSON only.` },
              { inlineData: { mimeType: refImage.mimeType, data: refImage.data } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: REFERENCE_SCHEMA,
        },
      };

      const attempt = await callGeminiWithRetry(
        fetchImpl,
        sleepImpl,
        apiKey,
        body,
        REFERENCE_TIMEOUT_MS,
        maxRetries,
        baseDelayMs,
      );
      if (!attempt.ok) return fallback;

      try {
        const text = extractGeminiText(attempt.json);
        const parsed = JSON.parse(text ?? "{}") as Record<string, unknown>;
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
      const apiKey = getKey();
      if (!apiKey) return { status: "unavailable", intel: null };

      const refImage = parseDataUrl(opts.referenceDataUrl);
      if (!refImage) {
        return {
          status: "error",
          intel: null,
          errorMessage: "reference image was not a valid data URL",
        };
      }

      const parts: unknown[] = [
        {
          text:
            `Protected work: ${opts.workTitle}\n` +
            `Video title: ${opts.video.title}\n` +
            `Channel: ${opts.video.channelTitle ?? "unknown"}\n` +
            `Published: ${opts.video.publishedAt ?? "unknown"}\n` +
            `Views: ${opts.video.viewCount ?? "unknown"}\n` +
            `Description: ${opts.video.description.slice(0, 1200)}\n\n` +
            `First image = REFERENCE work. Second image (if present) = video THUMBNAIL.`,
        },
        { inlineData: { mimeType: refImage.mimeType, data: refImage.data } },
      ];

      if (opts.video.thumbnailUrl) {
        const thumb = await fetchThumbnailAsInlineData(opts.video.thumbnailUrl, fetchImpl);
        if (!thumb.ok) {
          // The whole point of this classifier is comparing reference vs.
          // thumbnail — without a usable thumbnail there is nothing to
          // classify. This is a handled failure, never an unhandled
          // exception or a fabricated "no usage found".
          return { status: "error", intel: null, errorMessage: thumb.reason };
        }
        parts.push({ inlineData: { mimeType: thumb.image.mimeType, data: thumb.image.data } });
      }

      const body = {
        systemInstruction: { parts: [{ text: CLASSIFY_SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: VIDEO_INTEL_SCHEMA,
        },
      };

      const attempt = await callGeminiWithRetry(
        fetchImpl,
        sleepImpl,
        apiKey,
        body,
        CLASSIFY_TIMEOUT_MS,
        maxRetries,
        baseDelayMs,
      );
      if (!attempt.ok) {
        console.warn("[gemini-vision] classify failed", attempt.reason);
        return { status: "error", intel: null, errorMessage: attempt.reason };
      }

      let p: Record<string, unknown>;
      try {
        const text = extractGeminiText(attempt.json);
        if (!text) throw new Error("no text in Gemini response");
        p = JSON.parse(text) as Record<string, unknown>;
      } catch (e) {
        const message = `malformed classification response: ${(e as Error).message}`;
        console.warn("[gemini-vision]", message);
        return { status: "error", intel: null, errorMessage: message };
      }

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
    },
  };
}
