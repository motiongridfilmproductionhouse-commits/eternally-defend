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

async function search(query: string, recent: boolean): Promise<{ query: string; payload: FcResponse | null }> {
  try {
    const res = await firecrawlFetch("/search", {
      query,
      limit: 10,
      sources: ["web", "images"],
      ...(recent ? { tbs: "qdr:m" } : {}),
    });
    if (!res.ok) return { query, payload: null };
    return { query, payload: (await res.json()) as FcResponse };
  } catch {
    return { query, payload: null };
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
  const base = (a.title || workTitle).trim();
  if (!base) return [];
  const year = a.releaseDate?.slice(0, 4) || null;
  const names = [...new Set([base, ...a.altTitles].filter(Boolean))].slice(0, 4);

  const age = daysSince(a.releaseDate);
  const isFresh = age !== null && age <= 30;

  // Focused distribution phrases — never bare title / generic tokens alone.
  const general = [
    "watch full movie",
    "download full movie",
    "online free",
    "CAM",
    "HDTS",
    "theatre print",
    "WEB-DL",
    "WEBRip",
    "torrent",
    "magnet",
    "telegram",
    "file host",
    "streaming server",
    "mega.nz",
    "mediafire",
    "free streaming",
    "hdcam download",
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
    "-site:imdb.com -site:wikipedia.org -site:rottentomatoes.com -site:netflix.com -site:primevideo.com -site:hotstar.com -site:voxcinemas.com -site:bookmyshow.com -site:fandango.com -review -trailer -\"box office\" -showtimes -\"now showing\" -news";

  const plans: QueryPlan[] = [];
  const push = (query: string, recent = false) => {
    // Refuse queries that are only the bare title / tokens.
    const trimmed = query.replace(NEG, "").trim();
    if (trimmed === `"${base}"` || trimmed === base) return;
    plans.push({ query, recent });
  };

  for (const term of general) push(`"${base}" ${term} ${NEG}`, isFresh);
  if (year) {
    push(`"${base}" ${year} watch full movie ${NEG}`, isFresh);
    push(`"${base}" ${year} download ${NEG}`, isFresh);
  }

  if (isFresh || !a.releaseDate) {
    for (const term of fresh) push(`"${base}" ${term} ${NEG}`, true);
  }

  for (const n of names.slice(1)) {
    push(`"${n}" watch full movie ${NEG}`, isFresh);
    push(`"${n}" download full movie ${NEG}`, isFresh);
    push(`"${n}" torrent magnet ${NEG}`, isFresh);
  }

  const langs = [a.language, ...a.audienceLanguages].filter(Boolean) as string[];
  for (const term of localTermsFor(langs).slice(0, 8)) {
    push(`"${base}" ${term}`, isFresh);
  }
  if (a.language) push(`"${base}" ${a.language} watch full movie ${NEG}`, isFresh);

  // Actor queries always keep the exact quoted title — never actor alone.
  for (const actor of a.actors.slice(0, 2)) {
    push(`"${base}" ${actor} download full movie ${NEG}`, isFresh);
  }
  if (a.releaseDate) {
    push(`"${base}" ${a.releaseDate.slice(0, 4)} WEBRip download ${NEG}`, isFresh);
  }

  push(`"${base}" full movie ${PIRACY_SITE_FILTER}`, isFresh);
  push(`"${base}" ${FILE_HOST_FILTER}`, isFresh);
  push(`"${base}" ${STREAM_SITE_FILTER}`, isFresh);
  push(`"${base}" torrent magnet ${NEG}`, isFresh);
  push(`"${base}" telegram full movie ${NEG}`, isFresh);

  // Optional seed domains — discovery only; every result still needs exact-page evidence.
  for (const seed of OPTIONAL_SEED_DOMAINS) {
    push(`"${base}" site:${seed}`, isFresh);
  }

  const seen = new Set<string>();
  return plans
    .filter((p) => p.query.trim() && !seen.has(p.query) && seen.add(p.query))
    .slice(0, 36);
}

/**
 * Coarse discovery taxonomy for ranking leads only.
 * Never treat bare "cinema"/"theater" (showtimes) as theatre-print piracy.
 */
export function piracyCategory(text: string): string {
  const t = text.toLowerCase();
  // Hard negatives first — cinema booking / showtimes are not distribution.
  if (/\b(now\s*showing|showtimes?|book\s*tickets?|buy\s*tickets?|vox\s*cinemas)\b/.test(t)) {
    return "cinema_or_showtime";
  }
  if (/\b(official\s*trailer|teaser\s*trailer|song\s*video)\b/.test(t)) return "trailer_or_promo";
  if (/\b(movie\s*review|film\s*review|box\s*office|interview)\b/.test(t)) return "review_or_news";
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
  queriesExecuted: number;
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
    throw new Error(
      "Reverse discovery is not configured. Connect Firecrawl to run copyright detection.",
    );
  }

  const a = analysis ?? (await analyzeReference(referenceDataUrl, workTitle));
  const plans = buildQueries(a, workTitle);
  const queriesGenerated = plans.length;

  const seen = new Set<string>();
  const out: DiscoveryCandidate[] = [];
  const strongLeads: Array<{ url: string; title: string | null; query: string; text: string }> = [];
  const weakLeads: Array<{ url: string; title: string | null; query: string; text: string }> = [];

  const results = await Promise.all(plans.map((p) => search(p.query, p.recent)));

  for (const { query, payload } of results) {
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
      // Reviews / commentary / cinema showtimes are not distribution sources.
      if (/(review|recap|explained|reaction|opinion|box office|interview|press release|now showing|showtimes?|book tickets?)/i.test(text)) continue;
      const category = piracyCategory(`${text} ${query}`);
      const piracySignal = PIRACY_HINTS.test(text);
      // Drop pure cinema/trailer/review noise, but keep mixed-signal leads
      // (e.g. snippet mentions showtimes AND cam/torrent/download language).
      if (
        !piracySignal &&
        (category === "cinema_or_showtime" ||
          category === "trailer_or_promo" ||
          category === "review_or_news")
      ) {
        continue;
      }
      const lead = { url: key, title: web.title ?? null, query, text };
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
    queriesGenerated,
    queriesExecuted: results.length,
  };
}

