/**
 * Reference analysis + reverse-discovery for the Copyright Intelligence engine.
 *
 * No SerpApi / Google Lens. The reference frame is analysed with AI vision
 * (title, alternative titles, language, cast, studio, release date, OCR text,
 * watermarks, visual descriptors), and those signals drive a multilingual
 * Firecrawl web + image search that hunts streaming sites, file lockers,
 * piracy indexes, forums, social platforms and video hosts.
 */

import {
  firecrawlEnvironmentDiagnostic,
  firecrawlFetch,
  isFirecrawlConfigured,
  type FirecrawlEnvironmentDiagnostic,
} from "@/lib/firecrawl-client.server";
import {
  canonicalUrl,
  hostOf,
  isExcludedHost,
  isSuspiciousType,
  websiteTypeFor,
  type DiscoveryCandidate,
} from "./url.server";
import {
  runBatchedDiscovery,
  FIRECRAWL_MAX_RETRIES,
  DISCOVERY_EARLY_STOP_UNIQUE_PAGES,
  isTransientFirecrawlFailure,
  parseRetryAfterMs,
  sleepWithAbort,
  isPastDiscoveryDeadline,
  emptyDiscoveryCircuit,
} from "./discovery-runtime";
import {
  bumpProviderFailure,
  classifyProviderFailure,
  emptyProviderFailureCounts,
  sanitizeProviderFailureDetail,
  type ProviderFailureCategory,
} from "./provider-failures";
import {
  DEFAULT_PAGE_CAP,
  FIRECRAWL_PRIORITY_QUERY_PAGES,
  FIRECRAWL_SEARCH_LIMIT,
  FIRECRAWL_PROVIDER_BUDGET_MS,
  MAX_DISCOVERY_CANDIDATES,
  MAX_DISCOVERY_QUERIES_PER_SCAN,
  MIN_DISCOVERY_QUERIES,
} from "./discovery-config";
import { PROVIDER_CRAWL_BUDGET_MS } from "./crawl-budget";
import {
  buildAllDiscoveryQueries,
  buildStagedDiscoveryQueries,
  type DiscoveryQueryPlan,
} from "./discovery-query-stages";
import {
  buildSaturationMetrics,
  buildCoverageStateFromPageKeys,
  emptyDiscoveryCoverageState,
  expandPlansForDiscoveryMode,
  recordCompletedDiscoveryQuery,
  recordQueryCategoryFromPlan,
  resolveDiscoveryMode,
  shouldIssueDiscoveryPlan,
  shouldSkipStageExpansion,
  type DiscoverySaturationMetrics,
} from "./discovery-saturation";

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
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const list = (v: unknown, n: number) =>
      Array.isArray(v) ? v.map((d) => String(d).slice(0, 80)).filter(Boolean).slice(0, n) : [];
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
interface FcWeb { url?: string; title?: string; description?: string }
interface FcResponse {
  success?: boolean;
  data?: { web?: FcWeb[]; images?: FcImage[] };
  error?: string;
}

export interface ProviderSearchAttempt {
  query: string;
  payload: FcResponse | null;
  ok: boolean;
  failureCategory?: ProviderFailureCategory;
  failureDetail?: string;
  httpStatus?: number | null;
}

/** Focused query cap — discovery continues until plans exhausted or deadline. */
export { MIN_DISCOVERY_QUERIES, MAX_DISCOVERY_QUERIES_PER_SCAN } from "./discovery-config";

export interface DiscoveryProgress {
  queriesGenerated: number;
  queriesExecuted: number;
  providerSuccesses: number;
  providerFailures: number;
  uniquePages: number;
  /** New page leads seen in this wave (streamed to the live investigation UI). */
  leads: Array<{ url: string; title: string | null; query: string }>;
  /** Image-search hits with remote thumbnails for the reference carousel. */
  referenceImages: Array<{
    pageUrl: string;
    imageUrl: string;
    title: string | null;
    query: string;
  }>;
}

export interface FirecrawlDiscoverOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
  analysis?: ReferenceAnalysis;
  /** Additional leak-monitoring queries prepended before default plans. */
  extraQueryStrings?: string[];
  onProgress?: (progress: DiscoveryProgress) => void | Promise<void>;
}

function extractAttemptProgress(
  attempt: ProviderSearchAttempt,
  progressSeen: Set<string>,
  imageSeen: Set<string>,
): Pick<DiscoveryProgress, "leads" | "referenceImages"> {
  const leads: DiscoveryProgress["leads"] = [];
  const referenceImages: DiscoveryProgress["referenceImages"] = [];
  if (!attempt.ok || !attempt.payload) return { leads, referenceImages };

  for (const img of attempt.payload.data?.images ?? []) {
    const page = img.url ?? img.sourceUrl;
    const image = img.imageUrl ?? img.thumbnailUrl;
    if (!page || !image) continue;
    const pageKey = canonicalUrl(page);
    if (isExcludedHost(pageKey)) continue;
    const imageKey = image.trim();
    if (imageSeen.has(imageKey)) continue;
    imageSeen.add(imageKey);
    referenceImages.push({
      pageUrl: pageKey,
      imageUrl: imageKey,
      title: img.title ?? null,
      query: attempt.query,
    });
  }

  const rows = [
    ...(attempt.payload.data?.web ?? []).map((w) => ({
      url: w.url,
      title: w.title ?? null,
    })),
    ...(attempt.payload.data?.images ?? []).map((i) => ({
      url: i.url ?? i.sourceUrl,
      title: i.title ?? null,
    })),
  ];
  for (const row of rows) {
    if (!row.url) continue;
    const key = canonicalUrl(row.url);
    if (progressSeen.has(key) || isExcludedHost(key)) continue;
    progressSeen.add(key);
    leads.push({ url: key, title: row.title, query: attempt.query });
  }

  return { leads, referenceImages };
}

async function search(
  query: string,
  recent: boolean,
  signal?: AbortSignal,
  deadlineAt?: number,
  page = 1,
): Promise<ProviderSearchAttempt> {
  if (!isFirecrawlConfigured()) {
    return {
      query,
      payload: null,
      ok: false,
      failureCategory: "missing_api_key",
      failureDetail: "Firecrawl is not configured for copyright discovery.",
      httpStatus: null,
    };
  }

  let lastStatus: number | null = null;
  let lastDetail = "Provider request failed";
  let lastCategory: ProviderFailureCategory = "provider_unavailable";

  for (let attempt = 0; attempt <= FIRECRAWL_MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (typeof deadlineAt === "number" && Date.now() >= deadlineAt) {
      return {
        query,
        payload: null,
        ok: false,
        failureCategory: "timeout",
        failureDetail: "Discovery deadline reached before Firecrawl search completed.",
        httpStatus: lastStatus,
      };
    }

    try {
      const res = await firecrawlFetch(
        "/search",
        {
          query,
          limit: FIRECRAWL_SEARCH_LIMIT,
          page,
          sources: ["web", "images"],
          ...(recent ? { tbs: "qdr:m" } : {}),
        },
        { signal },
      );
      lastStatus = res.status;

      if (!res.ok) {
        let bodyHint = "";
        try {
          const errText = await res.text();
          bodyHint = errText ? `: ${errText.slice(0, 120)}` : "";
        } catch {
          /* ignore */
        }
        lastDetail = sanitizeProviderFailureDetail(`Firecrawl search HTTP ${res.status}${bodyHint}`);
        lastCategory = classifyProviderFailure({ status: res.status, configured: true });
        if (attempt < FIRECRAWL_MAX_RETRIES && isTransientFirecrawlFailure(res.status)) {
          await sleepWithAbort(
            parseRetryAfterMs(res.headers.get("retry-after")) ??
              (res.status === 429 ? 4_000 : 2_000),
            signal,
          );
          continue;
        }
        return {
          query,
          payload: null,
          ok: false,
          failureCategory: lastCategory,
          failureDetail: lastDetail,
          httpStatus: res.status,
        };
      }

      try {
        const payload = (await res.json()) as FcResponse;
        if (payload.success === false) {
          lastDetail = sanitizeProviderFailureDetail(
            payload.error || "Firecrawl search returned success=false",
          );
          lastCategory = classifyProviderFailure({ error: payload.error, configured: true });
          if (attempt < FIRECRAWL_MAX_RETRIES && isTransientFirecrawlFailure(null, payload.error)) {
            await sleepWithAbort(2_000, signal);
            continue;
          }
          return {
            query,
            payload: null,
            ok: false,
            failureCategory: lastCategory,
            failureDetail: lastDetail,
            httpStatus: res.status,
          };
        }
        return { query, payload, ok: true, httpStatus: res.status };
      } catch (e) {
        lastDetail = sanitizeProviderFailureDetail(e);
        lastCategory = "malformed_response";
        if (attempt < FIRECRAWL_MAX_RETRIES) {
          await sleepWithAbort(2_000, signal);
          continue;
        }
        return {
          query,
          payload: null,
          ok: false,
          failureCategory: lastCategory,
          failureDetail: lastDetail,
          httpStatus: res.status,
        };
      }
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        throw e;
      }
      lastDetail = sanitizeProviderFailureDetail(e);
      lastCategory = classifyProviderFailure({ error: e, configured: true });
      if (attempt < FIRECRAWL_MAX_RETRIES && isTransientFirecrawlFailure(null, e)) {
        await sleepWithAbort(2_000, signal);
        continue;
      }
      return {
        query,
        payload: null,
        ok: false,
        failureCategory: lastCategory,
        failureDetail: lastDetail,
        httpStatus: lastStatus,
      };
    }
  }

  return {
    query,
    payload: null,
    ok: false,
    failureCategory: lastCategory,
    failureDetail: lastDetail,
    httpStatus: lastStatus,
  };
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
  telugu: ["పూర్తి సినిమా", "ఆన్‌లైన్", "డౌన్‌లోడ్", "లీక్"],
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

interface QueryPlan extends DiscoveryQueryPlan {}

/**
 * Focused exact-title piracy queries across all adaptive stages.
 * Exported for regression tests.
 */
export function buildQueries(a: ReferenceAnalysis, workTitle: string): QueryPlan[] {
  return buildAllDiscoveryQueries(a, workTitle);
}

/**
 * Coarse discovery taxonomy for ranking leads only.
 * Never treat bare "cinema"/"theater" (showtimes) as theatre-print piracy.
 */
export function piracyCategory(text: string): string {
  const t = text.toLowerCase();
  const hasAccessSignal =
    /(hdcam|camrip|cam[- ]?print|theatre\s*print|theater\s*print|cinema\s*recording|hdts|hq[- ]?cam|torrent|magnet|watch\s*full\s*movie|download\s*full\s*movie|free\s*stream|webrip|web[- ]?dl|mega\.nz|mediafire|\.mkv|\.torrent)/.test(
      t,
    );

  // Soft negatives only when no access/piracy language is present.
  if (
    !hasAccessSignal &&
    /\b(now\s*showing|showtimes?|book\s*tickets?|buy\s*tickets?|vox\s*cinemas)\b/.test(t)
  ) {
    return "cinema_or_showtime";
  }
  if (!hasAccessSignal && /\b(official\s*trailer|teaser\s*trailer|song\s*video)\b/.test(t)) {
    return "trailer_or_promo";
  }
  if (!hasAccessSignal && /\b(movie\s*review|film\s*review|box\s*office|interview)\b/.test(t)) {
    return "review_or_news";
  }
  if (/(hdcam|camrip|cam[- ]?print|theatre\s*print|theater\s*print|cinema\s*recording|hdts|hq[- ]?cam)/.test(t)) {
    return "cam_theatre_leak";
  }
  if (/(torrent|magnet|1337x|yts|rarbg)/.test(t)) return "torrent";
  if (/(t\.me|telegram)/.test(t)) return "telegram_channel";
  if (/(hdrip|webrip|web[- ]?dl|dvdrip|bluray|480p|720p|1080p|\.mkv|\.mp4)/.test(t)) {
    return "ripped_copy";
  }
  if (/(watch\s*full\s*movie|free\s*stream|full\s*movie\s*online|streaming\s*server)/.test(t)) {
    return "streaming_site";
  }
  if (/(download\s*full\s*movie|file\s*host|drive\.google|mega\.nz|mediafire)/.test(t)) {
    return "file_sharing";
  }
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

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  pageLeads: PageLead[];
  queriesGenerated: number;
  queriesExecuted: number;
  providerSuccesses: number;
  providerRequests: number;
  providerFailures: number;
  providerFailuresByCategory: Record<ProviderFailureCategory, number>;
  providerFailureSamples: Array<{ query: string; category: string; detail: string }>;
  firecrawl_requests: number;
  firecrawl_successes: number;
  firecrawl_failures: number;
  firecrawl_circuit_opened: boolean;
  firecrawl_circuit_reason: string | null;
  firecrawl_operator_action: string | null;
  firecrawl_stopped_early: boolean;
  firecrawl_stopped_early_reason: string | null;
  discovery_saturation: DiscoverySaturationMetrics;
  candidates_by_provider: Record<string, number>;
  telegram_queries: number;
  telegram_posts: number;
  telegram_candidates: number;
  telegram_failures: number;
  telegram_requests: number;
  firecrawl_env_diagnostic: FirecrawlEnvironmentDiagnostic;
}

/**
 * Discover candidate re-uploads with Firecrawl, seeded by the AI-vision
 * analysis of the reference frame.
 */
export async function firecrawlDiscover(
  referenceDataUrl: string,
  workTitle: string,
  frameIndex: number,
  analysisOrOptions?: ReferenceAnalysis | FirecrawlDiscoverOptions,
  maybeOptions?: FirecrawlDiscoverOptions,
): Promise<DiscoveryResult> {
  const options: FirecrawlDiscoverOptions =
    analysisOrOptions && "signal" in analysisOrOptions
      ? (analysisOrOptions as FirecrawlDiscoverOptions)
      : (maybeOptions ?? {});
  const analysis =
    analysisOrOptions && !("signal" in analysisOrOptions)
      ? (analysisOrOptions as ReferenceAnalysis)
      : options.analysis;

  const emptyFirecrawl = (reason: string, category: ProviderFailureCategory): DiscoveryResult => ({
    candidates: [],
    pageLeads: [],
    queriesGenerated: 0,
    queriesExecuted: 0,
    providerSuccesses: 0,
    providerRequests: 0,
    providerFailures: category === "missing_api_key" ? 1 : 0,
    providerFailuresByCategory: {
      ...emptyProviderFailureCounts(),
      ...(category === "missing_api_key" ? { missing_api_key: 1 } : {}),
    },
    providerFailureSamples: reason
      ? [{ query: "", category, detail: reason }]
      : [],
    firecrawl_requests: 0,
    firecrawl_successes: 0,
    firecrawl_failures: category === "missing_api_key" ? 1 : 0,
    firecrawl_circuit_opened: false,
    firecrawl_circuit_reason: null,
    firecrawl_operator_action: null,
    firecrawl_stopped_early: false,
    firecrawl_stopped_early_reason: null,
    discovery_saturation: buildSaturationMetrics({
      state: emptyDiscoveryCoverageState(),
      stoppedLowPriorityQueries: 0,
      providersExhausted: false,
    }),
    candidates_by_provider: {},
    telegram_queries: 0,
    telegram_posts: 0,
    telegram_candidates: 0,
    telegram_failures: 0,
    telegram_requests: 0,
    firecrawl_env_diagnostic: firecrawlEnvironmentDiagnostic(),
  });

  if (!isFirecrawlConfigured()) {
    return emptyFirecrawl(
      "Firecrawl is not configured for copyright discovery.",
      "missing_api_key",
    );
  }

  const a = analysis ?? (await analyzeReference(referenceDataUrl, workTitle));
  const staged = buildStagedDiscoveryQueries(a, workTitle);
  const extraPlans: QueryPlan[] = (options.extraQueryStrings ?? [])
    .map((q) => q.trim())
    .filter(Boolean)
    .map((query) => ({
      query,
      recent: true,
      stage: 2 as const,
    }));
  const firecrawlDeadlineAt =
    options.deadlineAt ??
    Math.min(Date.now() + FIRECRAWL_PROVIDER_BUDGET_MS, Date.now() + PROVIDER_CRAWL_BUDGET_MS);

  const seen = new Set<string>();
  const out: DiscoveryCandidate[] = [];
  const strongLeads: Array<{ url: string; title: string | null; query: string; text: string }> = [];
  const weakLeads: Array<{ url: string; title: string | null; query: string; text: string }> = [];
  const providerFailuresByCategory = emptyProviderFailureCounts();
  const providerFailureSamples: Array<{ query: string; category: string; detail: string }> = [];
  let telegramQueries = 0;
  let telegramPosts = 0;
  let telegramCandidates = 0;
  let telegramFailures = 0;
  let telegramRequests = 0;

  const uniquePageKeys = new Set<string>();
  const countUniquePages = (attempts: ProviderSearchAttempt[]) => {
    for (const attempt of attempts) {
      if (!attempt.ok || !attempt.payload) continue;
      for (const img of attempt.payload.data?.images ?? []) {
        const page = img.url ?? img.sourceUrl;
        if (page) uniquePageKeys.add(canonicalUrl(page));
      }
      for (const web of attempt.payload.data?.web ?? []) {
        if (web.url) uniquePageKeys.add(canonicalUrl(web.url));
      }
    }
    return uniquePageKeys.size;
  };

  const progressSeen = new Set<string>();
  const imageSeen = new Set<string>();
  const emitDiscoveryProgress = async (
    attemptSlice: ProviderSearchAttempt[],
    totals: {
      requests: number;
      successes: number;
      failures: number;
      uniquePages: number;
    },
  ) => {
    if (!options.onProgress) return;
    const leads: DiscoveryProgress["leads"] = [];
    const referenceImages: DiscoveryProgress["referenceImages"] = [];
    for (const attempt of attemptSlice) {
      const chunk = extractAttemptProgress(attempt, progressSeen, imageSeen);
      leads.push(...chunk.leads);
      referenceImages.push(...chunk.referenceImages);
    }
    await options.onProgress({
      queriesGenerated,
      queriesExecuted: totals.requests,
      providerSuccesses: totals.successes,
      providerFailures: totals.failures,
      uniquePages: totals.uniquePages,
      leads,
      referenceImages,
    });
  };

  const batchedAttempts: ProviderSearchAttempt[] = [];
  let batchedCircuit = emptyDiscoveryCircuit();
  let batchedStoppedEarly = false;
  let batchedStoppedEarlyReason: string | null = null;
  let stoppedLowPriorityQueries = 0;
  let coverageState = emptyDiscoveryCoverageState();
  let queriesGenerated = staged.totalUniqueQueries + extraPlans.length;

  const runStageBatch = async (stagePlans: QueryPlan[], stage: 1 | 2 | 3) => {
    if (shouldSkipStageExpansion(stage, coverageState)) return;
    const mode = resolveDiscoveryMode(coverageState.uniqueCandidateUrls);
    const telegramPlans = stagePlans.filter((p) => /\btelegram\b/i.test(p.query));
    const webPlans = stagePlans.filter((p) => !/\btelegram\b/i.test(p.query));
    const basePlans = [...webPlans, ...telegramPlans].slice(0, MAX_DISCOVERY_QUERIES_PER_SCAN);
    const plans = expandPlansForDiscoveryMode(
      basePlans,
      mode,
      FIRECRAWL_PRIORITY_QUERY_PAGES,
    );
    const batched = await runBatchedDiscovery({
      plans,
      signal: options.signal,
      deadlineAt: firecrawlDeadlineAt,
      earlyStopUniquePages: DISCOVERY_EARLY_STOP_UNIQUE_PAGES,
      stopWhenUniquePagesAtLeast: MAX_DISCOVERY_CANDIDATES,
      uniquePageCount: countUniquePages,
      shouldIssuePlan: (plan) =>
        shouldIssueDiscoveryPlan(plan as QueryPlan, coverageState).issue,
      onPlanSkipped: () => {
        stoppedLowPriorityQueries += 1;
      },
      execute: (plan, signal) =>
        search(plan.query, plan.recent, signal, firecrawlDeadlineAt, plan.page ?? 1),
      onAttempt: options.onProgress
        ? async (attempt, totals) => {
            await emitDiscoveryProgress([attempt], totals);
          }
        : undefined,
    });
    for (const attempt of batched.attempts) {
      const matchedPlan = plans.find((p) => p.query === attempt.query);
      if (matchedPlan) {
        coverageState = recordQueryCategoryFromPlan(coverageState, matchedPlan);
      }
    }
    coverageState = buildCoverageStateFromPageKeys(uniquePageKeys, coverageState);
    for (const attempt of batched.attempts) {
      const matchedPlan = plans.find((p) => p.query === attempt.query);
      if (matchedPlan) {
        coverageState = recordCompletedDiscoveryQuery(
          coverageState,
          matchedPlan,
          attempt.ok,
        );
      }
    }
    batchedAttempts.push(...batched.attempts);
    stoppedLowPriorityQueries += batched.skippedPlans;
    batchedCircuit = batched.circuit;
    if (batched.stoppedEarly) {
      batchedStoppedEarly = true;
      batchedStoppedEarlyReason = batched.stoppedEarlyReason;
    }
    return batched;
  };

  if (extraPlans.length) {
    await runStageBatch(extraPlans, 2);
  }

  for (const block of staged.stages) {
    if (isPastDiscoveryDeadline(firecrawlDeadlineAt)) break;
    if (coverageState.uniqueCandidateUrls >= MAX_DISCOVERY_CANDIDATES) break;
    await runStageBatch(block.plans, block.stage);
  }

  coverageState = buildCoverageStateFromPageKeys(uniquePageKeys, coverageState);
  const stopReason = batchedStoppedEarlyReason ?? "";
  const discoverySaturation = buildSaturationMetrics({
    state: coverageState,
    stoppedLowPriorityQueries,
    providersExhausted: batchedStoppedEarly
      ? /deadline|Safety cap|circuit/i.test(stopReason)
      : true,
  });

  const results = batchedAttempts;
  let providerSuccesses = 0;
  let providerFailures = 0;

  for (const attempt of results) {
    const { query, payload } = attempt;
    const isTelegramQuery = /\btelegram\b/i.test(query);
    if (isTelegramQuery) {
      telegramQueries += 1;
      telegramRequests += 1;
    }

    if (!attempt.ok) {
      providerFailures += 1;
      const cat = attempt.failureCategory ?? "provider_unavailable";
      bumpProviderFailure(providerFailuresByCategory, cat);
      if (providerFailureSamples.length < 8) {
        providerFailureSamples.push({
          query: query.slice(0, 120),
          category: cat,
          detail: attempt.failureDetail ?? "Provider request failed",
        });
      }
      if (isTelegramQuery) telegramFailures += 1;
      continue;
    }

    providerSuccesses += 1;
    for (const img of payload?.data?.images ?? []) {
      const page = img.url ?? img.sourceUrl;
      const image = img.imageUrl ?? img.thumbnailUrl;
      if (!page || !image) continue;
      const key = canonicalUrl(page);
      if (seen.has(key)) continue;
      seen.add(key);
      // Official studios, licensed streamers, databases, news and reviews are
      // legitimate references — never report them as unauthorized copies.
      if (isExcludedHost(key)) continue;
      const text = `${img.title ?? ""} ${key}`;
      const websiteType = websiteTypeFor(key, `${text} ${query}`);
      out.push({
        url: key,
        title: img.title ?? null,
        source: hostOf(key),
        thumbnail: img.thumbnailUrl ?? image,
        imageUrl: image,
        exact: PIRACY_HINTS.test(text) || isSuspiciousType(websiteType),
        frameIndex,
        query,
        category: piracyCategory(`${text} ${query}`),
        language: detectLanguage(text, a),
        keywordMatch: query,
        websiteType,
      });
    }

    for (const web of payload?.data?.web ?? []) {
      if (!web.url) continue;
      const key = canonicalUrl(web.url);
      if (seen.has(key)) continue;
      seen.add(key);
      if (isExcludedHost(key)) continue;
      const text = `${web.title ?? ""} ${web.description ?? ""} ${key}`;
      const category = piracyCategory(`${text} ${query}`);
      const piracySignal = PIRACY_HINTS.test(text);
      const softNegative =
        /(review|recap|explained|reaction|opinion|box office|interview|press release|now showing|showtimes?|book tickets?)/i.test(
          text,
        );
      // Drop pure cinema/trailer/review/showtime noise, but keep mixed-signal
      // leads (e.g. “now showing online” + cam/torrent/download language).
      if (
        !piracySignal &&
        (softNegative ||
          category === "cinema_or_showtime" ||
          category === "trailer_or_promo" ||
          category === "review_or_news")
      ) {
        continue;
      }
      const lead = { url: key, title: web.title ?? null, query, text };
      if (isTelegramQuery) {
        telegramPosts += 1;
        // Public Telegram pages only — private/joinchat filtered later at evidence gates.
        if (!/(t\.me|telegram\.me)\//i.test(key)) {
          // Non-telegram host from a telegram query still allowed as web lead.
        } else {
          telegramCandidates += 1;
        }
      }
      if (piracySignal || isSuspiciousType(websiteTypeFor(key, `${text} ${query}`))) strongLeads.push(lead);
      else weakLeads.push(lead);
    }
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

  // Image-result page URLs with piracy/suspicious signals must also enter the
  // exact-page distribution crawler (identity grading alone is never enough).
  const imagePageLeads: PageLead[] = out
    .filter(
      (c) =>
        c.exact ||
        c.websiteType === "unauthorized_streaming" ||
        c.websiteType === "download_page" ||
        c.websiteType === "file_host" ||
        c.websiteType === "torrent_index" ||
        c.category === "cam_theatre_leak" ||
        c.category === "streaming_site" ||
        c.category === "torrent" ||
        c.category === "file_sharing",
    )
    .map((c) => ({
      url: c.url,
      title: c.title,
      query: c.query ?? "",
      text: `${c.title ?? ""} ${c.url} ${c.category ?? ""}`,
      strong: true,
    }));

  // Page-level leads feed the distribution-site inspector (player/download/
  // mirror/file-link evidence), independent of whether a screenshot succeeded.
  const leadSeen = new Set<string>();
  const pageLeads: PageLead[] = [];
  for (const lead of [
    ...strongLeads.map((l) => ({ ...l, title: l.title ?? null, strong: true as const })),
    ...imagePageLeads,
    ...weakLeads.slice(0, 40).map((l) => ({ ...l, title: l.title ?? null, strong: false as const })),
  ]) {
    const key = canonicalUrl(lead.url);
    if (leadSeen.has(key)) continue;
    leadSeen.add(key);
    pageLeads.push({ ...lead, url: key });
    // Keep Firecrawl page leads aligned with the scan crawl cap — never stall at ~3/48.
    if (pageLeads.length >= DEFAULT_PAGE_CAP) break;
  }

  // Suspicious distribution sources first, official-looking noise never here.
  return {
    candidates: out.sort((x, y) => Number(y.exact) - Number(x.exact)).slice(0, 60),
    pageLeads,
    queriesGenerated,
    queriesExecuted: results.length,
    providerSuccesses,
    providerRequests: results.length,
    providerFailures,
    providerFailuresByCategory,
    providerFailureSamples,
    firecrawl_requests: results.length,
    firecrawl_successes: providerSuccesses,
    firecrawl_failures: providerFailures,
    firecrawl_circuit_opened: batchedCircuit.opened,
    firecrawl_circuit_reason: batchedCircuit.openedReason,
    firecrawl_operator_action: batchedCircuit.operatorAction,
    firecrawl_stopped_early: batchedStoppedEarly,
    firecrawl_stopped_early_reason: batchedStoppedEarlyReason,
    discovery_saturation: discoverySaturation,
    candidates_by_provider: {
      firecrawl: pageLeads.length,
      telegram: telegramCandidates,
    },
    telegram_queries: telegramQueries,
    telegram_posts: telegramPosts,
    telegram_candidates: telegramCandidates,
    telegram_failures: telegramFailures,
    telegram_requests: telegramRequests,
    firecrawl_env_diagnostic: firecrawlEnvironmentDiagnostic(),
  };
}
