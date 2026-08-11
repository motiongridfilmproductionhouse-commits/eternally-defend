/**
 * Firecrawl discovery adapter — OPTIONAL provider.
 *
 * A Firecrawl failure (402 credits, 429 rate limit, timeout, auth) marks the
 * provider unhealthy for the scan; the router keeps discovering with others.
 */

import { firecrawlSearch } from "@/lib/firecrawl/firecrawl.server";
import { classifyHttpFailure, ProviderError, type SearchProviderAdapter } from "./provider";
import type { DiscoveryHit } from "./types";

export const firecrawlProvider: SearchProviderAdapter = {
  id: "firecrawl",
  label: "Firecrawl",

  isConfigured() {
    return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
  },

  async search(query, limit) {
    const res = await firecrawlSearch({
      query,
      limit: Math.min(Math.max(limit, 1), 10),
      sources: ["web", "news"],
    });

    if (!res.success) {
      const kind =
        res.errorCode === "INSUFFICIENT_CREDITS"
          ? "credits_exhausted"
          : classifyHttpFailure(res.statusCode ?? 0, res.error ?? "");
      throw new ProviderError(kind, res.error ?? "Firecrawl search failed", res.statusCode);
    }

    return res.items.map<DiscoveryHit>((item) => ({
      url: item.url,
      title: item.title || "",
      description: item.snippet || item.description || "",
      snippet: item.snippet,
      author: item.author,
      date: item.publishedDate || item.date,
      publishedDate: item.publishedDate || item.date,
      media: item.ogImage ? { thumbnail: item.ogImage, thumbnailHi: item.ogImage } : undefined,
      provider: "firecrawl",
    }));
  },
};
