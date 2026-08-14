/**
 * Reverse-image search as a first-class discovery provider.
 *
 * Text queries can only find pages that *mention* a subject. Unauthorized
 * copies are usually posted without any name, so discovery must also be seeded
 * by the protected asset image itself. This module takes an image URL (normally
 * a short-lived signed S3 URL for a protected asset, or an extracted video
 * keyframe) and returns candidate pages plus the candidate image URLs needed by
 * the perceptual-hash verifier.
 *
 * It returns candidates only — never verdicts. Verification happens in
 * `@/lib/media/candidate-verification.server`.
 */
import { classifyPlatform } from "@/lib/media/platform-classifier";

export type ReverseImageProviderId = "serpapi_google_lens" | "bing_visual_search";

export interface ReverseImageCandidate {
  /** The page that displays the candidate media (may be absent for raw images). */
  pageUrl: string | null;
  /** Direct media URL used for perceptual verification. */
  imageUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  source: string | null;
  provider: ReverseImageProviderId;
  /** Provider bucket: exact match / visual match / page containing image. */
  matchType: "exact" | "visual" | "page";
  platform: ReturnType<typeof classifyPlatform>;
}

export interface ReverseImageReport {
  providersAttempted: ReverseImageProviderId[];
  providersSucceeded: ReverseImageProviderId[];
  providersFailed: Array<{ provider: ReverseImageProviderId; reason: string }>;
  candidates: ReverseImageCandidate[];
  bestGuessLabels: string[];
  seedImageUrl: string;
  executedAt: string;
}

function dedupe(candidates: ReverseImageCandidate[]): ReverseImageCandidate[] {
  const seen = new Set<string>();
  const out: ReverseImageCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.pageUrl ?? candidate.imageUrl ?? candidate.thumbnailUrl ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

async function serpApiGoogleLens(
  imageUrl: string,
  hint: string | undefined,
  limit: number,
): Promise<{ candidates: ReverseImageCandidate[]; bestGuessLabels: string[] }> {
  const apiKey = process.env.SERPAPI_API_KEY || process.env.SERP_API || process.env["serp_api"];
  if (!apiKey) throw new Error("SERPAPI_API_KEY is not configured");

  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    api_key: apiKey,
    no_cache: "true",
  });
  if (hint) params.set("q", hint);

  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Google Lens returned non-JSON [${response.status}]`);
  }
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Google Lens failed [${response.status}]`);
  }

  const buckets: Array<[string, ReverseImageCandidate["matchType"]]> = [
    ["exact_matches", "exact"],
    ["visual_matches", "visual"],
    ["image_sources", "page"],
  ];

  const candidates: ReverseImageCandidate[] = [];
  for (const [key, matchType] of buckets) {
    const rows = Array.isArray(payload[key]) ? payload[key] : [];
    for (const row of rows) {
      const pageUrl: string | null = row.link ?? row.source_page_url ?? null;
      const imageUrl2: string | null = row.image_url ?? row.image ?? row.original ?? null;
      if (!pageUrl && !imageUrl2) continue;
      candidates.push({
        pageUrl,
        imageUrl: imageUrl2,
        thumbnailUrl: row.thumbnail ?? null,
        title: row.title ?? row.source ?? null,
        source: row.source ?? null,
        provider: "serpapi_google_lens",
        matchType,
        platform: classifyPlatform(pageUrl ?? imageUrl2 ?? ""),
      });
    }
  }

  const bestGuessLabels: string[] = [];
  if (payload.knowledge_graph?.title) bestGuessLabels.push(payload.knowledge_graph.title);
  if (Array.isArray(payload.related_searches)) {
    for (const row of payload.related_searches.slice(0, 5)) {
      if (typeof row?.query === "string") bestGuessLabels.push(row.query);
    }
  }

  return { candidates: candidates.slice(0, limit), bestGuessLabels };
}

async function bingVisualSearch(
  imageUrl: string,
  limit: number,
): Promise<{ candidates: ReverseImageCandidate[]; bestGuessLabels: string[] }> {
  const apiKey = process.env.BING_VISUAL_SEARCH_KEY;
  if (!apiKey) throw new Error("BING_VISUAL_SEARCH_KEY is not configured");

  const endpoint =
    process.env.BING_VISUAL_SEARCH_ENDPOINT ||
    "https://api.bing.microsoft.com/v7.0/images/visualsearch";
  const response = await fetch(`${endpoint}?imgUrl=${encodeURIComponent(imageUrl)}`, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey, Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Bing Visual Search failed [${response.status}]: ${text.slice(0, 200)}`);
  const payload = JSON.parse(text) as Record<string, any>;

  const candidates: ReverseImageCandidate[] = [];
  const bestGuessLabels: string[] = [];
  for (const tag of payload.tags ?? []) {
    for (const action of tag.actions ?? []) {
      if (action.actionType === "BestRepresentativeQuery" && action.displayName) {
        bestGuessLabels.push(action.displayName);
      }
      const values = action?.data?.value;
      if (!Array.isArray(values)) continue;
      const matchType: ReverseImageCandidate["matchType"] =
        action.actionType === "PagesIncluding"
          ? "exact"
          : action.actionType === "VisualSearch"
            ? "visual"
            : "page";
      for (const value of values) {
        const pageUrl: string | null = value.hostPageUrl ?? null;
        const media: string | null = value.contentUrl ?? null;
        if (!pageUrl && !media) continue;
        candidates.push({
          pageUrl,
          imageUrl: media,
          thumbnailUrl: value.thumbnailUrl ?? null,
          title: value.name ?? null,
          source: value.hostPageDisplayUrl ?? null,
          provider: "bing_visual_search",
          matchType,
          platform: classifyPlatform(pageUrl ?? media ?? ""),
        });
      }
    }
  }
  return { candidates: candidates.slice(0, limit), bestGuessLabels };
}

/** SerpApi key, accepting the alternate secret name used in this project. */
function serpApiKey(): string | undefined {
  return process.env.SERPAPI_API_KEY || process.env.SERP_API || process.env["serp_api"];
}

export function reverseImageProvidersConfigured(): ReverseImageProviderId[] {
  const out: ReverseImageProviderId[] = [];
  if (serpApiKey()) out.push("serpapi_google_lens");
  if (process.env.BING_VISUAL_SEARCH_KEY) out.push("bing_visual_search");
  return out;
}

/**
 * Run every configured reverse-image provider against one seed image.
 * Never throws: a provider failure is reported, not fatal.
 */
export async function reverseImageSearch(
  seedImageUrl: string,
  options: { subjectHint?: string; limitPerProvider?: number } = {},
): Promise<ReverseImageReport> {
  const { subjectHint, limitPerProvider = 60 } = options;
  const providers = reverseImageProvidersConfigured();
  const report: ReverseImageReport = {
    providersAttempted: providers,
    providersSucceeded: [],
    providersFailed: [],
    candidates: [],
    bestGuessLabels: [],
    seedImageUrl,
    executedAt: new Date().toISOString(),
  };

  const runs = await Promise.all(
    providers.map(async (provider) => {
      try {
        const result =
          provider === "serpapi_google_lens"
            ? await serpApiGoogleLens(seedImageUrl, subjectHint, limitPerProvider)
            : await bingVisualSearch(seedImageUrl, limitPerProvider);
        return { provider, result, error: null as string | null };
      } catch (error) {
        return { provider, result: null, error: (error as Error).message };
      }
    }),
  );

  for (const run of runs) {
    if (run.error || !run.result) {
      report.providersFailed.push({ provider: run.provider, reason: run.error ?? "unknown" });
      continue;
    }
    report.providersSucceeded.push(run.provider);
    report.candidates.push(...run.result.candidates);
    report.bestGuessLabels.push(...run.result.bestGuessLabels);
  }

  report.candidates = dedupe(report.candidates);
  report.bestGuessLabels = Array.from(new Set(report.bestGuessLabels));
  return report;
}

/** Candidate media URLs worth downloading for perceptual verification. */
export function candidateMediaUrls(report: ReverseImageReport): string[] {
  const urls: string[] = [];
  for (const candidate of report.candidates) {
    const url = candidate.imageUrl ?? candidate.thumbnailUrl;
    if (url) urls.push(url);
  }
  return Array.from(new Set(urls));
}

/** Page URLs that are shaped like actionable infringement targets. */
export function candidatePageUrls(report: ReverseImageReport): string[] {
  const urls: string[] = [];
  for (const candidate of report.candidates) {
    if (!candidate.pageUrl) continue;
    const platform = candidate.platform;
    if (!platform || platform.isSearchSurface || platform.isInfrastructure) continue;
    urls.push(candidate.pageUrl);
  }
  return Array.from(new Set(urls));
}
