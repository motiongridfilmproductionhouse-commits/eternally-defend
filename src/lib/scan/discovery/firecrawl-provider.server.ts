/**
 * Firecrawl discovery adapter — the only search provider (see search-policy.ts).
 *
 * A Firecrawl failure (402 credits, 429 rate limit, timeout, auth) marks the
 * provider unhealthy for the scan and is reported honestly.
 */

import { firecrawlSearch } from "@/lib/firecrawl/firecrawl.server";
import { classifyHttpFailure, ProviderError, type SearchProviderAdapter } from "./provider";
import type { DiscoveryHit } from "./types";

export function makeFirecrawlProvider(opts?: {
  id?: string;
  label?: string;
  sources?: Array<"web" | "news" | "images">;
  /** Appended to every query, e.g. "site:youtube.com". */
  querySuffix?: string;
}): SearchProviderAdapter {
  return {
    id: (opts?.id ?? "firecrawl") as SearchProviderAdapter["id"],
    label: opts?.label ?? "Firecrawl",

    isConfigured() {
      return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
    },

    async search(query, limit) {
      const res = await firecrawlSearch({
        query: opts?.querySuffix ? `${query} ${opts.querySuffix}` : query,
        limit: Math.min(Math.max(limit, 1), 10),
        sources: opts?.sources ?? ["web", "news"],
      });

      if (!res.success) {
        const kind =
          res.errorCode === "RATE_LIMITED"
            ? "rate_limited"
            : res.errorCode === "AUTH_ERROR"
              ? "auth_failed"
              : res.errorCode === "TIMEOUT"
                ? "timeout"
                : classifyHttpFailure(res.statusCode ?? 0, res.error ?? "");
        throw new ProviderError(kind, res.error ?? "Firecrawl search failed", res.statusCode);
      }

      return res.items.map<DiscoveryHit>((item) => {
        const meta = (item.metadata ?? {}) as Record<string, unknown>;
        const img =
          item.ogImage ??
          (typeof meta.imageUrl === "string" ? meta.imageUrl : undefined) ??
          (typeof (item as unknown as { imageUrl?: string }).imageUrl === "string"
            ? (item as unknown as { imageUrl: string }).imageUrl
            : undefined);
        return {
          url: item.url,
          title: item.title || "",
          description: item.snippet || item.description || "",
          snippet: item.snippet,
          author: item.author,
          date: item.publishedDate || item.date,
          publishedDate: item.publishedDate || item.date,
          media: img ? { thumbnail: img, thumbnailHi: img } : undefined,
          provider: "firecrawl",
        };
      });
    },
  };
}

export const firecrawlProvider: SearchProviderAdapter = makeFirecrawlProvider();
