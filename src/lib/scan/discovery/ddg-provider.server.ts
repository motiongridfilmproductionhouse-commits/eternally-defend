/**
 * Keyless public-web discovery adapter (DuckDuckGo HTML endpoint).
 *
 * This is a FALLBACK discovery layer so general public-web exposure keeps being
 * observed when the paid providers (Brave / SerpApi / Firecrawl) are rate
 * limited or out of credits. It returns only public result URLs and titles.
 * It never produces enforcement, contact, ownership or takedown signals, and
 * results are name-filtered downstream exactly like every other provider.
 */

import {
  classifyHttpFailure,
  classifyThrownFailure,
  fetchJsonWithTimeout,
  ProviderError,
  type SearchProviderAdapter,
} from "./provider";
import type { DiscoveryHit } from "./types";

const ENDPOINT = "https://html.duckduckgo.com/html/";
const TIMEOUT_MS = 12_000;
const USER_AGENT = "Mozilla/5.0 (compatible; EternaSentinel/1.0; public web discovery)";

function decodeEntities(value: string): string {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X"))
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
        hellip: "…",
        rsquo: "\u2019",
        lsquo: "\u2018",
        ldquo: "\u201c",
        rdquo: "\u201d",
        ndash: "\u2013",
        mdash: "\u2014",
      };
      return named[code.toLowerCase()] ?? whole;
    })
    .trim();
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

/** DuckDuckGo wraps some links as /l/?uddg=<encoded target>. */
function resolveTarget(href: string): string | null {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const wrapped = url.searchParams.get("uddg");
    const target = new URL(wrapped ? decodeURIComponent(wrapped) : url.toString());
    if (target.protocol !== "https:" && target.protocol !== "http:") return null;
    if (/(^|\.)duckduckgo\.com$/i.test(target.hostname)) return null;
    return target.toString();
  } catch {
    return null;
  }
}

export function parseDdgResults(html: string, limit: number): DiscoveryHit[] {
  const hits: DiscoveryHit[] = [];
  const seen = new Set<string>();
  const anchor =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]+class="[^"]*result__a|$)/gi;

  for (const match of html.matchAll(anchor)) {
    if (hits.length >= limit) break;
    const url = resolveTarget(decodeEntities(match[1] ?? ""));
    const title = stripTags(match[2] ?? "");
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(
      match[3] ?? "",
    );
    const description = snippetMatch ? stripTags(snippetMatch[1] ?? "") : "";
    hits.push({
      url,
      title: title.slice(0, 500),
      description,
      snippet: `${title} ${description}`.trim(),
      provider: "ddg_html",
    });
  }
  return hits;
}

export const ddgHtmlProvider: SearchProviderAdapter = {
  id: "ddg_html",
  label: "Public web (keyless)",

  // Keyless: available unless the router explicitly disables it.
  isConfigured() {
    return true;
  },

  async search(query, limit, signal) {
    const url = new URL(ENDPOINT);
    url.searchParams.set("q", query.trim());

    let status = 0;
    let text = "";
    try {
      const res = await fetchJsonWithTimeout(
        url.toString(),
        {
          method: "GET",
          headers: { accept: "text/html", "user-agent": USER_AGENT },
        },
        TIMEOUT_MS,
        signal,
      );
      status = res.status;
      text = res.text;
    } catch (e) {
      throw new ProviderError(
        classifyThrownFailure(e),
        e instanceof Error ? e.message.slice(0, 200) : "Public web request failed",
      );
    }

    if (status !== 200) {
      throw new ProviderError(
        classifyHttpFailure(status, text),
        `Public web search failed (${status})`,
        status,
      );
    }

    return parseDdgResults(text, Math.min(Math.max(limit, 1), 50));
  },
};
