import type { SupabaseClient } from "@supabase/supabase-js";
import { isBlockedHost } from "./queries";
import { firecrawlSearch } from "./firecrawl.server";
import { calculateDeepfakeRelevanceScore } from "./relevance-scorer.server";

export interface DiscoveredLead {
  url: string;
  title: string;
  description: string;
  query: string;
  source: string;
  thumbnail_url?: string;
  image_url?: string;
  is_sensitive?: boolean;
}

export type ProviderErrorCode =
  | "AUTH_FAILED"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "NONE";

export interface DiscoveryProgress {
  provider: string;
  query: string;
  queryIndex: number;
  totalQueries: number;
  hitsFound: number;
  providerStatus: "success" | "skipped" | "failed" | "quota_exhausted" | "rate_limited" | "auth_failed";
  errorCode?: ProviderErrorCode;
  errorMessage?: string;
  httpStatus?: number | null;
}

export function classifyProviderError(err: unknown): {
  code: ProviderErrorCode;
  status: number | null;
  message: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const statusMatch = msg.match(/\b(401|402|403|429|5\d\d)\b/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : null;

  if (status === 401 || status === 403 || /auth|unauthorized|forbidden|invalid key/i.test(msg)) {
    return { code: "AUTH_FAILED", status, message: msg };
  }
  if (status === 402 || /insufficient credits|quota|billing|payment/i.test(msg)) {
    return { code: "QUOTA_EXHAUSTED", status: 402, message: msg };
  }
  if (status === 429 || /rate limit|too many requests/i.test(msg)) {
    return { code: "RATE_LIMITED", status: 429, message: msg };
  }
  if (/\b(?:timeout|timed out|abort|etimedout)\b/i.test(msg)) {
    return { code: "TIMEOUT", status: null, message: msg };
  }
  if (status && status >= 500) {
    return { code: "PROVIDER_ERROR", status, message: msg };
  }
  return { code: "PROVIDER_ERROR", status, message: msg };
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

const canonicalUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
    return parsed.toString();
  } catch {
    return url.trim();
  }
};

/**
 * Executes multi-provider deepfake discovery across queries.
 * Persists discovered candidate rows immediately into Supabase.
 * Records explicit provider error telemetry (quota, rate-limit, auth) without swallowing into fake zero hits.
 */
export async function executeMultiProviderDiscovery({
  queries,
  scanId,
  userId,
  supabase,
  perQueryLimit = 10,
  onProgress,
  deadlineAt,
  concurrency = 4,
}: {
  queries: string[];
  scanId: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>;
  perQueryLimit?: number;
  onProgress?: (progress: DiscoveryProgress) => void | Promise<void>;
  /**
   * Absolute epoch-ms discovery deadline. Once passed, no new provider calls
   * start and discovery returns the leads collected so far so crawling,
   * classification and persistence still run inside the request budget.
   */
  deadlineAt?: number;
  /** Parallel provider calls per wave. */
  concurrency?: number;
}): Promise<DiscoveredLead[]> {
  const allLeads: DiscoveredLead[] = [];
  const seenUrls = new Set<string>();
  let executed = 0;

  const runQuery = async (query: string, idx: number): Promise<void> => {
    let queryHits: DiscoveredLead[] = [];
    let providerUsed = "firecrawl";
    let providerStatus: DiscoveryProgress["providerStatus"] = "success";
    let lastError: { code: ProviderErrorCode; status: number | null; message: string } | null = null;

    // 1. Try Firecrawl
    if (process.env.FIRECRAWL_API_KEY?.trim()) {
      try {
        const fcHits = await firecrawlSearch(
          query,
          perQueryLimit,
          deadlineAt ? { softDeadlineMs: deadlineAt } : undefined,
        );
        queryHits = fcHits.map((h) => ({
          url: h.url,
          title: h.title ?? "",
          description: h.description ?? "",
          query,
          source: h.source ?? "firecrawl",
          thumbnail_url: h.thumbnail_url,
          image_url: h.image_url,
          is_sensitive: h.is_sensitive,
        }));
        providerStatus = "success";
      } catch (err) {
        lastError = classifyProviderError(err);
        if (lastError.code === "QUOTA_EXHAUSTED") providerStatus = "quota_exhausted";
        else if (lastError.code === "RATE_LIMITED") providerStatus = "rate_limited";
        else if (lastError.code === "AUTH_FAILED") providerStatus = "auth_failed";
        else providerStatus = "failed";

        console.warn(
          `[DEEPFAKE:DISCOVERY] Firecrawl query "${query}" failed (${lastError.code}):`,
          lastError.message,
        );
      }
    } else {
      providerStatus = "skipped";
      providerUsed = "none";
    }

    // Deduplicate and filter blocked hosts
    const newDiscoveryRows: Array<{
      user_id: string;
      scan_id: string;
      source: string;
      search_query: string;
      page_url: string;
      canonical_url: string;
      source_host: string | null;
      page_title: string | null;
      snippet: string | null;
      image_url: string | null;
      thumbnail_url: string | null;
      media_type: string | null;
      analysis_status: string;
      updated_at: string;
    }> = [];

    for (const lead of queryHits) {
      if (!lead.url) continue;
      const host = hostOf(lead.url);
      if (!host || isBlockedHost(host)) continue;
      const canonical = canonicalUrl(lead.url);
      if (seenUrls.has(canonical)) continue;
      seenUrls.add(canonical);

      const targetName = query.split(/\s+/)[0] || "";
      const { score } = calculateDeepfakeRelevanceScore(lead, targetName);

      allLeads.push({
        ...lead,
        score,
      } as DiscoveredLead);

      newDiscoveryRows.push({
        user_id: userId,
        scan_id: scanId,
        source: lead.source || providerUsed,
        search_query: query,
        page_url: lead.url,
        canonical_url: canonical,
        source_host: host,
        page_title: lead.title || null,
        snippet: lead.description || null,
        image_url: lead.image_url || null,
        thumbnail_url: lead.thumbnail_url || null,
        media_type: lead.image_url || lead.thumbnail_url ? "image" : null,
        analysis_status: score < 200 ? "general_mention" : "discovered",
        updated_at: new Date().toISOString(),
      });
    }

    // Immediate persistence to deepfake_discoveries table as hits arrive!
    if (newDiscoveryRows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("deepfake_discoveries")
        .upsert(newDiscoveryRows, { onConflict: "scan_id,page_url" });

      if (error) {
        console.warn(`[DEEPFAKE:DISCOVERY] Candidate persistence warning: ${error.message}`);
      }
    }

    executed += 1;
    if (onProgress) {
      await onProgress({
        provider: providerUsed,
        query,
        queryIndex: idx + 1,
        totalQueries: queries.length,
        hitsFound: queryHits.length,
        providerStatus,
        errorCode: lastError?.code ?? "NONE",
        errorMessage: lastError?.message,
        httpStatus: lastError?.status ?? null,
      });
    }
  };

  const wave = Math.max(1, concurrency);
  for (let start = 0; start < queries.length; start += wave) {
    if (deadlineAt && Date.now() >= deadlineAt) {
      console.warn("[DEEPFAKE:DISCOVERY] Discovery deadline reached; stopping query execution", {
        queries_executed: executed,
        queries_planned: queries.length,
      });
      break;
    }
    const batch = queries.slice(start, start + wave);
    await Promise.all(batch.map((query, offset) => runQuery(query, start + offset)));
  }

  return allLeads;
}

