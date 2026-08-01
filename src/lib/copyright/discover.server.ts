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
import { queryTitleVariants } from "./title-identity";
import {
  bumpProviderFailure,
  classifyProviderFailure,
  emptyProviderFailureCounts,
  sanitizeProviderFailureDetail,
  type ProviderFailureCategory,
} from "./provider-failures";

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
interface FcResponse { data?: { web?: FcWeb[]; images?: FcImage[] }; error?: string }

export interface ProviderSearchAttempt {
  query: string;
  payload: FcResponse | null;
  ok: boolean;
  failureCategory?: ProviderFailureCategory;
  failureDetail?: string;
  httpStatus?: number | null;
}

async function search(query: string, recent: boolean): Promise<ProviderSearchAttempt> {
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
  try {
    const res = await firecrawlFetch("/search", {
      query,
      limit: 10,
      sources: ["web", "images"],
      ...(recent ? { tbs: "qdr:m" } : {}),
    });
    if (!res.ok) {
      return {
        query,
        payload: null,
        ok: false,
        failureCategory: classifyProviderFailure({ status: res.status, configured: true }),
        failureDetail: sanitizeProviderFailureDetail(`Firecrawl search HTTP ${res.status}`),
        httpStatus: res.status,
      };
    }
    try {
      const payload = (await res.json()) as FcResponse;
      // Treat empty-but-valid payloads as success (genuine zero candidates possible).
      return { query, payload, ok: true, httpStatus: res.status };
    } catch (e) {
      return {
        query,
        payload: null,
        ok: false,
        failureCategory: "malformed_response",
        failureDetail: sanitizeProviderFailureDetail(e),
        httpStatus: res.status,
      };
    }
  } catch (e) {
    return {
      query,
      payload: null,
      ok: false,
      failureCategory: classifyProviderFailure({ error: e, configured: true }),
      failureDetail: sanitizeProviderFailureDetail(e),
      httpStatus: null,
    };
  }
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

/** Optional discovery seed domains for regression / focused hunting — never auto-guilty. */
const OPTIONAL_SEED_DOMAINS = ["ogomovies1.com.pk"];

/**
 * Focused exact-title piracy queries. Never search using generic title tokens alone.
 * Exported for regression tests.
 */
export function buildQueries(a: ReferenceAnalysis, workTitle: string): QueryPlan[] {
  const primary = (a.title || workTitle).trim();
  if (!primary) return [];
  const year = a.releaseDate?.slice(0, 4) || null;
  // Quoted exact-title variants (user title + AI title + alt + compound splits).
  const names = queryTitleVariants(primary, [
    workTitle,
    a.title ?? "",
    ...a.altTitles,
  ]).slice(0, 6);
  const base = names[0] ?? primary;

  const age = daysSince(a.releaseDate);
  const isFresh = age !== null && age <= 30;

  // Focused distribution phrases — never bare title / generic tokens alone.
  const general = [
    "watch online",
    "watch full movie",
    "full movie",
    "download",
    "stream",
    "server",
    "CAM",
    "HDCAM",
    "HDTS",
    "theatre print",
    "WEB-DL",
    "WEBRip",
    "torrent",
    "magnet",
    "telegram",
    "file host",
    "video host",
    "streaming server",
    "mega.nz",
    "mediafire",
    "free streaming",
    "hdcam download",
    "dubbed",
  ];
  const fresh = [
    "theatre print online",
    "cinema recording leak",
    "same day leak",
    "hdcam 720p download",
    "first day print online",
    "full movie leaked",
  ];

  const NEG =
    "-site:imdb.com -site:wikipedia.org -site:rottentomatoes.com -site:netflix.com -site:primevideo.com -site:hotstar.com -site:voxcinemas.com -site:bookmyshow.com -site:fandango.com -\"box office\" -showtimes -\"now showing\"";

  const plans: QueryPlan[] = [];
  const push = (query: string, recent = false) => {
    // Refuse queries that are only the bare title / tokens.
    const trimmed = query.replace(NEG, "").trim().replace(/^"|"$/g, "");
    if (!trimmed || trimmed === base || names.some((n) => trimmed === n || trimmed === `"${n}"`)) {
      return;
    }
    plans.push({ query, recent });
  };

  // Core phrases against the primary quoted title.
  for (const term of general) push(`"${base}" ${term} ${NEG}`, isFresh);

  // Verified alternate / compound title variants (bounded).
  for (const n of names.slice(1, 4)) {
    push(`"${n}" watch full movie ${NEG}`, isFresh);
    push(`"${n}" download ${NEG}`, isFresh);
    push(`"${n}" watch online ${NEG}`, isFresh);
    push(`"${n}" torrent magnet ${NEG}`, isFresh);
    if (year) push(`"${n}" ${year} full movie ${NEG}`, isFresh);
  }

  if (year) {
    push(`"${base}" ${year} watch full movie ${NEG}`, isFresh);
    push(`"${base}" ${year} download ${NEG}`, isFresh);
    push(`"${base}" ${year} stream ${NEG}`, isFresh);
  }

  if (isFresh || !a.releaseDate) {
    for (const term of fresh) push(`"${base}" ${term} ${NEG}`, true);
  }

  const langs = [a.language, ...a.audienceLanguages].filter(Boolean) as string[];
  for (const term of localTermsFor(langs).slice(0, 8)) {
    push(`"${base}" ${term}`, isFresh);
  }
  if (a.language) push(`"${base}" ${a.language} dubbed watch online ${NEG}`, isFresh);

  // Actor queries always keep the exact quoted title — never actor alone.
  for (const actor of a.actors.slice(0, 2)) {
    push(`"${base}" ${actor} download full movie ${NEG}`, isFresh);
  }

  // Optional seed domains early so the bounded query budget cannot drop them.
  // Discovery only — every result still needs exact-page evidence.
  for (const seed of OPTIONAL_SEED_DOMAINS) {
    push(`"${base}" site:${seed}`, isFresh);
    for (const n of names.slice(1, 3)) push(`"${n}" site:${seed}`, isFresh);
  }

  push(`"${base}" full movie ${PIRACY_SITE_FILTER}`, isFresh);
  push(`"${base}" ${FILE_HOST_FILTER}`, isFresh);
  push(`"${base}" ${STREAM_SITE_FILTER}`, isFresh);
  push(`"${base}" torrent magnet ${NEG}`, isFresh);
  push(`"${base}" telegram full movie ${NEG}`, isFresh);

  const seen = new Set<string>();
  return plans
    .filter((p) => p.query.trim() && !seen.has(p.query) && seen.add(p.query))
    .slice(0, 40);
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
  /** page-level leads for distribution-site inspection */
  pageLeads: PageLead[];
  queriesGenerated: number;
  /** Queries for which a provider request was attempted. */
  queriesExecuted: number;
  /** Provider requests that returned a usable response body. */
  providerSuccesses: number;
  providerRequests: number;
  providerFailures: number;
  providerFailuresByCategory: Record<ProviderFailureCategory, number>;
  providerFailureSamples: Array<{ query: string; category: string; detail: string }>;
  /** Optional Telegram discovery counters (isolated; failures never abort web). */
  telegramQueries: number;
  telegramPosts: number;
  telegramCandidates: number;
  telegramFailures: number;
}

/**
 * Discover candidate re-uploads with Firecrawl, seeded by the AI-vision
 * analysis of the reference frame.
 */
export async function firecrawlDiscover(
  referenceDataUrl: string,
  workTitle: string,
  frameIndex: number,
  analysis?: ReferenceAnalysis,
): Promise<DiscoveryResult> {

  if (!isFirecrawlConfigured()) {
    const err = new Error(
      "Reverse discovery is not configured. Connect Firecrawl (FIRECRAWL_API_KEY) to run copyright detection.",
    );
    (err as Error & { failureCategory?: ProviderFailureCategory }).failureCategory =
      "missing_api_key";
    throw err;
  }

  const a = analysis ?? (await analyzeReference(referenceDataUrl, workTitle));
  const allPlans = buildQueries(a, workTitle);
  // Keep Telegram queries optional/isolated — never let them starve or abort web discovery.
  const telegramPlans = allPlans.filter((p) => /\btelegram\b/i.test(p.query));
  const webPlans = allPlans.filter((p) => !/\btelegram\b/i.test(p.query));
  const plans = [...webPlans, ...telegramPlans].slice(0, 40);
  const queriesGenerated = plans.length;

  const seen = new Set<string>();
  const out: DiscoveryCandidate[] = [];
  const strongLeads: Array<{ url: string; title: string | null; query: string; text: string }> = [];
  const weakLeads: Array<{ url: string; title: string | null; query: string; text: string }> = [];
  const providerFailuresByCategory = emptyProviderFailureCounts();
  const providerFailureSamples: Array<{ query: string; category: string; detail: string }> = [];
  let providerSuccesses = 0;
  let providerFailures = 0;
  let telegramQueries = 0;
  let telegramPosts = 0;
  let telegramCandidates = 0;
  let telegramFailures = 0;

  const results = await Promise.all(plans.map((p) => search(p.query, p.recent)));

  for (const attempt of results) {
    const { query, payload } = attempt;
    const isTelegramQuery = /\btelegram\b/i.test(query);
    if (isTelegramQuery) telegramQueries += 1;

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
    ...weakLeads.slice(0, 12).map((l) => ({ ...l, title: l.title ?? null, strong: false as const })),
  ]) {
    const key = canonicalUrl(lead.url);
    if (leadSeen.has(key)) continue;
    leadSeen.add(key);
    pageLeads.push({ ...lead, url: key });
    if (pageLeads.length >= 48) break;
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
    telegramQueries,
    telegramPosts,
    telegramCandidates,
    telegramFailures,
  };
}

