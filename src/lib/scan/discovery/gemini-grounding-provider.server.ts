/**
 * Gemini Grounding with Google Search — Google-backed discovery/research layer.
 *
 * Replaces the (disabled) Custom Search JSON API provider as the Google-backed
 * source of candidate URLs. Gemini is asked to research the query with the
 * built-in `google_search` tool; ONLY the grounding source URLs are harvested.
 * Nothing the model writes is used as evidence — the URLs enter the normal
 * candidate pool and go through dedup → Crawl4AI extract → verify → reason.
 *
 * Server-only: reads keys from process.env inside the handler.
 */

import {
  classifyHttpFailure,
  classifyThrownFailure,
  fetchJsonWithTimeout,
  ProviderError,
  type SearchProviderAdapter,
} from "./provider";
import type { DiscoveryHit } from "./types";

const MODEL = () => process.env.GEMINI_GROUNDING_MODEL?.trim() || "gemini-2.5-flash";
const TIMEOUT_MS = 20_000;
const REDIRECT_TIMEOUT_MS = 6_000;

function apiKey(): string {
  return (
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.GOOGLE_SEARCH_API_KEY ??
    ""
  ).trim();
}

interface GroundingChunk {
  web?: { uri?: string; title?: string; domain?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GroundingChunk[];
      groundingSupports?: Array<{ segment?: { text?: string } }>;
      webSearchQueries?: string[];
    };
  }>;
}

/** Gemini returns vertexaisearch redirect links; resolve to the publisher URL. */
async function resolveRedirect(uri: string, signal?: AbortSignal): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com|googleusercontent\.com\/grounding/i.test(uri)) {
    return uri;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(uri, { method: "GET", redirect: "follow", signal: controller.signal });
    return res.url || uri;
  } catch {
    return uri;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export const geminiGroundingProvider: SearchProviderAdapter = {
  id: "gemini_grounding",
  label: "Gemini Grounding (Google Search)",

  isConfigured() {
    if (process.env.SCAN_DISABLE_GEMINI_GROUNDING?.trim() === "true") return false;
    return Boolean(apiKey());
  },

  async search(query, limit, signal) {
    const key = apiKey();
    if (!key) {
      throw new ProviderError("auth_failed", "GEMINI_API_KEY / GOOGLE_API_KEY not configured");
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent` +
      `?key=${encodeURIComponent(key)}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `Search the public web for pages about: ${query}\n` +
                `List the most relevant distinct source pages. Prefer news articles, blogs, forums, ` +
                `videos and social posts. Do not speculate; only cite pages you actually found.`,
            },
          ],
        },
      ],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0, maxOutputTokens: 900 },
    };

    let status = 0;
    let text = "";
    try {
      const res = await fetchJsonWithTimeout(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        TIMEOUT_MS,
        signal,
      );
      status = res.status;
      text = res.text;
    } catch (e) {
      throw new ProviderError(
        classifyThrownFailure(e),
        e instanceof Error ? e.message.slice(0, 200) : "Gemini grounding request failed",
      );
    }

    if (status !== 200) {
      const kind = /quota|rate limit|resource_exhausted/i.test(text)
        ? "rate_limited"
        : /has not been used|is disabled|SERVICE_DISABLED|PERMISSION_DENIED|does not have the access/i.test(
              text,
            )
          ? "auth_failed"
          : classifyHttpFailure(status, text);
      throw new ProviderError(
        kind,
        `Gemini grounding failed (${status}): ${text.slice(0, 180)}`,
        status,
      );
    }

    let json: GeminiResponse;
    try {
      json = JSON.parse(text) as GeminiResponse;
    } catch {
      throw new ProviderError("bad_response", "Gemini grounding returned non-JSON");
    }

    const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const cap = Math.min(Math.max(limit, 1), 20);
    const raw = chunks
      .map((c) => c.web)
      .filter((w): w is { uri?: string; title?: string; domain?: string } => Boolean(w?.uri))
      .slice(0, cap);

    const resolved = await Promise.all(
      raw.map(async (w) => ({
        url: await resolveRedirect(w.uri as string, signal),
        title: w.title ?? "",
        domain: w.domain,
      })),
    );

    const seen = new Set<string>();
    const hits: DiscoveryHit[] = [];
    for (const r of resolved) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      hits.push({
        url: r.url,
        title: r.title,
        description: "",
        author: r.domain,
        provider: "gemini_grounding",
      });
    }
    return hits;
  },
};
