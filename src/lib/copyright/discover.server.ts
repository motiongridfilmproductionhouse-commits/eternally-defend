/**
 * Reference analysis + reverse-discovery for the Copyright Intelligence engine.
 *
 * No SerpApi / Google Lens. The reference frame is analysed with AI vision
 * (title, alternative titles, language, cast, studio, release date, OCR text,
 * watermarks, visual descriptors), and those signals drive a multilingual
 * Firecrawl web + image search that hunts streaming sites, file lockers,
 * piracy indexes, forums, social platforms and video hosts.
 */

import { firecrawlFetch, isFirecrawlConfigured } from "@/lib/firecrawl-client.server";
import {
  canonicalUrl,
  hostOf,
  isExcludedHost,
  isSuspiciousType,
  websiteTypeFor,
  type DiscoveryCandidate,
} from "./url.server";

export interface ReferenceAnalysis {
  title: string | null;
  /** alternate / translated / transliterated titles */
  altTitles: string[];
  /** original language of the work, e.g. Malayalam */
  language: string | null;
  /** additional audience languages likely to carry pirated copies */
  audienceLanguages: string[];
  /** country / region of origin */
  region: string | null;
  actors: string[];
  productionCompany: string | null;
  /** ISO-ish release date string when visible, else null */
  releaseDate: string | null;
  /** short search phrases describing the exact frame */
  descriptors: string[];
  /** visible on-screen / printed text */
  ocrText: string | null;
  /** studio, distributor or site watermark burned into the frame */
  watermark: string | null;
  /** visual fingerprint notes (palette, composition, subjects) */
  visualFeatures: string[];
  mediaType: string | null;
}

interface GatewayResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function getAiGatewayHeaders(key: string) {
  return {
    "Content-Type": "application/json",
    "Lovable-API-Key": key,
    "X-Lovable-AIG-SDK": "vercel-ai-sdk",
  };
}

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

/** AI-vision analysis of the reference frame. */
export async function analyzeReference(
  referenceDataUrl: string,
  workTitle: string,
): Promise<ReferenceAnalysis> {
  const key = process.env.LOVABLE_API_KEY;
  const fallback: ReferenceAnalysis = {
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
  if (!key) return fallback;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: getAiGatewayHeaders(key),
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
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
    const json = (await res.json()) as GatewayResponse;
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
}

interface FcImage {
  url?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  sourceUrl?: string;
}
interface FcWeb {
  url?: string;
  title?: string;
  description?: string;
}
interface FcResponse {
  data?: { web?: FcWeb[]; images?: FcImage[] };
  error?: string;
}

export type CopyrightProviderId =
  "firecrawl_direct" | "lovable_gateway" | "brave_fallback" | "serpapi_fallback";

export type ProviderFailureCategory =
  | "success"
  | "no_results"
  | "provider_not_configured"
  | "provider_authentication_failed"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable";

export interface ProviderAttemptLog {
  scanId?: string;
  provider: CopyrightProviderId;
  queryIndex: number;
  query: string;
  configuredStatus: "configured" | "not_configured";
  attemptNumber: number;
  httpStatus: number | null;
  normalizedFailureCategory: ProviderFailureCategory;
  durationMs: number;
  fallbackAttempted: boolean;
  successStatus: boolean;
  hitCount: number;
}

export interface CopyrightDiscoveryDiagnostics {
  providerSummaries: Record<
    CopyrightProviderId,
    {
      configured: boolean;
      attempts: number;
      successes: number;
      failureCategory?: ProviderFailureCategory;
      lastErrorStatus?: number;
    }
  >;
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  fallbackUsed: boolean;
  adminSummary: string;
  userMessage: string;
}

export const USER_DISCOVERY_UNAVAILABLE_MESSAGE =
  "Public-web discovery is temporarily unavailable. Please retry shortly.";

export class CopyrightDiscoveryError extends Error {
  public readonly adminSummary: string;
  public readonly userMessage: string;
  public readonly diagnostics: CopyrightDiscoveryDiagnostics;

  constructor(
    adminSummary: string,
    userMessage: string,
    diagnostics: CopyrightDiscoveryDiagnostics,
  ) {
    super(userMessage);
    this.name = "CopyrightDiscoveryError";
    this.adminSummary = adminSummary;
    this.userMessage = userMessage;
    this.diagnostics = diagnostics;
  }
}

export function getCopyrightDiscoveryProviders(): CopyrightProviderId[] {
  const providers: CopyrightProviderId[] = [];
  const fcKey = process.env.FIRECRAWL_API_KEY?.trim();
  const lovKey = process.env.LOVABLE_API_KEY?.trim();
  const braveKey = process.env.BRAVE_API_KEY?.trim();
  const serpKey = process.env.SERPAPI_API_KEY?.trim();

  // 1. Direct Firecrawl API key (fc-...) or explicit API key
  if (fcKey && !fcKey.startsWith("lovc_")) {
    providers.push("firecrawl_direct");
  }

  // Optional: Lovable Gateway if LOVABLE_API_KEY is explicitly configured
  if (lovKey && (fcKey?.startsWith("lovc_") || !fcKey)) {
    providers.push("lovable_gateway");
  } else if (lovKey && fcKey) {
    if (!providers.includes("lovable_gateway")) providers.push("lovable_gateway");
  }

  // 2. Brave Search API fallback
  if (braveKey) {
    providers.push("brave_fallback");
  }

  // 3. SerpAPI fallback
  if (serpKey) {
    providers.push("serpapi_fallback");
  }

  return providers;
}

export function isCopyrightDiscoveryConfigured(): boolean {
  return getCopyrightDiscoveryProviders().length > 0;
}

export function normalizeProviderFailureCategory(
  status: number | null,
  err?: unknown,
): ProviderFailureCategory {
  if (status === 401 || status === 403) return "provider_authentication_failed";
  if (status === 429) return "provider_rate_limited";
  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.message.toLowerCase().includes("timeout"))
  ) {
    return "provider_timeout";
  }
  if (status && status >= 500) return "provider_unavailable";
  return "provider_unavailable";
}

function logProviderAttempt(log: ProviderAttemptLog) {
  console.info(
    JSON.stringify({
      tag: "[CopyrightDiscovery]",
      scanId: log.scanId ?? "unknown",
      provider: log.provider,
      queryIndex: log.queryIndex,
      configuredStatus: log.configuredStatus,
      attemptNumber: log.attemptNumber,
      httpStatus: log.httpStatus,
      normalizedFailureCategory: log.normalizedFailureCategory,
      durationMs: log.durationMs,
      fallbackAttempted: log.fallbackAttempted,
      successStatus: log.successStatus,
      hitCount: log.hitCount,
    }),
  );
}

async function executeFirecrawlDirect(
  query: string,
  recent: boolean,
): Promise<{
  status: number;
  payload: FcResponse | null;
  failureCategory?: ProviderFailureCategory;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await firecrawlFetch(
      "/search",
      {
        query,
        limit: 10,
        sources: ["web", "images"],
        ...(recent ? { tbs: "qdr:m" } : {}),
      },
      { forceDirect: true, signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      const cat = normalizeProviderFailureCategory(res.status);
      return { status: res.status, payload: null, failureCategory: cat };
    }
    const payload = (await res.json()) as FcResponse;
    const hitCount = (payload.data?.web?.length ?? 0) + (payload.data?.images?.length ?? 0);
    return {
      status: 200,
      payload,
      failureCategory: hitCount > 0 ? "success" : "no_results",
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const cat = normalizeProviderFailureCategory(null, err);
    return { status: 0, payload: null, failureCategory: cat };
  }
}

async function executeLovableGateway(
  query: string,
  recent: boolean,
): Promise<{
  status: number;
  payload: FcResponse | null;
  failureCategory?: ProviderFailureCategory;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await firecrawlFetch(
      "/search",
      {
        query,
        limit: 10,
        sources: ["web", "images"],
        ...(recent ? { tbs: "qdr:m" } : {}),
      },
      { forceGateway: true, signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      const cat = normalizeProviderFailureCategory(res.status);
      return { status: res.status, payload: null, failureCategory: cat };
    }
    const payload = (await res.json()) as FcResponse;
    const hitCount = (payload.data?.web?.length ?? 0) + (payload.data?.images?.length ?? 0);
    return {
      status: 200,
      payload,
      failureCategory: hitCount > 0 ? "success" : "no_results",
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const cat = normalizeProviderFailureCategory(null, err);
    return { status: 0, payload: null, failureCategory: cat };
  }
}

async function executeBraveFallback(query: string): Promise<{
  status: number;
  payload: FcResponse | null;
  failureCategory?: ProviderFailureCategory;
}> {
  const key = process.env.BRAVE_API_KEY?.trim();
  if (!key) {
    return { status: 0, payload: null, failureCategory: "provider_not_configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const cat = normalizeProviderFailureCategory(res.status);
      return { status: res.status, payload: null, failureCategory: cat };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const web = json.web as
      | {
          results?: Array<{
            title?: string;
            url?: string;
            description?: string;
            snippet?: string;
            thumbnail?: { src?: string };
          }>;
        }
      | undefined;
    const webItems = Array.isArray(web?.results) ? web.results : [];

    const webHits: FcWeb[] = webItems.map((item) => ({
      url: item.url,
      title: item.title,
      description: item.description ?? item.snippet,
    }));

    const imageHits: FcImage[] = webItems
      .filter((item) => item.thumbnail?.src)
      .map((item) => ({
        url: item.url,
        sourceUrl: item.url,
        imageUrl: item.thumbnail?.src,
        thumbnailUrl: item.thumbnail?.src,
        title: item.title,
      }));

    const payload: FcResponse = {
      data: {
        web: webHits,
        images: imageHits,
      },
    };

    const hitCount = webHits.length + imageHits.length;
    return {
      status: 200,
      payload,
      failureCategory: hitCount > 0 ? "success" : "no_results",
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const cat = normalizeProviderFailureCategory(null, err);
    return { status: 0, payload: null, failureCategory: cat };
  }
}

async function executeSerpApiFallback(query: string): Promise<{
  status: number;
  payload: FcResponse | null;
  failureCategory?: ProviderFailureCategory;
}> {
  const key = process.env.SERPAPI_API_KEY?.trim();
  if (!key) {
    return { status: 0, payload: null, failureCategory: "provider_not_configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: key,
      num: "10",
    });
    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const cat = normalizeProviderFailureCategory(res.status);
      return { status: res.status, payload: null, failureCategory: cat };
    }

    const json = (await res.json()) as Record<string, unknown>;
    if (json.error) {
      const cat = normalizeProviderFailureCategory(401);
      return { status: 401, payload: null, failureCategory: cat };
    }

    const organic = Array.isArray(json.organic_results)
      ? (json.organic_results as Array<{ link?: string; title?: string; snippet?: string }>)
      : [];
    const images = Array.isArray(json.inline_images)
      ? (json.inline_images as Array<{
          link?: string;
          original?: string;
          thumbnail?: string;
          title?: string;
        }>)
      : [];

    const webHits: FcWeb[] = organic.map((item) => ({
      url: item.link,
      title: item.title,
      description: item.snippet,
    }));

    const imageHits: FcImage[] = images.map((item) => ({
      url: item.link ?? item.original,
      sourceUrl: item.link,
      imageUrl: item.original ?? item.thumbnail,
      thumbnailUrl: item.thumbnail,
      title: item.title,
    }));

    const payload: FcResponse = {
      data: {
        web: webHits,
        images: imageHits,
      },
    };

    const hitCount = webHits.length + imageHits.length;
    return {
      status: 200,
      payload,
      failureCategory: hitCount > 0 ? "success" : "no_results",
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const cat = normalizeProviderFailureCategory(null, err);
    return { status: 0, payload: null, failureCategory: cat };
  }
}

function buildAdminSummary(
  providerSummaries: Record<
    CopyrightProviderId,
    {
      configured: boolean;
      attempts: number;
      successes: number;
      failureCategory?: ProviderFailureCategory;
      lastErrorStatus?: number;
    }
  >,
  successfulQueries: number,
  totalQueries: number,
  fallbackUsed: boolean,
): string {
  const lines: string[] = [];
  const providerNames: Record<CopyrightProviderId, string> = {
    firecrawl_direct: "Firecrawl direct",
    lovable_gateway: "Lovable gateway",
    brave_fallback: "Brave fallback",
    serpapi_fallback: "SerpAPI fallback",
  };

  for (const [id, stats] of Object.entries(providerSummaries) as [
    CopyrightProviderId,
    (typeof providerSummaries)[CopyrightProviderId],
  ][]) {
    if (!stats.configured) {
      lines.push(`${providerNames[id]}: not configured`);
    } else if (stats.successes > 0) {
      lines.push(
        `${providerNames[id]}: ${stats.attempts} attempt(s) — succeeded (${stats.successes} successful query response(s))`,
      );
    } else if (stats.attempts > 0) {
      const catText = stats.failureCategory
        ? stats.failureCategory.replace("provider_", "").replace(/_/g, " ")
        : "failed";
      lines.push(
        `${providerNames[id]}: ${stats.attempts} attempt(s) — ${catText}${stats.lastErrorStatus ? ` (HTTP ${stats.lastErrorStatus})` : ""}`,
      );
    }
  }

  if (successfulQueries > 0) {
    if (fallbackUsed) {
      lines.push("Copyright discovery continued using fallback provider");
    } else {
      lines.push("Copyright discovery succeeded using primary provider");
    }
  } else {
    lines.push("All configured discovery provider requests failed");
  }

  return lines.join(" | ");
}

/** Capture a screenshot of a page so the grader has visual evidence. */
async function screenshot(url: string): Promise<string | null> {
  try {
    const res = await firecrawlFetch("/scrape", {
      url,
      formats: ["screenshot"],
      onlyMainContent: true,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      screenshot?: string;
      data?: { screenshot?: string };
    };
    const shot = json.screenshot ?? json.data?.screenshot ?? null;
    if (!shot) return null;
    return shot.startsWith("data:") || shot.startsWith("http")
      ? shot
      : `data:image/png;base64,${shot}`;
  } catch {
    return null;
  }
}

const PIRACY_HINTS =
  /(download|watch\s*online|watch\s*free|free\s*stream|streaming|full[- ]?movie|full[- ]?video|hdrip|dvdrip|predvd|hq|hdts|hdcam|camrip|cam[- ]?print|theatre[- ]?print|theater[- ]?print|webrip|web[- ]?dl|torrent|magnet|telegram|leak|leaked|1080p|720p|480p|dual[- ]?audio|filmy|movierulz|tamilrockers|ibomma|123movies|fmovies|mkv|isaimini|kuttymovies|tamilyogi|9xmovies|katmovie|vegamovies|mp4moviez|uwatchfree|primewire|soap2day)/i;

/** Piracy-term dictionaries per language, used to build native-script queries. */
const LOCAL_TERMS: Record<string, string[]> = {
  malayalam: ["മുഴുവൻ സിനിമ", "ഓൺലൈൻ", "ഡൗൺലോഡ്", "ചോർന്നു"],
  tamil: ["முழு படம்", "ஆன்லைன்", "பதிவிறக்கம்", "கசிந்தது"],
  telugu: ["పూర్തി సినిమా", "ఆన్‌లైన్", "ഡൗన్‌లోഡ്", "ലീക്"],
  kannada: ["ಪೂರ್ಣ ಚಲನಚಿತ್ರ", "ಆನ್‌ಲೈನ್", "ಡೌನ್‌ಲೋಡ್"],
  hindi: ["फुल मूवी", "ऑनलाइन देखें", "डाउनलोड", "लीक"],
  bengali: ["সম্পূর্ণ সিনেমা", "অনলাইন", "ডাউনলোড"],
  arabic: ["فيلم كامل", "مشاهدة اون لاين", "تحميل", "مسرب"],
  spanish: ["pelicula completa", "ver online gratis", "descargar"],
  french: ["film complet", "voir en streaming", "telecharger"],
  portuguese: ["filme completo", "assistir online", "download"],
  russian: ["смотреть онлайн", "скачать", "полный фильм"],
  indonesian: ["film lengkap", "nonton online", "unduh"],
  english: ["full movie", "watch online free", "download"],
};

const PIRACY_SITE_FILTER =
  "(site:telegram.me OR site:t.me OR site:archive.org OR site:ok.ru OR site:dailymotion.com OR site:rumble.com OR site:vk.com OR site:pastebin.com OR site:reddit.com OR site:x.com OR site:facebook.com)";

/** File lockers and embed hosts that typically carry unauthorized copies. */
const FILE_HOST_FILTER =
  "(site:mega.nz OR site:mediafire.com OR site:gofile.io OR site:pixeldrain.com OR site:doodstream.com OR site:streamtape.com OR site:mixdrop.co OR site:filemoon.sx OR site:1fichier.com)";

/** Known unauthorized streaming / index domains. */
const STREAM_SITE_FILTER =
  "(site:movierulz.vc OR site:ibomma.bet OR site:tamilrockers.ws OR site:123movies.ai OR site:fmovies.to OR site:soap2day.day OR site:vegamovies.nl OR site:mp4moviez.ink OR site:9xmovies.gold) full movie";

function localTermsFor(langs: string[]): string[] {
  const out: string[] = [];
  for (const l of langs) {
    const terms = LOCAL_TERMS[l.trim().toLowerCase()];
    if (terms) out.push(...terms);
  }
  return [...new Set(out)];
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

interface QueryPlan {
  query: string;
  /** restrict to recent results */
  recent: boolean;
}

function buildQueries(a: ReferenceAnalysis, workTitle: string): QueryPlan[] {
  const base = (a.title || workTitle).trim();
  const names = [...new Set([base, ...a.altTitles].filter(Boolean))].slice(0, 4);
  const ocrPhrase = (a.ocrText ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 6 && l.length < 60)[0];

  const age = daysSince(a.releaseDate);
  const isFresh = age !== null && age <= 30;

  const general = [
    "full movie",
    "watch online",
    "free streaming",
    "HD print",
    "CAM print",
    "WEB-DL",
    "download",
    "torrent",
    "movie file",
    "online free",
    "dubbed",
    "language versions",
    "online",
    "stream online",
    "streaming online",
    "full video",
    "full movie online free",
    "movie download",
    "movie download hd",
    "leaked",
    "CAM",
    "telegram",
    "movie file download",
    "watch online free hd",
    "embedded player watch",
    "mp4 download link",
    "google drive link",
    "mega.nz link",
    "index of movie",
    "hdrip 720p",
    "mirror links download",
    "dual audio download",
  ];
  const fresh = [
    "released today",
    "online today",
    "full movie leaked",
    "theatre print",
    "cinema recording",
    "same day leak",
    "day 1 print",
    "hdcam 720p download",
    "first day print online",
    "leaked online day one",
    "new release full movie download",
    "first week download",
  ];

  // Negative terms keep licensed/news/review pages out of the result set.
  const NEG =
    '-site:imdb.com -site:wikipedia.org -site:rottentomatoes.com -site:netflix.com -site:primevideo.com -site:hotstar.com -review -trailer_reaction -"box office" -news';

  const plans: QueryPlan[] = [];
  const push = (query: string, recent = false) => plans.push({ query, recent });

  // 1. Core piracy phrasing on the primary title.
  for (const term of general) push(`"${base}" ${term} ${NEG}`, isFresh);

  // 2. Fresh-release urgency terms.
  if (isFresh || !a.releaseDate) for (const term of fresh) push(`"${base}" ${term} ${NEG}`, true);

  // 3. Alternate / translated titles.
  for (const n of names.slice(1)) {
    push(`"${n}" full movie download ${NEG}`, isFresh);
    push(`"${n}" watch online free ${NEG}`, isFresh);
  }

  // 4. Language-native piracy terms.
  const langs = [a.language, ...a.audienceLanguages].filter(Boolean) as string[];
  for (const term of localTermsFor(langs).slice(0, 10)) push(`${base} ${term}`, isFresh);
  if (a.language) push(`${base} ${a.language} full movie download ${NEG}`, isFresh);
  if (a.region) push(`${base} ${a.region} movie download hd ${NEG}`, isFresh);

  // 5. Cast / studio correlation.
  for (const actor of a.actors.slice(0, 2)) {
    push(`${actor} "${base}" movie download ${NEG}`, isFresh);
    push(`${actor} "${base}" watch online free ${NEG}`, isFresh);
  }
  if (a.productionCompany) push(`${a.productionCompany} "${base}" leaked print`);
  if (a.releaseDate)
    push(`"${base}" ${a.releaseDate.slice(0, 4)} full movie download ${NEG}`, isFresh);

  // 6. Platform-scoped piracy hosts, forums, file lockers and social.
  push(`${base} full movie ${PIRACY_SITE_FILTER}`, isFresh);
  push(`${base} download link forum thread ${NEG}`, isFresh);
  push(`${base} ${FILE_HOST_FILTER}`, isFresh);
  push(`${base} ${STREAM_SITE_FILTER}`, isFresh);

  // 7. Visual / artwork reuse.
  push(`"${base}" poster hd image download ${NEG}`);
  push(`${base} movie screenshot still frame`);
  push(`${base} trailer clip mp4 download`);
  for (const d of a.descriptors.slice(0, 3)) push(`${base} ${d}`);
  for (const f of a.visualFeatures.slice(0, 2)) push(`${base} ${f}`);
  if (ocrPhrase) push(`"${ocrPhrase}" ${base}`);
  if (a.watermark) push(`${base} ${a.watermark}`);

  const seen = new Set<string>();
  return plans
    .filter((p) => p.query.trim() && !seen.has(p.query) && seen.add(p.query))
    .slice(0, 44);
}

/** Coarse piracy taxonomy used for evidence labelling. */
export function piracyCategory(text: string): string {
  const t = text.toLowerCase();
  if (/(hdcam|camrip|cam[- ]?print|theatre[- ]?print|theater|cinema recording|hdts)/.test(t))
    return "cam_theatre_leak";
  if (/(torrent|magnet|1337x|yts|rarbg)/.test(t)) return "torrent";
  if (/(t\.me|telegram)/.test(t)) return "telegram_channel";
  if (/(hdrip|webrip|web[- ]?dl|dvdrip|480p|720p|1080p|mkv|mp4)/.test(t)) return "ripped_copy";
  if (/(watch online|streaming|free stream|full movie|full video)/.test(t)) return "streaming_site";
  if (/(download|file|drive\.google|mega\.nz|mediafire)/.test(t)) return "file_sharing";
  if (/(forum|thread|community|reddit)/.test(t)) return "forum_post";
  if (/(poster|artwork|wallpaper|still|screenshot)/.test(t)) return "artwork_reupload";
  return "web_lead";
}

/** Language guess for a candidate, based on the analysis + candidate text. */
function detectLanguage(text: string, a: ReferenceAnalysis): string | null {
  for (const [lang, terms] of Object.entries(LOCAL_TERMS)) {
    if (terms.some((t) => text.includes(t))) return lang;
  }
  return a.language ?? null;
}

export interface PageLead {
  url: string;
  title: string | null;
  query: string;
  /** discovery snippet text used for keyword signals */
  text: string;
  /** discovery flagged this as a strong piracy lead */
  strong: boolean;
}

export interface DiscoveryOptions {
  scanId?: string;
}

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  /** page-level leads for distribution-site inspection */
  pageLeads: PageLead[];
  diagnostics: CopyrightDiscoveryDiagnostics;
}

/**
 * Discover candidate re-uploads with multi-provider discovery (Firecrawl direct,
 * Lovable gateway, Brave fallback), seeded by the AI-vision analysis of the reference frame.
 */
export async function firecrawlDiscover(
  referenceDataUrl: string,
  workTitle: string,
  frameIndex: number,
  analysis?: ReferenceAnalysis,
  options?: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const configuredProviders = getCopyrightDiscoveryProviders();
  const scanId = options?.scanId;

  const providerSummaries: Record<
    CopyrightProviderId,
    {
      configured: boolean;
      attempts: number;
      successes: number;
      failureCategory?: ProviderFailureCategory;
      lastErrorStatus?: number;
    }
  > = {
    firecrawl_direct: {
      configured: configuredProviders.includes("firecrawl_direct"),
      attempts: 0,
      successes: 0,
    },
    lovable_gateway: {
      configured: configuredProviders.includes("lovable_gateway"),
      attempts: 0,
      successes: 0,
    },
    brave_fallback: {
      configured: configuredProviders.includes("brave_fallback"),
      attempts: 0,
      successes: 0,
    },
    serpapi_fallback: {
      configured: configuredProviders.includes("serpapi_fallback"),
      attempts: 0,
      successes: 0,
    },
  };

  if (configuredProviders.length === 0) {
    const adminSummary =
      "No Copyright discovery providers are configured (missing FIRECRAWL_API_KEY, BRAVE_API_KEY, and SERPAPI_API_KEY)";
    const userMessage = USER_DISCOVERY_UNAVAILABLE_MESSAGE;
    const diagnostics: CopyrightDiscoveryDiagnostics = {
      providerSummaries,
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      fallbackUsed: false,
      adminSummary,
      userMessage,
    };
    logProviderAttempt({
      scanId,
      provider: "firecrawl_direct",
      queryIndex: 0,
      query: "none",
      configuredStatus: "not_configured",
      attemptNumber: 0,
      httpStatus: null,
      normalizedFailureCategory: "provider_not_configured",
      durationMs: 0,
      fallbackAttempted: false,
      successStatus: false,
      hitCount: 0,
    });
    throw new CopyrightDiscoveryError(adminSummary, userMessage, diagnostics);
  }

  const a = analysis ?? (await analyzeReference(referenceDataUrl, workTitle));
  const plans = buildQueries(a, workTitle);

  const seen = new Set<string>();
  const out: DiscoveryCandidate[] = [];
  const strongLeads: Array<{ url: string; title: string | null; query: string; text: string }> = [];
  const weakLeads: Array<{ url: string; title: string | null; query: string; text: string }> = [];

  let successfulQueries = 0;
  let failedQueries = 0;
  let fallbackUsed = false;

  for (let qIdx = 0; qIdx < plans.length; qIdx++) {
    const plan = plans[qIdx];
    let querySuccess = false;
    let payload: FcResponse | null = null;

    for (let pIdx = 0; pIdx < configuredProviders.length; pIdx++) {
      const provider = configuredProviders[pIdx];
      const fallbackAttempted = pIdx > 0;
      const startTime = Date.now();
      const summary = providerSummaries[provider];
      summary.attempts++;

      let res: {
        status: number;
        payload: FcResponse | null;
        failureCategory?: ProviderFailureCategory;
      };

      if (provider === "firecrawl_direct") {
        res = await executeFirecrawlDirect(plan.query, plan.recent);
      } else if (provider === "lovable_gateway") {
        res = await executeLovableGateway(plan.query, plan.recent);
      } else if (provider === "brave_fallback") {
        res = await executeBraveFallback(plan.query);
      } else {
        res = await executeSerpApiFallback(plan.query);
      }

      const durationMs = Date.now() - startTime;
      const isSuccess = res.status === 200;

      if (isSuccess) {
        summary.successes++;
        if (fallbackAttempted) fallbackUsed = true;
        querySuccess = true;
        payload = res.payload;

        logProviderAttempt({
          scanId,
          provider,
          queryIndex: qIdx,
          query: plan.query,
          configuredStatus: "configured",
          attemptNumber: summary.attempts,
          httpStatus: 200,
          normalizedFailureCategory: res.failureCategory ?? "success",
          durationMs,
          fallbackAttempted,
          successStatus: true,
          hitCount: (payload?.data?.web?.length ?? 0) + (payload?.data?.images?.length ?? 0),
        });

        break;
      } else {
        summary.failureCategory = res.failureCategory ?? "provider_unavailable";
        summary.lastErrorStatus = res.status || undefined;

        logProviderAttempt({
          scanId,
          provider,
          queryIndex: qIdx,
          query: plan.query,
          configuredStatus: "configured",
          attemptNumber: summary.attempts,
          httpStatus: res.status || null,
          normalizedFailureCategory: summary.failureCategory,
          durationMs,
          fallbackAttempted,
          successStatus: false,
          hitCount: 0,
        });
      }
    }

    if (querySuccess && payload) {
      successfulQueries++;

      for (const img of payload.data?.images ?? []) {
        const page = img.url ?? img.sourceUrl;
        const image = img.imageUrl ?? img.thumbnailUrl;
        if (!page || !image) continue;
        const key = canonicalUrl(page);
        if (seen.has(key)) continue;
        seen.add(key);
        if (isExcludedHost(key)) continue;
        const text = `${img.title ?? ""} ${key}`;
        const websiteType = websiteTypeFor(key, `${text} ${plan.query}`);
        out.push({
          url: key,
          title: img.title ?? null,
          source: hostOf(key),
          thumbnail: img.thumbnailUrl ?? image,
          imageUrl: image,
          exact: PIRACY_HINTS.test(text) || isSuspiciousType(websiteType),
          frameIndex,
          query: plan.query,
          category: piracyCategory(`${text} ${plan.query}`),
          language: detectLanguage(text, a),
          keywordMatch: plan.query,
          websiteType,
        });
      }

      for (const web of payload.data?.web ?? []) {
        if (!web.url) continue;
        const key = canonicalUrl(web.url);
        if (seen.has(key)) continue;
        seen.add(key);
        if (isExcludedHost(key)) continue;
        const text = `${web.title ?? ""} ${web.description ?? ""} ${key}`;
        if (
          /(review|recap|explained|reaction|opinion|box office|interview|press release)/i.test(text)
        )
          continue;
        const lead = { url: key, title: web.title ?? null, query: plan.query, text };
        if (
          PIRACY_HINTS.test(text) ||
          isSuspiciousType(websiteTypeFor(key, `${text} ${plan.query}`))
        ) {
          strongLeads.push(lead);
        } else {
          weakLeads.push(lead);
        }
      }
    } else {
      failedQueries++;
    }
  }

  const primaryProviderName = configuredProviders[0] ?? "firecrawl_direct";
  const primarySummary = providerSummaries[primaryProviderName];
  const primaryFailed = primarySummary.attempts > 0 && primarySummary.successes === 0;

  const adminSummary = buildAdminSummary(
    providerSummaries,
    successfulQueries,
    plans.length,
    fallbackUsed || primaryFailed,
  );
  const userMessage = USER_DISCOVERY_UNAVAILABLE_MESSAGE;

  const diagnostics: CopyrightDiscoveryDiagnostics = {
    providerSummaries,
    totalQueries: plans.length,
    successfulQueries,
    failedQueries,
    fallbackUsed: fallbackUsed || (primaryFailed && successfulQueries > 0),
    adminSummary,
    userMessage,
  };

  if (successfulQueries === 0) {
    throw new CopyrightDiscoveryError(adminSummary, userMessage, diagnostics);
  }

  // Capture screenshots for page-only leads so the grader always has visual
  // evidence. Strong piracy leads first; weak leads only top the list up when
  // discovery would otherwise return almost nothing.
  const needed = Math.max(0, 18 - out.length);
  const toShoot = [
    ...strongLeads.slice(0, 16),
    ...(out.length + strongLeads.length < 18 ? weakLeads.slice(0, needed) : []),
  ];

  const shots = await Promise.all(
    toShoot.map(async (lead) => ({ lead, shot: await screenshot(lead.url) })),
  );
  for (const { lead, shot } of shots) {
    if (!shot) continue;
    const websiteType = websiteTypeFor(lead.url, `${lead.text} ${lead.query}`);
    const strong = PIRACY_HINTS.test(lead.text) || isSuspiciousType(websiteType);
    out.push({
      url: lead.url,
      title: lead.title,
      source: hostOf(lead.url),
      thumbnail: shot,
      imageUrl: shot,
      exact: strong,
      frameIndex,
      query: lead.query,
      category: piracyCategory(`${lead.text} ${lead.query}`),
      language: detectLanguage(lead.text, a),
      keywordMatch: lead.query,
      websiteType,
    });
  }

  // Page-level leads feed the distribution-site inspector (player/download/
  // mirror/file-link evidence), independent of whether a screenshot succeeded.
  const pageLeads: PageLead[] = [
    ...strongLeads.map((l) => ({ ...l, title: l.title ?? null, strong: true })),
    ...weakLeads.slice(0, 12).map((l) => ({ ...l, title: l.title ?? null, strong: false })),
  ].slice(0, 40);

  // Suspicious distribution sources first, official-looking noise never here.
  return {
    candidates: out.sort((x, y) => Number(y.exact) - Number(x.exact)).slice(0, 60),
    pageLeads,
    diagnostics,
  };
}
