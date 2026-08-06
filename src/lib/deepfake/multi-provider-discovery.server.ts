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

export interface DiscoveryProgress {
  provider: string;
  query: string;
  queryIndex: number;
  totalQueries: number;
  hitsFound: number;
  providerStatus: "success" | "skipped" | "failed";
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
 * Searches Brave Search for web and image leads.
 */
async function searchBrave(query: string, maxResults = 10): Promise<DiscoveredLead[]> {
  const apiKey = process.env.BRAVE_API_KEY?.trim();
  if (!apiKey) return [];

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Brave Search returned ${res.status}`);
  }

  const json = (await res.json()) as {
    web?: { results?: Array<{ url: string; title: string; description: string }> };
  };

  const results = json.web?.results ?? [];
  return results.map((item) => ({
    url: item.url,
    title: item.title ?? "",
    description: item.description ?? "",
    query,
    source: "brave_search",
  }));
}

/**
 * Searches SerpAPI for web and image leads.
 */
async function searchSerpApi(query: string, maxResults = 10): Promise<DiscoveredLead[]> {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) return [];

  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${apiKey}&num=${maxResults}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpAPI returned ${res.status}`);
  }

  const json = (await res.json()) as {
    organic_results?: Array<{ link: string; title: string; snippet: string }>;
  };

  const results = json.organic_results ?? [];
  return results.map((item) => ({
    url: item.link,
    title: item.title ?? "",
    description: item.snippet ?? "",
    query,
    source: "serpapi_web",
  }));
}

/**
 * Searches Reddit JSON API for discussions and leads.
 */
async function searchRedditPublic(query: string, maxResults = 10): Promise<DiscoveredLead[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}&sort=relevance`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EternaBot/1.0)" },
    });
    if (!res.ok) return [];

    const json = (await res.json()) as {
      data?: { children?: Array<{ data: { url: string; title: string; selftext?: string } }> };
    };

    const items = json.data?.children ?? [];
    return items.map((child) => ({
      url: child.data.url,
      title: child.data.title ?? "",
      description: child.data.selftext?.slice(0, 300) ?? "",
      query,
      source: "reddit_public",
    }));
  } catch {
    return [];
  }
}

/**
 * Executes multi-provider deepfake discovery across queries.
 * Persists discovered candidate rows immediately into Supabase.
 */
export async function executeMultiProviderDiscovery({
  queries,
  scanId,
  userId,
  supabase,
  perQueryLimit = 10,
  onProgress,
}: {
  queries: string[];
  scanId: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>;
  perQueryLimit?: number;
  onProgress?: (progress: DiscoveryProgress) => void | Promise<void>;
}): Promise<DiscoveredLead[]> {
  const allLeads: DiscoveredLead[] = [];
  const seenUrls = new Set<string>();

  for (let idx = 0; idx < queries.length; idx++) {
    const query = queries[idx];
    let queryHits: DiscoveredLead[] = [];
    let providerUsed = "none";

    // 1. Try Firecrawl
    if (process.env.FIRECRAWL_API_KEY?.trim()) {
      try {
        const fcHits = await firecrawlSearch(query, perQueryLimit);
        if (fcHits.length > 0) {
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
          providerUsed = "firecrawl";
        }
      } catch (err) {
        console.warn(`[DEEPFAKE:DISCOVERY] Firecrawl failed for "${query}":`, err);
      }
    }

    // 2. Fallback to Brave Search if Firecrawl returned no hits
    if (queryHits.length === 0 && process.env.BRAVE_API_KEY?.trim()) {
      try {
        const braveHits = await searchBrave(query, perQueryLimit);
        if (braveHits.length > 0) {
          queryHits = braveHits;
          providerUsed = "brave_search";
        }
      } catch (err) {
        console.warn(`[DEEPFAKE:DISCOVERY] Brave Search failed for "${query}":`, err);
      }
    }

    // 3. Fallback to SerpAPI if needed
    if (queryHits.length === 0 && process.env.SERPAPI_API_KEY?.trim()) {
      try {
        const serpHits = await searchSerpApi(query, perQueryLimit);
        if (serpHits.length > 0) {
          queryHits = serpHits;
          providerUsed = "serpapi";
        }
      } catch (err) {
        console.warn(`[DEEPFAKE:DISCOVERY] SerpAPI failed for "${query}":`, err);
      }
    }

    // 4. Always attempt Reddit public search for community deepfake queries
    if (query.toLowerCase().includes("reddit") || queryHits.length === 0) {
      try {
        const redditHits = await searchRedditPublic(query, 5);
        if (redditHits.length > 0) {
          queryHits.push(...redditHits);
          if (providerUsed === "none") providerUsed = "reddit";
        }
      } catch (err) {
        console.warn(`[DEEPFAKE:DISCOVERY] Reddit search failed for "${query}":`, err);
      }
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
      if (!host || isBlockedHost(host)) {
        console.log(`[DEEPFAKE:REJECTED] Rejected host ${host} for "${lead.url}" - Blocked host`);
        continue;
      }
      const canonical = canonicalUrl(lead.url);
      if (seenUrls.has(canonical)) continue;
      seenUrls.add(canonical);

      const targetName = query.split(/\s+/)[0] || "";
      const { score, isHarmless, reasons } = calculateDeepfakeRelevanceScore(lead, targetName);

      if (isHarmless && score < 100) {
        console.log(
          `[DEEPFAKE:REJECTED] Rejected: ${lead.url} | Reason: ${reasons[0] ?? "Low relevance"} | Score: ${score}`,
        );
      }

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

    if (onProgress) {
      await onProgress({
        provider: providerUsed,
        query,
        queryIndex: idx + 1,
        totalQueries: queries.length,
        hitsFound: queryHits.length,
        providerStatus: queryHits.length > 0 ? "success" : "skipped",
      });
    }
  }

  return allLeads;
}
