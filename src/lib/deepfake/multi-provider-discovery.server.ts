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
 * Discovery is Firecrawl-only. Brave Search, SerpApi and Reddit providers were
 * removed intentionally — do not reintroduce them.
 */


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

    // Firecrawl is the only discovery provider. Brave, SerpApi and Reddit are
    // intentionally not used for deepfake discovery.


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
