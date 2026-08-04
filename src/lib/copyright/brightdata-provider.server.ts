/**
 * Bright Data SERP API discovery provider — Copyright Intelligence only.
 *
 * Server-side only. Discovery-only: every hit is a *candidate* lead that must
 * still pass the existing exact-page crawl, exact-title identity, access
 * evidence, official-domain filtering and client-visible gates before it can
 * ever be reported as infringement.
 *
 * Product: Bright Data SERP API (POST https://api.brightdata.com/request with
 * `Authorization: Bearer <BRIGHT_DATA_API_KEY>` and a SERP `zone`).
 * Docs: https://docs.brightdata.com/api-reference/rest-api/serp/serp-api
 *
 * Secrets are never logged, persisted or returned — diagnostics expose only
 * presence and length.
 */

import { queryTitleVariants } from "./title-identity";
import type { ReferenceAnalysis, PageLead } from "./discover.server";
import { canonicalUrl, isExcludedHost } from "./url.server";
import {
  isAbortError,
  isPastDiscoveryDeadline,
  sleepWithAbort,
} from "./discovery-runtime";
import {
  bumpProviderFailure,
  emptyProviderFailureCounts,
  sanitizeProviderFailureDetail,
  type ProviderFailureCategory,
} from "./provider-failures";

export const BRIGHTDATA_ENDPOINT = "https://api.brightdata.com/request";
export const BRIGHTDATA_DEFAULT_ZONE = "serp_api1";
export { BRIGHTDATA_MAX_QUERIES_PER_SCAN } from "./discovery-config";
import { BRIGHTDATA_MAX_QUERIES_PER_SCAN } from "./discovery-config";
export const BRIGHTDATA_MAX_UNIQUE_PAGES = 100;
export const BRIGHTDATA_MAX_RETRIES = 1;
export const BRIGHTDATA_REQUEST_TIMEOUT_MS = 15_000;

export interface BrightDataDiagnostic {
  configured: boolean;
  api_key_present: boolean;
  api_key_length: number;
  zone_present: boolean;
  /** True when the configured zone env value is not a valid zone name. */
  zone_env_invalid?: boolean;
  zone: string;
  endpoint: string;
}

export interface BrightDataDiscoveryHit {
  url: string;
  title: string | null;
  text: string;
  query: string;
  /** SERP metadata (discovery only — never used as evidence). */
  snippet: string | null;
  rank: number | null;
  domain: string | null;
  /** Organic SERP thumbnail when returned by Bright Data (carousel only). */
  imageUrl: string | null;
  provider: "bright_data";
  discoveredAt: string;
}


export interface BrightDataDiscoveryResult {
  provider: "brightdata";
  configured: boolean;
  hits: BrightDataDiscoveryHit[];
  pageLeads: PageLead[];
  queriesGenerated: number;
  requests: number;
  successes: number;
  failures: number;
  candidates: number;
  duplicatesDropped: number;
  failuresByCategory: Record<ProviderFailureCategory, number>;
  failureSamples: Array<{ query: string; category: ProviderFailureCategory; detail: string }>;
  diagnostic: BrightDataDiagnostic;
}

function apiKey(): string {
  return (process.env.BRIGHT_DATA_API_KEY ?? "").trim();
}

/**
 * Bright Data zone names are lowercase alphanumeric/underscore identifiers
 * (e.g. `serp_api1`). Some accounts store a UUID (customer/zone id) in the env
 * var, which the API rejects with `zone "<uuid>" not found`, so anything that
 * is not a valid zone name is ignored in favour of the default SERP zone.
 */
const ZONE_NAME_RE = /^[a-z0-9_]{2,64}$/;

function rawZoneEnv(): string {
  return (process.env.BRIGHT_DATA_SERP_ZONE ?? process.env.BRIGHT_DATA_ZONE ?? "").trim();
}

function zone(): string {
  const raw = rawZoneEnv();
  return ZONE_NAME_RE.test(raw) ? raw : BRIGHTDATA_DEFAULT_ZONE;
}

export function isBrightDataConfigured(): boolean {
  return apiKey().length > 0;
}

/** Safe diagnostics: presence + length only, never the secret value. */
export function brightDataDiagnostic(): BrightDataDiagnostic {
  const key = apiKey();
  const z = zone();
  const raw = rawZoneEnv();
  return {
    configured: key.length > 0,
    api_key_present: key.length > 0,
    api_key_length: key.length,
    zone_present: Boolean(raw),
    zone_env_invalid: Boolean(raw) && !ZONE_NAME_RE.test(raw),
    zone: z,
    endpoint: BRIGHTDATA_ENDPOINT,
  };
}


/**
 * Exact quoted-title distribution queries only — never bare tokens.
 * Enriched with release year, language, alternate/transliterated titles and
 * lead cast when the reference analysis provides them, so unrelated
 * same-name collisions stay out of the candidate set.
 */
export function buildBrightDataQueries(
  analysis: ReferenceAnalysis,
  workTitle: string,
  maxQueries = BRIGHTDATA_MAX_QUERIES_PER_SCAN,
): string[] {
  const primary = (analysis.title || workTitle).trim();
  if (!primary) return [];
  const names = queryTitleVariants(primary, [
    workTitle,
    analysis.title ?? "",
    ...analysis.altTitles,
  ]).slice(0, 4);

  const year = (analysis.releaseDate ?? "").slice(0, 4);
  const language = (analysis.language ?? "").trim();
  const actor = (analysis.actors?.[0] ?? "").trim();
  const qualifiers = [year, language].filter(Boolean).join(" ");

  const phrases = [
    "watch online full movie free",
    "full movie download",
    "streaming online free",
    "torrent magnet download",
    "CAM print HDCAM theatre print leak",
    "WEBRip WEB-DL HDRip full movie",
    "full movie telegram link",
  ] as const;

  const out: string[] = [];
  const push = (value: string) => {
    const q = value.replace(/\s+/g, " ").trim();
    if (q && !out.includes(q)) out.push(q);
  };

  for (const name of names) {
    const quoted = `"${name.replaceAll('"', "").trim()}"`;
    for (const phrase of phrases) {
      push(`${quoted} ${qualifiers} ${phrase}`);
      if (out.length >= maxQueries) return out.slice(0, maxQueries);
    }
    if (actor) {
      push(`${quoted} ${actor} full movie download`);
      if (out.length >= maxQueries) return out.slice(0, maxQueries);
    }
  }

  // Pirate-site and Telegram targeted sweeps for the primary title. These are
  // still discovery-only: every hit must pass the exact-page crawl, exact-title
  // identity and access-evidence gates before it can surface as a finding.
  const primaryQuoted = `"${primary.replaceAll('"', "").trim()}"`;
  for (const targeted of [
    `${primaryQuoted} ${qualifiers} site:t.me full movie`,
    `${primaryQuoted} ${qualifiers} telegram channel movie download link`,
    ...PIRACY_SITE_CLUSTERS.map(
      (cluster) => `${primaryQuoted} ${qualifiers} (${cluster.join(" OR ")})`,
    ),
    `${primaryQuoted} ${qualifiers} "watch online" 720p 1080p free hd movie`,
    `${primaryQuoted} ${qualifiers} filmyzilla movierulz ibomma tamilrockers download`,
  ]) {
    push(targeted);
    if (out.length >= maxQueries) return out.slice(0, maxQueries);
  }

  return out.slice(0, maxQueries);
}

/**
 * Known unauthorized-distribution site families used only to steer SERP
 * discovery towards piracy hosts. Presence in this list is never evidence.
 */
export const PIRACY_SITE_CLUSTERS: readonly string[][] = [
  ["ogomovies", "einthusan", "movierulz", "ibomma", "tamilrockers", "filmyzilla"],
  ["bilibili", "dailymotion", "archive.org", "ok.ru", "rumble"],
  ["terabox", "mega.nz", "pixeldrain", "google drive", "mediafire"],
  ["123movies", "fmovies", "soap2day", "putlocker", "gomovies", "himovies"],
  ["yts", "1337x", "torrentz", "limetorrents", "magnet", "torrent download"],
  ["doodstream", "streamtape", "filemoon", "mixdrop", "vidmoly", "mega.nz"],
];



function searchUrlFor(query: string): string {
  const params = new URLSearchParams({ q: query, num: "20", brd_json: "1" });
  return `https://www.google.com/search?${params.toString()}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Tolerant extraction of organic results across Bright Data response shapes. */
function organicRows(payload: unknown): Record<string, unknown>[] {
  const row = asRecord(payload);
  if (!row) return [];

  for (const key of ["organic", "organic_results", "results"]) {
    const value = row[key];
    if (Array.isArray(value)) {
      return value.map(asRecord).filter((r): r is Record<string, unknown> => Boolean(r));
    }
  }

  // Some zones wrap the SERP payload in `body` (string or object).
  const body = row.body;
  if (typeof body === "string") {
    try {
      return organicRows(JSON.parse(body));
    } catch {
      return [];
    }
  }
  if (body && typeof body === "object") return organicRows(body);
  return [];
}

export function brightDataHitsFromPayload(
  payload: unknown,
  query: string,
): BrightDataDiscoveryHit[] {
  const hits: BrightDataDiscoveryHit[] = [];
  let index = 0;
  for (const item of organicRows(payload)) {
    index += 1;
    const raw = item.link ?? item.url ?? item.href;
    const link = typeof raw === "string" ? raw.trim() : "";
    if (!link.startsWith("http")) continue;
    const key = canonicalUrl(link);
    // Official studios, licensed streamers, databases and news stay excluded.
    if (isExcludedHost(key)) continue;
    const title = typeof item.title === "string" ? item.title : null;
    const snippetRaw = item.description ?? item.snippet ?? item.text;
    const snippet = typeof snippetRaw === "string" ? snippetRaw : "";
    const rankRaw = item.rank ?? item.position ?? item.global_rank;
    const rank = typeof rankRaw === "number" && Number.isFinite(rankRaw) ? rankRaw : index;
    let domain: string | null = null;
    try {
      domain = new URL(key).hostname.replace(/^www\./, "");
    } catch {
      domain = null;
    }
    const thumbRaw =
      item.thumbnail ??
      item.image ??
      item.imageUrl ??
      item.image_url ??
      (item.rich_snippet && typeof item.rich_snippet === "object"
        ? (item.rich_snippet as Record<string, unknown>).image
        : null);
    const imageUrl =
      typeof thumbRaw === "string" && thumbRaw.trim().startsWith("http")
        ? thumbRaw.trim()
        : null;
    hits.push({
      url: key,
      title,
      text: `${title ?? ""} ${snippet} ${key}`,
      query,
      snippet: snippet || null,
      rank,
      domain,
      imageUrl,
      provider: "bright_data",
      discoveredAt: new Date().toISOString(),
    });
  }
  return hits;
}


export function classifyBrightDataFailure(opts: {
  status?: number | null;
  bodyText?: string | null;
  error?: unknown;
  configured?: boolean;
}): ProviderFailureCategory {
  if (opts.configured === false) return "missing_api_key";
  const status = opts.status ?? 0;
  const body = (opts.bodyText ?? "").toLowerCase();

  if (/insufficient|not enough (?:funds|credits)|balance|payment required|quota exceeded/.test(body)) {
    return "insufficient_credits";
  }
  if (status === 402) return "insufficient_credits";
  if (status === 401 || status === 403) return "invalid_credentials";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "provider_unavailable";
  if (status > 0 && status !== 200) return "provider_unavailable";

  const msg =
    opts.error instanceof Error
      ? `${opts.error.name} ${opts.error.message}`
      : typeof opts.error === "string"
        ? opts.error
        : "";
  const lower = msg.toLowerCase();
  if (/missing|not configured/.test(lower)) return "missing_api_key";
  if (/unauthor|forbidden|invalid.*(token|key)/.test(lower)) return "invalid_credentials";
  if (/rate.?limit|429/.test(lower)) return "rate_limited";
  if (/timeout|timed out|abort/.test(lower)) return "timeout";
  if (/json|parse|malformed|unexpected token|invalid response/.test(lower)) {
    return "invalid_response";
  }
  return "provider_unavailable";
}

function isTransient(category: ProviderFailureCategory): boolean {
  return category === "rate_limited" || category === "provider_unavailable" || category === "timeout";
}

interface SingleSearch {
  ok: boolean;
  payload: unknown;
  status: number;
  bodyText: string | null;
  error: string | null;
}

async function searchOnce(
  query: string,
  signal?: AbortSignal,
  deadlineAt?: number,
): Promise<SingleSearch> {
  const key = apiKey();
  if (!key) {
    return {
      ok: false,
      payload: null,
      status: 0,
      bodyText: null,
      error: "BRIGHT_DATA_API_KEY is not configured",
    };
  }

  const timeoutMs = Math.min(
    BRIGHTDATA_REQUEST_TIMEOUT_MS,
    typeof deadlineAt === "number"
      ? Math.max(1_000, deadlineAt - Date.now())
      : BRIGHTDATA_REQUEST_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timeout", "TimeoutError")),
    timeoutMs,
  );
  const onParentAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const res = await fetch(BRIGHTDATA_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        zone: zone(),
        url: searchUrlFor(query),
        format: "json",
        method: "GET",
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        payload: null,
        status: res.status,
        bodyText: text,
        error: `Bright Data HTTP ${res.status}`,
      };
    }
    try {
      return { ok: true, payload: JSON.parse(text), status: res.status, bodyText: null, error: null };
    } catch {
      return {
        ok: false,
        payload: null,
        status: res.status,
        bodyText: text,
        error: "Bright Data returned an invalid response",
      };
    }
  } catch (error) {
    if (isAbortError(error) && signal?.aborted) throw error;
    return {
      ok: false,
      payload: null,
      status: 0,
      bodyText: null,
      error: error instanceof Error ? error.message : "Bright Data request failed",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

function emptyResult(
  overrides: Partial<BrightDataDiscoveryResult> = {},
): BrightDataDiscoveryResult {
  return {
    provider: "brightdata",
    configured: isBrightDataConfigured(),
    hits: [],
    pageLeads: [],
    queriesGenerated: 0,
    requests: 0,
    successes: 0,
    failures: 0,
    candidates: 0,
    duplicatesDropped: 0,
    failuresByCategory: emptyProviderFailureCounts(),
    failureSamples: [],
    diagnostic: brightDataDiagnostic(),
    ...overrides,
  };
}

/**
 * Bounded Bright Data SERP discovery. Never throws on provider errors so a
 * Bright Data failure can never cancel Firecrawl (or vice versa).
 */
export async function runBrightDataDiscovery(input: {
  analysis: ReferenceAnalysis;
  workTitle: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  maxQueries?: number;
  onActivity?: (event: {
    query: string;
    status: "searching" | "results" | "failed";
    candidates?: number;
    category?: ProviderFailureCategory;
    /** Running telemetry so the UI can update counters live. */
    telemetry?: {
      queriesGenerated: number;
      queryIndex: number;
      requests: number;
      successes: number;
      failures: number;
      candidatesTotal: number;
      uniqueUrls: number;
    };
  }) => void | Promise<void>;

}): Promise<BrightDataDiscoveryResult> {
  const failuresByCategory = emptyProviderFailureCounts();
  const failureSamples: BrightDataDiscoveryResult["failureSamples"] = [];

  if (!isBrightDataConfigured()) {
    bumpProviderFailure(failuresByCategory, "missing_api_key");
    return emptyResult({
      configured: false,
      failures: 1,
      failuresByCategory,
      failureSamples: [
        {
          query: "",
          category: "missing_api_key",
          detail: "BRIGHT_DATA_API_KEY is not configured",
        },
      ],
    });
  }

  const queries = buildBrightDataQueries(
    input.analysis,
    input.workTitle,
    input.maxQueries ?? BRIGHTDATA_MAX_QUERIES_PER_SCAN,
  );

  const hits: BrightDataDiscoveryHit[] = [];
  const seen = new Set<string>();
  let requests = 0;
  let successes = 0;
  let failures = 0;
  let duplicatesDropped = 0;
  let queryIndex = 0;
  const telemetry = () => ({
    queriesGenerated: queries.length,
    queryIndex,
    requests,
    successes,
    failures,
    candidatesTotal: hits.length,
    uniqueUrls: seen.size,
  });

  for (const query of queries) {
    queryIndex += 1;
    if (input.signal?.aborted) break;
    if (isPastDiscoveryDeadline(input.deadlineAt)) break;
    if (seen.size >= BRIGHTDATA_MAX_UNIQUE_PAGES) break;

    await input.onActivity?.({ query, status: "searching", telemetry: telemetry() });

    let ok = false;
    let payload: unknown = null;
    let lastCategory: ProviderFailureCategory = "provider_unavailable";
    let lastDetail = "Bright Data request failed";

    for (let attempt = 0; attempt <= BRIGHTDATA_MAX_RETRIES; attempt++) {
      if (input.signal?.aborted) break;
      if (isPastDiscoveryDeadline(input.deadlineAt)) break;
      requests += 1;
      let result: SingleSearch;
      try {
        result = await searchOnce(query, input.signal, input.deadlineAt);
      } catch {
        lastCategory = "timeout";
        lastDetail = "Bright Data request aborted";
        break;
      }
      if (result.ok) {
        ok = true;
        payload = result.payload;
        break;
      }
      lastCategory = classifyBrightDataFailure({
        status: result.status,
        bodyText: result.bodyText,
        error: result.error,
        configured: true,
      });
      lastDetail = sanitizeProviderFailureDetail(result.error ?? lastCategory);
      if (attempt < BRIGHTDATA_MAX_RETRIES && isTransient(lastCategory)) {
        await sleepWithAbort(1_500 * (attempt + 1), input.signal);
        continue;
      }
      break;
    }

    if (!ok) {
      failures += 1;
      bumpProviderFailure(failuresByCategory, lastCategory);
      if (failureSamples.length < 8) {
        failureSamples.push({
          query: query.slice(0, 120),
          category: lastCategory,
          detail: lastDetail,
        });
      }
      await input.onActivity?.({
        query,
        status: "failed",
        category: lastCategory,
        telemetry: telemetry(),
      });
      // Hard credential/credit failures will not recover within this scan.
      if (lastCategory === "invalid_credentials" || lastCategory === "insufficient_credits") break;
      continue;
    }

    successes += 1;
    let added = 0;
    for (const hit of brightDataHitsFromPayload(payload, query)) {
      if (seen.size >= BRIGHTDATA_MAX_UNIQUE_PAGES) break;
      if (seen.has(hit.url)) {
        duplicatesDropped += 1;
        continue;
      }
      seen.add(hit.url);
      hits.push(hit);
      added += 1;
    }
    await input.onActivity?.({
      query,
      status: "results",
      candidates: added,
      telemetry: telemetry(),
    });
  }

  if (successes > 0 && hits.length === 0) {
    bumpProviderFailure(failuresByCategory, "no_results");
    if (failureSamples.length < 8) {
      failureSamples.push({
        query: "",
        category: "no_results",
        detail: "Bright Data returned no usable organic results",
      });
    }
  }

  const pageLeads: PageLead[] = hits.map((hit) => ({
    url: hit.url,
    title: hit.title,
    query: `brightdata:${hit.query}`,
    text: hit.text,
    strong:
      /\b(download|watch|stream|torrent|magnet|cam|hdcam|hdrip|webrip|web-dl|telegram)\b/i.test(
        hit.text,
      ),
  }));

  return emptyResult({
    configured: true,
    hits,
    pageLeads,
    queriesGenerated: queries.length,
    requests,
    successes,
    failures,
    candidates: hits.length,
    duplicatesDropped,
    failuresByCategory,
    failureSamples,
  });
}
