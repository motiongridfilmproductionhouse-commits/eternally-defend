/**
 * Google Programmable Search (Custom Search JSON API) discovery adapter.
 * Server-only: reads GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID from
 * process.env inside the handler, never exposed to the client bundle.
 */

import {
  classifyHttpFailure,
  classifyThrownFailure,
  fetchJsonWithTimeout,
  ProviderError,
  type SearchProviderAdapter,
} from "./provider";
import type { DiscoveryHit } from "./types";

const ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const TIMEOUT_MS = 14_000;
/** CSE returns max 10 results per request; page beyond that with `start`. */
const PAGE_SIZE = 10;
const MAX_PAGES = 2;

interface CseItem {
  link?: string;
  title?: string;
  snippet?: string;
  displayLink?: string;
  pagemap?: {
    cse_thumbnail?: Array<{ src?: string }>;
    cse_image?: Array<{ src?: string }>;
    metatags?: Array<Record<string, string>>;
  };
}

function creds(): { key: string; cx: string } {
  return {
    key: (process.env.GOOGLE_SEARCH_API_KEY ?? "").trim(),
    cx: (process.env.GOOGLE_SEARCH_ENGINE_ID ?? "").trim(),
  };
}

function toHit(item: CseItem): DiscoveryHit | null {
  if (!item.link) return null;
  const thumb = item.pagemap?.cse_thumbnail?.[0]?.src ?? item.pagemap?.cse_image?.[0]?.src;
  const meta = item.pagemap?.metatags?.[0] ?? {};
  const published =
    meta["article:published_time"] ?? meta["og:updated_time"] ?? meta["date"] ?? undefined;
  return {
    url: item.link,
    title: item.title ?? "",
    description: item.snippet ?? "",
    snippet: item.snippet,
    author: meta["article:author"] ?? item.displayLink,
    date: published,
    publishedDate: published,
    media: thumb ? { thumbnail: thumb, thumbnailHi: thumb } : undefined,
    provider: "google",
  };
}

/**
 * DISABLED BY DEFAULT. The saved key's Google Cloud project does not have the
 * Custom Search JSON API enabled (hard 403 "project does not have the access"),
 * so the adapter is kept but reports NOT_CONFIGURED unless explicitly re-enabled
 * with SCAN_ENABLE_GOOGLE_CSE=true. Google-backed discovery now runs through
 * the Gemini grounding provider instead.
 */
export const googleProvider: SearchProviderAdapter = {
  id: "google",
  label: "Google Programmable Search",

  isConfigured() {
    if (process.env.SCAN_ENABLE_GOOGLE_CSE?.trim() !== "true") return false;
    const { key, cx } = creds();
    return Boolean(key && cx);
  },

  async search(query, limit, signal) {
    const { key, cx } = creds();
    if (!key || !cx) {
      throw new ProviderError(
        "auth_failed",
        "GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_ENGINE_ID not configured",
      );
    }

    const wanted = Math.min(Math.max(limit, 1), PAGE_SIZE * MAX_PAGES);
    const hits: DiscoveryHit[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < MAX_PAGES && hits.length < wanted; page++) {
      const start = page * PAGE_SIZE + 1;
      const num = Math.min(PAGE_SIZE, wanted - hits.length);

      const url = new URL(ENDPOINT);
      url.searchParams.set("key", key);
      url.searchParams.set("cx", cx);
      url.searchParams.set("q", query);
      url.searchParams.set("num", String(num));
      url.searchParams.set("start", String(start));
      url.searchParams.set("safe", "off");

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
        if (hits.length) break;
        throw new ProviderError(
          classifyThrownFailure(e),
          e instanceof Error ? e.message.slice(0, 200) : "Google CSE request failed",
        );
      }

      if (status !== 200) {
        // Daily-quota exhaustion arrives as 429 or 403 with a quota reason.
        const kind = /quota|dailyLimitExceeded|rateLimitExceeded/i.test(text)
          ? status === 403
            ? "credits_exhausted"
            : "rate_limited"
          : classifyHttpFailure(status, text);
        if (hits.length) break;
        throw new ProviderError(
          kind,
          `Google CSE failed (${status}): ${text.slice(0, 180)}`,
          status,
        );
      }

      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        if (hits.length) break;
        throw new ProviderError("bad_response", "Google CSE returned non-JSON");
      }

      const items = Array.isArray(json.items) ? (json.items as CseItem[]) : [];
      for (const item of items) {
        const hit = toHit(item);
        if (!hit?.url || seen.has(hit.url)) continue;
        seen.add(hit.url);
        hits.push(hit);
      }
      if (items.length < num) break;
    }

    return hits;
  },
};
