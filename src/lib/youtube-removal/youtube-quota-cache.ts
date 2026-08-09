/**
 * Multi-Tiered YouTube Data API Search Cache (L1 Memory -> L2 Supabase DB).
 *
 * `search.list` costs 100 quota units per call.
 * L1: Memory cache (fast within process).
 * L2: Supabase persistent `youtube_search_cache` table (durable across serverless instances).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DiscoveredVideo } from "./youtube-search.server";

type Supa = SupabaseClient<Database>;

export interface CachedSearchResult {
  query: string;
  page: number;
  orderMode: string;
  regionCode: string | null;
  hits: DiscoveredVideo[];
  fetchedAt: number;
}

export type CacheHitSource = "L1" | "L2" | "MISS";

// L1 In-Memory Cache
const L1_CACHE = new Map<string, CachedSearchResult>();
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours default TTL

function buildKey(query: string, page: number, orderMode = "relevance", regionCode: string | null = null): string {
  return `${query.trim().toLowerCase()}::p${page}::o_${orderMode}::r_${regionCode || "none"}`;
}

export async function getCachedSearch(
  supabase: Supa | null,
  query: string,
  page = 1,
  orderMode = "relevance",
  regionCode: string | null = null,
  ttlMs = DEFAULT_TTL_MS,
): Promise<{ hits: DiscoveredVideo[]; source: CacheHitSource } | null> {
  const normQuery = query.trim().toLowerCase();
  const key = buildKey(normQuery, page, orderMode, regionCode);

  // 1. Check L1 Memory Cache
  const l1Hit = L1_CACHE.get(key);
  if (l1Hit && Date.now() - l1Hit.fetchedAt < ttlMs) {
    return { hits: l1Hit.hits, source: "L1" };
  }

  // 2. Check L2 Supabase Table if client provided
  if (supabase) {
    try {
      const nowIso = new Date().toISOString();
      const { data: row, error } = await supabase
        .from("youtube_search_cache")
        .select("video_results, fetched_at, expires_at")
        .eq("normalized_query", normQuery)
        .eq("page_number", page)
        .eq("order_mode", orderMode)
        .gt("expires_at", nowIso)
        .maybeSingle();

      if (!error && row && Array.isArray(row.video_results)) {
        const hits = row.video_results as unknown as DiscoveredVideo[];
        // Populate L1 cache for subsequent fast reads
        L1_CACHE.set(key, {
          query: normQuery,
          page,
          orderMode,
          regionCode,
          hits,
          fetchedAt: new Date(row.fetched_at).getTime(),
        });
        return { hits, source: "L2" };
      }
    } catch {
      // Ignore L2 query errors gracefully
    }
  }

  return null;
}

export async function setCachedSearch(
  supabase: Supa | null,
  query: string,
  page: number,
  orderMode: string,
  regionCode: string | null,
  hits: DiscoveredVideo[],
  ttlMs = DEFAULT_TTL_MS,
): Promise<void> {
  const normQuery = query.trim().toLowerCase();
  const key = buildKey(normQuery, page, orderMode, regionCode);
  const now = new Date();
  const fetchedAtIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + ttlMs).toISOString();

  // 1. Update L1 Memory Cache
  L1_CACHE.set(key, {
    query: normQuery,
    page,
    orderMode,
    regionCode,
    hits,
    fetchedAt: now.getTime(),
  });

  // 2. Persist L2 Supabase Table if client provided
  if (supabase) {
    try {
      await supabase.from("youtube_search_cache").upsert(
        {
          normalized_query: normQuery,
          page_number: page,
          order_mode: orderMode,
          region_code: regionCode,
          video_results: hits as any,
          result_count: hits.length,
          fetched_at: fetchedAtIso,
          expires_at: expiresAtIso,
        } as never,
        { onConflict: "normalized_query,page_number,order_mode,coalesce(region_code,'')" },
      );
    } catch {
      // Ignore L2 upsert errors gracefully
    }
  }
}

export function clearL1Cache(): void {
  L1_CACHE.clear();
}
