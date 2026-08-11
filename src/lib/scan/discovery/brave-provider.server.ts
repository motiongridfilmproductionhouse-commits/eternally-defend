/**
 * Brave Search (web + news) discovery adapter — legitimate API, BRAVE_API_KEY.
 */

import {
  classifyHttpFailure,
  classifyThrownFailure,
  fetchJsonWithTimeout,
  ProviderError,
  type SearchProviderAdapter,
} from "./provider";
import type { DiscoveryHit } from "./types";

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 14_000;

interface BraveResult {
  url?: string;
  title?: string;
  description?: string;
  age?: string;
  page_age?: string;
  thumbnail?: { src?: string; original?: string };
  profile?: { name?: string };
}

function braveKey(): string {
  return (process.env.BRAVE_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY ?? "").trim();
}

function stripTags(v: string | undefined): string | undefined {
  return typeof v === "string" ? v.replace(/<[^>]+>/g, "").trim() : undefined;
}

export const braveProvider: SearchProviderAdapter = {
  id: "brave",
  label: "Brave Search",

  isConfigured() {
    return Boolean(braveKey());
  },

  async search(query, limit, signal) {
    const key = braveKey();
    if (!key) throw new ProviderError("auth_failed", "BRAVE_API_KEY is not configured");

    const url = new URL(ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(Math.max(limit, 1), 20)));
    url.searchParams.set("text_decorations", "false");

    let status = 0;
    let text = "";
    try {
      const res = await fetchJsonWithTimeout(
        url.toString(),
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "accept-encoding": "gzip",
            "x-subscription-token": key,
          },
        },
        TIMEOUT_MS,
        signal,
      );
      status = res.status;
      text = res.text;
    } catch (e) {
      throw new ProviderError(
        classifyThrownFailure(e),
        e instanceof Error ? e.message.slice(0, 200) : "Brave request failed",
      );
    }

    if (status !== 200) {
      throw new ProviderError(
        classifyHttpFailure(status, text),
        `Brave search failed (${status}): ${text.slice(0, 180)}`,
        status,
      );
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ProviderError("bad_response", "Brave returned non-JSON");
    }

    const web = json.web && typeof json.web === "object" ? (json.web as Record<string, unknown>) : {};
    const news =
      json.news && typeof json.news === "object" ? (json.news as Record<string, unknown>) : {};
    const results = [
      ...(Array.isArray(web.results) ? (web.results as BraveResult[]) : []),
      ...(Array.isArray(news.results) ? (news.results as BraveResult[]) : []),
    ];

    const hits: DiscoveryHit[] = [];
    for (const item of results) {
      if (!item.url) continue;
      const thumb = item.thumbnail?.original ?? item.thumbnail?.src;
      hits.push({
        url: item.url,
        title: stripTags(item.title) ?? "",
        description: stripTags(item.description) ?? "",
        snippet: stripTags(item.description),
        author: item.profile?.name,
        date: item.age ?? item.page_age,
        publishedDate: item.page_age ?? item.age,
        media: thumb ? { thumbnail: thumb, thumbnailHi: thumb } : undefined,
        provider: "brave",
      });
    }
    return hits;
  },
};
