/**
 * Wikipedia / Wikimedia discovery adapter — keyless public API.
 *
 * This is a fallback discovery layer so identity resolution keeps working when
 * the paid providers (Brave / SerpApi / Firecrawl) are rate limited or out of
 * credits. It returns only public encyclopaedia article URLs and never any
 * enforcement, contact or takedown signal.
 */

import {
  classifyHttpFailure,
  classifyThrownFailure,
  fetchJsonWithTimeout,
  ProviderError,
  type SearchProviderAdapter,
} from "./provider";
import type { DiscoveryHit } from "./types";

const ENDPOINT = "https://en.wikipedia.org/w/api.php";
const TIMEOUT_MS = 10_000;

interface WikiSearchResult {
  title?: string;
  snippet?: string;
}

function stripTags(value: string | undefined): string {
  return typeof value === "string" ? value.replace(/<[^>]+>/g, "").trim() : "";
}

export const wikipediaProvider: SearchProviderAdapter = {
  id: "wikipedia",
  label: "Wikipedia (public API)",

  // Keyless public API: always available unless explicitly disabled by the router.
  isConfigured() {
    return true;
  },

  async search(query, limit, signal) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", query.replace(/["\\]/g, " ").trim());
    url.searchParams.set("srlimit", String(Math.min(Math.max(limit, 1), 50)));
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");

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
        e instanceof Error ? e.message.slice(0, 200) : "Wikipedia request failed",
      );
    }

    if (status !== 200) {
      throw new ProviderError(
        classifyHttpFailure(status, text),
        `Wikipedia search failed (${status}): ${text.slice(0, 180)}`,
        status,
      );
    }

    let json: { query?: { search?: WikiSearchResult[] } };
    try {
      json = JSON.parse(text) as { query?: { search?: WikiSearchResult[] } };
    } catch {
      throw new ProviderError("bad_response", "Wikipedia returned non-JSON");
    }

    const hits: DiscoveryHit[] = [];
    for (const item of json.query?.search ?? []) {
      const title = stripTags(item.title);
      if (!title) continue;
      hits.push({
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        title,
        description: stripTags(item.snippet),
        snippet: `${title} ${stripTags(item.snippet)}`.trim(),
        provider: "wikipedia",
      });
    }
    return hits;
  },
};
