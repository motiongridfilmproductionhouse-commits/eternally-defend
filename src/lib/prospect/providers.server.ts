/**
 * Pre-Enrollment Intelligence — production provider wiring (server only).
 *
 * Maps each source family to the real adapters already in this codebase. An
 * executor is only "configured" when its adapter says so (credential present
 * AND not disabled by env), so a family is never shown as scanned unless a
 * query actually went out.
 */

import type { SearchProviderAdapter } from "@/lib/scan/discovery/provider";
import { ProviderError, classifyThrownFailure } from "@/lib/scan/discovery/provider";
import type { DiscoveryHit } from "@/lib/scan/discovery/types";
import { googleProvider } from "@/lib/scan/discovery/google-provider.server";
import { serpapiProvider } from "@/lib/scan/discovery/serpapi-provider.server";
import { braveProvider } from "@/lib/scan/discovery/brave-provider.server";
import { firecrawlProvider } from "@/lib/scan/discovery/firecrawl-provider.server";
import { geminiGroundingProvider } from "@/lib/scan/discovery/gemini-grounding-provider.server";
import { ddgHtmlProvider } from "@/lib/scan/discovery/ddg-provider.server";
import { wikipediaProvider } from "@/lib/scan/discovery/wikipedia-provider.server";
import type {
  DetectorResult,
  FetchedPage,
  ManipulationDetector,
  NormalizedHit,
  ProviderExecutor,
} from "./runner";
import type { SourceFamilyKey } from "./source-registry";
import type { DiscoveryMethod } from "./events";

const HITS_PER_QUERY = 10;

function hitToNormalized(hit: DiscoveryHit, rank: number): NormalizedHit | null {
  if (!hit.url || typeof hit.url !== "string") return null;
  return {
    url: hit.url,
    title: typeof hit.title === "string" ? hit.title : null,
    snippet:
      typeof hit.snippet === "string"
        ? hit.snippet
        : typeof hit.description === "string"
          ? hit.description
          : null,
    author: typeof hit.author === "string" ? hit.author : null,
    publishedAt:
      typeof hit.publishedDate === "string"
        ? hit.publishedDate
        : typeof hit.date === "string"
          ? hit.date
          : null,
    thumbnailUrl: hit.media?.thumbnail ?? null,
    rank,
  };
}

function adapterExecutor(
  adapter: SearchProviderAdapter,
  familyKey: SourceFamilyKey,
  method: DiscoveryMethod,
  label?: string,
): ProviderExecutor {
  return {
    id: adapter.id,
    label: label ?? adapter.label,
    familyKey,
    method,
    isConfigured: () => {
      const disabled = (process.env.SCAN_DISABLE_PROVIDERS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase());
      return !disabled.includes(adapter.id) && adapter.isConfigured();
    },
    async search(query, signal) {
      const hits = await adapter.search(query.query, HITS_PER_QUERY, signal);
      return hits
        .map((h, i) => hitToNormalized(h, i + 1))
        .filter((h): h is NormalizedHit => Boolean(h));
    },
  };
}

/* ── YouTube Data API ─────────────────────────────────────────────────────── */

const youtubeExecutor: ProviderExecutor = {
  id: "youtube_data_api",
  label: "YouTube Data API",
  familyKey: "youtube",
  method: "PLATFORM_API",
  isConfigured: () => Boolean((process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim()),
  async search(query, signal) {
    const { searchRecentYouTubeMentions } = await import("@/lib/deepfake/youtube-discovery.server");
    let hits;
    try {
      hits = await searchRecentYouTubeMentions({
        name: query.query,
        maxResults: 15,
        pages: 1,
        signal,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const kind = /quota|\[403\]/i.test(msg) ? "credits_exhausted" : classifyThrownFailure(error);
      throw new ProviderError(kind, msg.slice(0, 200));
    }
    return hits.map((h, i) => {
      const extra = h as unknown as { thumbnail_url?: string; description?: string };
      const published = extra.description?.match(/Published (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
      const videoId = h.url.match(/[?&]v=([^&]+)/)?.[1] ?? null;
      return {
        url: h.url,
        title: h.title ?? null,
        snippet: extra.description ?? null,
        publishedAt: published,
        thumbnailUrl: extra.thumbnail_url ?? null,
        mediaKind: "video" as const,
        providerResultId: videoId,
        rank: i + 1,
      };
    });
  },
};

/* ── Brave image search ───────────────────────────────────────────────────── */

const braveImagesExecutor: ProviderExecutor = {
  id: "brave_images",
  label: "Brave Images",
  familyKey: "images",
  method: "IMAGE_SEARCH",
  isConfigured: () => Boolean(process.env.BRAVE_API_KEY?.trim()),
  async search(query, signal) {
    const { searchBraveImagesForQuery } = await import("@/lib/deepfake/brave-images.server");
    const result = await searchBraveImagesForQuery({ query: query.query, signal });
    if (result.failure && !result.hits.length) {
      const kind = /402|credit|quota/i.test(result.failure)
        ? "credits_exhausted"
        : /429|rate/i.test(result.failure)
          ? "rate_limited"
          : /401|403|auth/i.test(result.failure)
            ? "auth_failed"
            : "unavailable";
      throw new ProviderError(kind, result.failure.slice(0, 200));
    }
    return result.hits.slice(0, 12).map((h, i) => ({
      // The hosting page is the discovered source; the image is its media.
      url: h.page_url,
      title: h.title || null,
      snippet: null,
      thumbnailUrl: h.image_url,
      mediaKind: "image" as const,
      providerResultId: h.image_url,
      rank: i + 1,
    }));
  },
};

/* ── Google Fact Check Tools API ──────────────────────────────────────────── */

const factCheckExecutor: ProviderExecutor = {
  id: "google_fact_check",
  label: "Google Fact Check",
  familyKey: "fact_check",
  method: "FACT_CHECK_API",
  isConfigured: () => Boolean(process.env.FACT_CHECK_API_KEY?.trim()),
  async search(query, signal) {
    const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
    url.searchParams.set("query", query.query);
    url.searchParams.set("pageSize", "10");
    url.searchParams.set("key", process.env.FACT_CHECK_API_KEY!.trim());
    let res: Response;
    try {
      res = await fetch(url, { signal: signal ?? AbortSignal.timeout(12_000) });
    } catch (error) {
      throw new ProviderError(classifyThrownFailure(error), "Fact Check request failed");
    }
    const text = await res.text();
    if (!res.ok) {
      const kind =
        res.status === 429
          ? "rate_limited"
          : res.status === 401 || res.status === 403
            ? "auth_failed"
            : "unavailable";
      throw new ProviderError(
        kind,
        `Fact Check API ${res.status}: ${text.slice(0, 160)}`,
        res.status,
      );
    }
    const json = JSON.parse(text) as {
      claims?: Array<{
        text?: string;
        claimant?: string;
        claimDate?: string;
        claimReview?: Array<{
          url?: string;
          title?: string;
          textualRating?: string;
          reviewDate?: string;
          publisher?: { name?: string };
        }>;
      }>;
    };
    const out: NormalizedHit[] = [];
    for (const claim of json.claims ?? []) {
      const review = claim.claimReview?.[0];
      if (!review?.url) continue;
      out.push({
        url: review.url,
        title: review.title ?? claim.text ?? null,
        snippet: `Claim: ${claim.text ?? ""}${claim.claimant ? ` (claimant: ${claim.claimant})` : ""} · Rating by ${review.publisher?.name ?? "fact-checker"}: ${review.textualRating ?? "n/a"}`,
        publishedAt: review.reviewDate ?? claim.claimDate ?? null,
        author: review.publisher?.name ?? null,
        rank: out.length + 1,
      });
    }
    return out;
  },
};

/** Every executor, per family. Families with no entry here cannot be scanned. */
export function productionExecutors(): ProviderExecutor[] {
  return [
    // Google results: Custom Search JSON API (off unless SCAN_ENABLE_GOOGLE_CSE=true) or SerpApi.
    adapterExecutor(googleProvider, "google_search", "WEB_SEARCH", "Google Custom Search"),
    adapterExecutor(serpapiProvider, "google_search", "WEB_SEARCH", "SerpApi (Google results)"),
    adapterExecutor(braveProvider, "web_general", "WEB_SEARCH", "Brave Search"),
    adapterExecutor(
      geminiGroundingProvider,
      "web_general",
      "WEB_SEARCH",
      "Gemini (Google-grounded)",
    ),
    adapterExecutor(firecrawlProvider, "web_general", "WEB_SEARCH", "Firecrawl"),
    adapterExecutor(ddgHtmlProvider, "web_general", "WEB_SEARCH", "Public web (keyless)"),
    adapterExecutor(braveProvider, "news", "WEB_SEARCH", "Brave Search (news queries)"),
    youtubeExecutor,
    braveImagesExecutor,
    factCheckExecutor,
    adapterExecutor(wikipediaProvider, "encyclopaedic", "REFERENCE_API", "Wikipedia"),
  ];
}

/* ── Page fetch (DNS-rebinding-safe) ──────────────────────────────────────── */

function meta(html: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name.replace(/[:.]/g, "\\$&")}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name.replace(/[:.]/g, "\\$&")}["']`,
      "i",
    );
    const m = html.match(re);
    const value = m?.[1] ?? m?.[2];
    if (value) return value.trim();
  }
  return null;
}

export async function fetchPublicPage(
  url: string,
  signal?: AbortSignal,
): Promise<FetchedPage | null> {
  const { fetchPublicHttpUrl, isSafePublicHttpUrl } =
    await import("@/lib/deepfake/url-safety.server");
  const { htmlToPageText } = await import("@/lib/deepfake/direct-page-fetch.server");
  if (!isSafePublicHttpUrl(url)) return null;
  const timeout = AbortSignal.timeout(12_000);
  const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchPublicHttpUrl(url, {
      signal: merged,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; EternaIntelligence/1.0; +https://eterna)",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (type && !/text\/html|application\/xhtml/i.test(type)) return null;
  const html = (await res.text()).slice(0, 1_500_000);
  if (!html.trim()) return null;
  const title =
    meta(html, ["og:title", "twitter:title"]) ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ??
    null;
  return {
    text: htmlToPageText(html).replace(/\s+/g, " ").trim().slice(0, 20_000),
    title,
    description: meta(html, ["og:description", "description", "twitter:description"]),
    publishedAt: meta(html, [
      "article:published_time",
      "og:published_time",
      "datePublished",
      "pubdate",
    ]),
    imageUrl: meta(html, ["og:image", "twitter:image"]),
  };
}

/* ── Manipulation detector (Hive, else AI vision if configured) ───────────── */

export function productionDetector(): ManipulationDetector | null {
  const hive = Boolean(process.env.HIVE_API_KEY?.trim());
  const vision = Boolean(process.env.LOVABLE_API_KEY?.trim());
  if (!hive && !vision) return null;
  return {
    name: hive ? "Hive media analysis" : "AI vision assessment",
    isConfigured: () => hive || vision,
    async analyse(item, signal): Promise<DetectorResult> {
      if (!item.mediaUrl)
        return { status: "no_media", score: null, detail: "No publicly accessible media URL" };
      const rawHit = {
        url: item.url,
        title: item.title ?? undefined,
        query: "",
        image_url: item.mediaUrl,
      };
      if (hive) {
        const { classifyHitsWithHive } = await import("@/lib/deepfake/hive.server");
        const [r] = await classifyHitsWithHive([rawHit], { signal });
        if (!r || r.classification_status !== "completed") {
          return {
            status: r?.classification_status === "no_media" ? "no_media" : "error",
            score: null,
            detail: r?.ai_reasoning ?? "Hive returned no result",
          };
        }
        const df = Math.round((r.hive_deepfake_score ?? 0) * 100);
        const ai = Math.round((r.hive_ai_generated_score ?? 0) * 100);
        return {
          status: "completed",
          score: Math.max(df, ai),
          detail: `deepfake score ${df}%, AI-generated score ${ai}%`,
          mediaUrl: r.media_url ?? item.mediaUrl,
        };
      }
      const { classifyHitsWithVision } = await import("@/lib/deepfake/vision-classify.server");
      const [r] = await classifyHitsWithVision([rawHit], { signal });
      if (!r || r.classification_status !== "completed") {
        return {
          status: r?.classification_status === "no_media" ? "no_media" : "error",
          score: null,
          detail: r?.ai_reasoning ?? "No result",
        };
      }
      const synthetic = Number(r.ai_reasoning.match(/synthetic (\d+)%/)?.[1] ?? 0);
      return {
        status: "completed",
        score: synthetic,
        detail: `AI vision synthetic score ${synthetic}%`,
        mediaUrl: r.media_url ?? item.mediaUrl,
      };
    },
  };
}
