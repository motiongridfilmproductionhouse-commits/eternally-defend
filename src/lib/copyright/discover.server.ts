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
  calculatePriorityScore,
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

/**
 * AI-vision analysis of the reference frame. Delegates to whichever
 * CopyrightVisionProvider is configured (Gemini direct if GEMINI_API_KEY is
 * set, else Lovable's gateway if LOVABLE_API_KEY is set, else a fallback
 * that degrades gracefully) — see vision-provider.ts. Return shape and the
 * "degrade to a title-only fallback on any failure" contract are unchanged.
 */
export async function analyzeReference(
  referenceDataUrl: string,
  workTitle: string,
): Promise<ReferenceAnalysis> {
  const { getCopyrightVisionProvider } = await import("./vision-provider");
  const provider = await getCopyrightVisionProvider();
  return provider.analyzeReference(referenceDataUrl, workTitle);
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

export interface AdminQueryResultDiagnostic {
  queryIndex: number;
  query: string;
  category: "known_piracy" | "high_intent_terms" | "social_leads" | "mirrors_historical";
  provider: CopyrightProviderId;
  rawResultCount: number;
  acceptedResultCount: number;
  rejectedResultCount: number;
  rejectedItems: Array<{
    url: string;
    domain: string;
    reason:
      "excluded_official_host" | "news_review_filtered" | "duplicate_canonical_url" | "unrelated";
  }>;
  acceptedItems: Array<{
    url: string;
    domain: string;
    priorityScore: number;
    websiteType: string;
  }>;
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
  queryDiagnostics?: AdminQueryResultDiagnostic[];
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

  if (fcKey && !fcKey.startsWith("lovc_")) {
    providers.push("firecrawl_direct");
  }

  if (lovKey && (fcKey?.startsWith("lovc_") || !fcKey)) {
    providers.push("lovable_gateway");
  } else if (lovKey && fcKey) {
    if (!providers.includes("lovable_gateway")) providers.push("lovable_gateway");
  }

  if (braveKey) {
    providers.push("brave_fallback");
  }

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
  telugu: ["పూర్తి సినిమా", "ఆన్‌లైన్", "ഡൗన్‌లోഡ്", "లీక్"],
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

export interface QueryPlan {
  query: string;
  recent: boolean;
  category: "known_piracy" | "high_intent_terms" | "social_leads" | "mirrors_historical";
}

export function buildQueries(a: ReferenceAnalysis, workTitle: string): QueryPlan[] {
  const base = (a.title || workTitle).trim();
  const age = daysSince(a.releaseDate);
  const isFresh = age !== null && age <= 30;
  const langStr = a.language ?? "Malayalam";

  const plans: QueryPlan[] = [];
  const push = (query: string, category: QueryPlan["category"], recent = false) =>
    plans.push({ query, recent, category });

  // 1. Targeted site queries for known piracy and file-host patterns (40% budget)
  const targetedSitePatterns = [
    `site:ogomovies* "${base}"`,
    `site:movierulz* "${base}"`,
    `site:tamilrockers* "${base}"`,
    `site:1tamilmv* "${base}"`,
    `site:filmyzilla* "${base}"`,
    `site:moviesda* "${base}"`,
    `site:kuttymovies* "${base}"`,
    `site:isaimini* "${base}"`,
    `site:vegamovies* "${base}"`,
    `site:mp4moviez* "${base}"`,
    `site:uwatchfree* "${base}"`,
    `site:ibomma* "${base}"`,
    `site:123movies* "${base}"`,
    `site:fmovies* "${base}"`,
    `site:soap2day* "${base}"`,
    `site:telegram.me "${base}"`,
    `site:t.me "${base}"`,
    `site:terabox.com "${base}"`,
    `site:terabox.app "${base}"`,
    `site:archive.org "${base}"`,
    `site:mediafire.com "${base}"`,
    `site:mega.nz "${base}"`,
    `site:dailymotion.com "${base}"`,
    `site:bilibili.tv "${base}"`,
  ];
  for (const q of targetedSitePatterns) push(q, "known_piracy", isFresh);

  // 2. High-intent piracy / streaming / download queries (30% budget)
  const highIntentTerms = [
    `"${base}" watch online`,
    `"${base}" full movie`,
    `"${base}" free download`,
    `"${base}" HD download`,
    `"${base}" 1080p download`,
    `"${base}" 720p download`,
    `"${base}" ${langStr} movie download`,
    `"${base}" streaming free`,
    `"${base}" telegram`,
    `"${base}" torrent`,
    `"${base}" direct download`,
    `"${base}" mkv`,
    `"${base}" mp4`,
    `"${base}" dual audio`,
    `"${base}" subtitles download`,
    `"${base}" HDRip WEB-DL`,
  ];
  for (const q of highIntentTerms) push(q, "high_intent_terms", isFresh);

  // 3. Language native script terms
  const langs = [a.language, ...a.audienceLanguages].filter(Boolean) as string[];
  for (const term of localTermsFor(langs).slice(0, 5)) {
    push(`${base} ${term}`, "high_intent_terms", isFresh);
  }

  // 4. Social distribution leads (20% budget)
  const socialQueries = [
    `"${base}" full movie site:facebook.com`,
    `"${base}" full movie site:x.com`,
    `"${base}" full movie site:reddit.com`,
    `"${base}" full movie site:youtube.com`,
    `"${base}" full movie site:ok.ru`,
    `"${base}" full movie site:vk.com`,
  ];
  for (const q of socialQueries) push(q, "social_leads", isFresh);

  // 5. Mirrors & historical candidates (10% budget)
  const mirrorQueries = [
    `"${base}" mirror download link`,
    `"${base}" fast download mirror`,
    `"${base}" alternative stream link`,
  ];
  for (const q of mirrorQueries) push(q, "mirrors_historical", isFresh);

  const seen = new Set<string>();
  return plans
    .filter((p) => p.query.trim() && !seen.has(p.query) && seen.add(p.query))
    .slice(0, 50);
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
  if (/(download|file|drive\.google|mega\.nz|mediafire|terabox)/.test(t)) return "file_sharing";
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
  historicalUrls?: string[];
}

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  /** page-level leads for distribution-site inspection */
  pageLeads: PageLead[];
  diagnostics: CopyrightDiscoveryDiagnostics;
}

/**
 * Discover candidate re-uploads with multi-provider discovery (Firecrawl direct,
 * Lovable gateway, Brave fallback, SerpAPI fallback).
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
  const queryDiagnostics: AdminQueryResultDiagnostic[] = [];

  let successfulQueries = 0;
  let failedQueries = 0;
  let fallbackUsed = false;

  // Process historical URLs if provided
  if (options?.historicalUrls && options.historicalUrls.length > 0) {
    for (const hUrl of options.historicalUrls) {
      const key = canonicalUrl(hUrl);
      if (!seen.has(key) && !isExcludedHost(key)) {
        seen.add(key);
        const host = hostOf(key);
        const wType = websiteTypeFor(key, workTitle);
        const pScore = calculatePriorityScore(key, workTitle, workTitle, workTitle) + 40;
        out.push({
          url: key,
          title: `${workTitle} (Historical Detection)`,
          source: host,
          thumbnail: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host ?? "domain")}&sz=128`,
          imageUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host ?? "domain")}&sz=128`,
          exact: true,
          frameIndex,
          query: "historical_recheck",
          category: piracyCategory(key),
          language: a.language ?? null,
          keywordMatch: "historical_seed",
          websiteType: wType,
          priorityScore: pScore,
          historicalStatus: "active",
        });
      }
    }
  }

  for (let qIdx = 0; qIdx < plans.length; qIdx++) {
    const plan = plans[qIdx];
    let querySuccess = false;
    let payload: FcResponse | null = null;
    let activeProvider: CopyrightProviderId = configuredProviders[0];

    for (let pIdx = 0; pIdx < configuredProviders.length; pIdx++) {
      const provider = configuredProviders[pIdx];
      activeProvider = provider;
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

      const diagAccepted: AdminQueryResultDiagnostic["acceptedItems"] = [];
      const diagRejected: AdminQueryResultDiagnostic["rejectedItems"] = [];
      const rawCount = (payload.data?.web?.length ?? 0) + (payload.data?.images?.length ?? 0);

      // Process web search results directly without requiring a screenshot
      for (const web of payload.data?.web ?? []) {
        if (!web.url) continue;
        const key = canonicalUrl(web.url);
        const host = hostOf(key) ?? "domain";

        if (isExcludedHost(key)) {
          diagRejected.push({
            url: key,
            domain: host,
            reason: "excluded_official_host",
          });
          continue;
        }

        if (seen.has(key)) {
          diagRejected.push({
            url: key,
            domain: host,
            reason: "duplicate_canonical_url",
          });
          continue;
        }
        seen.add(key);

        const text = `${web.title ?? ""} ${web.description ?? ""} ${key}`;
        const websiteType = websiteTypeFor(key, text);

        if (websiteType === "review_or_news") {
          diagRejected.push({
            url: key,
            domain: host,
            reason: "news_review_filtered",
          });
        }

        const priorityScore = calculatePriorityScore(key, web.title ?? null, text, workTitle);

        const candidateObj: DiscoveryCandidate = {
          url: key,
          title: web.title ?? null,
          source: host,
          thumbnail: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
          imageUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
          exact: PIRACY_HINTS.test(text) || isSuspiciousType(websiteType),
          frameIndex,
          query: plan.query,
          category: piracyCategory(`${text} ${plan.query}`),
          language: detectLanguage(text, a),
          keywordMatch: plan.query,
          websiteType,
          priorityScore,
        };

        out.push(candidateObj);

        diagAccepted.push({
          url: key,
          domain: host,
          priorityScore,
          websiteType,
        });

        const lead = { url: key, title: web.title ?? null, query: plan.query, text };
        if (candidateObj.exact) {
          strongLeads.push(lead);
        } else {
          weakLeads.push(lead);
        }
      }

      // Process image search results
      for (const img of payload.data?.images ?? []) {
        const page = img.url ?? img.sourceUrl;
        const image = img.imageUrl ?? img.thumbnailUrl;
        if (!page || !image) continue;
        const key = canonicalUrl(page);
        const host = hostOf(key) ?? "domain";

        if (isExcludedHost(key)) {
          diagRejected.push({
            url: key,
            domain: host,
            reason: "excluded_official_host",
          });
          continue;
        }

        if (seen.has(key)) {
          diagRejected.push({
            url: key,
            domain: host,
            reason: "duplicate_canonical_url",
          });
          continue;
        }
        seen.add(key);

        const text = `${img.title ?? ""} ${key}`;
        const websiteType = websiteTypeFor(key, text);
        const priorityScore = calculatePriorityScore(key, img.title ?? null, text, workTitle);

        out.push({
          url: key,
          title: img.title ?? null,
          source: host,
          thumbnail: img.thumbnailUrl ?? image,
          imageUrl: image,
          exact: PIRACY_HINTS.test(text) || isSuspiciousType(websiteType),
          frameIndex,
          query: plan.query,
          category: piracyCategory(`${text} ${plan.query}`),
          language: detectLanguage(text, a),
          keywordMatch: plan.query,
          websiteType,
          priorityScore,
        });

        diagAccepted.push({
          url: key,
          domain: host,
          priorityScore,
          websiteType,
        });
      }

      queryDiagnostics.push({
        queryIndex: qIdx,
        query: plan.query,
        category: plan.category,
        provider: activeProvider,
        rawResultCount: rawCount,
        acceptedResultCount: diagAccepted.length,
        rejectedResultCount: diagRejected.length,
        rejectedItems: diagRejected,
        acceptedItems: diagAccepted,
      });
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
    queryDiagnostics,
  };

  if (successfulQueries === 0) {
    throw new CopyrightDiscoveryError(adminSummary, userMessage, diagnostics);
  }

  // Attempt screenshots for top leads asynchronously without dropping candidates on failure
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
    const existing = out.find((c) => c.url === lead.url);
    if (existing) {
      existing.thumbnail = shot;
      existing.imageUrl = shot;
    }
  }

  const pageLeads: PageLead[] = [
    ...strongLeads.map((l) => ({ ...l, title: l.title ?? null, strong: true })),
    ...weakLeads.slice(0, 12).map((l) => ({ ...l, title: l.title ?? null, strong: false })),
  ].slice(0, 40);

  // Sort candidates by priority score (piracy/streaming/file-hosts first)
  const sortedCandidates = [...out]
    .sort((x, y) => (y.priorityScore ?? 0) - (x.priorityScore ?? 0))
    .slice(0, 60);

  return {
    candidates: sortedCandidates,
    pageLeads,
    diagnostics,
  };
}
