/**
 * SerpApi (Google) discovery adapter — legitimate SERP API, already used by the
 * Copyright Intelligence pipeline (SERPAPI_API_KEY).
 */

import {
  classifyHttpFailure,
  classifyThrownFailure,
  fetchJsonWithTimeout,
  ProviderError,
  type SearchProviderAdapter,
} from "./provider";
import type { DiscoveryHit } from "./types";

const ENDPOINT = "https://serpapi.com/search.json";
const TIMEOUT_MS = 14_000;

interface SerpApiOrganicResult {
  link?: string;
  title?: string;
  snippet?: string;
  date?: string;
  source?: string;
  thumbnail?: string;
}

interface SerpApiNewsResult {
  link?: string;
  title?: string;
  snippet?: string;
  date?: string;
  source?: string | { name?: string };
  thumbnail?: string;
}

function sourceName(source: SerpApiNewsResult["source"]): string | undefined {
  if (typeof source === "string") return source;
  if (source && typeof source.name === "string") return source.name;
  return undefined;
}

export const serpapiProvider: SearchProviderAdapter = {
  id: "serpapi",
  label: "SerpApi (Google)",

  isConfigured() {
    return Boolean(process.env.SERPAPI_API_KEY?.trim());
  },

  async search(query, limit, signal) {
    const key = process.env.SERPAPI_API_KEY?.trim();
    if (!key) throw new ProviderError("auth_failed", "SERPAPI_API_KEY is not configured");

    const url = new URL(ENDPOINT);
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(Math.max(limit, 1), 20)));
    url.searchParams.set("api_key", key);

    let status = 0;
    let text = "";
    try {
      const res = await fetchJsonWithTimeout(
        url.toString(),
        { method: "GET", headers: { accept: "application/json" } },
        TIMEOUT_MS,
        signal,
      );
      status = res.status;
      text = res.text;
    } catch (e) {
      throw new ProviderError(
        classifyThrownFailure(e),
        e instanceof Error ? e.message.slice(0, 200) : "SerpApi request failed",
      );
    }

    if (status !== 200) {
      throw new ProviderError(
        classifyHttpFailure(status, text),
        `SerpApi search failed (${status}): ${text.slice(0, 180)}`,
        status,
      );
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ProviderError("bad_response", "SerpApi returned non-JSON");
    }

    if (typeof json.error === "string") {
      throw new ProviderError(
        /run out|exhaust|credit|plan/i.test(json.error) ? "credits_exhausted" : "bad_response",
        json.error.slice(0, 200),
      );
    }

    const organic = Array.isArray(json.organic_results)
      ? (json.organic_results as SerpApiOrganicResult[])
      : [];
    const news = Array.isArray(json.news_results) ? (json.news_results as SerpApiNewsResult[]) : [];

    const hits: DiscoveryHit[] = [];
    for (const item of [...organic, ...news]) {
      if (!item.link) continue;
      hits.push({
        url: item.link,
        title: item.title ?? "",
        description: item.snippet ?? "",
        snippet: item.snippet,
        author: sourceName((item as SerpApiNewsResult).source),
        date: item.date,
        publishedDate: item.date,
        media: item.thumbnail
          ? { thumbnail: item.thumbnail, thumbnailHi: item.thumbnail }
          : undefined,
        provider: "serpapi",
      });
    }
    return hits;
  },
};
