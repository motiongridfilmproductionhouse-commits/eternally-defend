/**
 * Fallback reverse-image discovery.
 *
 * SerpApi Google Lens is the preferred engine, but it needs SERPAPI_API_KEY.
 * When that key is absent we identify the reference frame with a multimodal
 * model and then hunt for re-uploads with Firecrawl web + image search.
 */

import { firecrawlFetch, isFirecrawlConfigured } from "@/lib/firecrawl-client.server";
import { canonicalUrl, hostOf, type LensCandidate } from "./lens.server";

interface IdentifiedWork {
  title: string | null;
  descriptors: string[];
}

interface GatewayResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** Ask the model what the reference frame actually depicts. */
export async function identifyWork(
  referenceDataUrl: string,
  workTitle: string,
): Promise<IdentifiedWork> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { title: workTitle, descriptors: [] };

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "You identify visual media. Given an image, return JSON " +
              '{ "title": string, "descriptors": string[] } where title is the film/show/artwork ' +
              "it belongs to (empty string if unsure) and descriptors are 3-6 short search phrases " +
              "describing the exact frame (subjects, scene, poster text, distinctive visuals).",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Owner-provided title: ${workTitle}. Respond JSON only.` },
              { type: "image_url", image_url: { url: referenceDataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { title: workTitle, descriptors: [] };
    const json = (await res.json()) as GatewayResponse;
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
    return {
      title: parsed.title ? String(parsed.title).slice(0, 120) : workTitle,
      descriptors: Array.isArray(parsed.descriptors)
        ? parsed.descriptors.map((d) => String(d).slice(0, 80)).slice(0, 6)
        : [],
    };
  } catch {
    return { title: workTitle, descriptors: [] };
  }
}

interface FcImage { url?: string; imageUrl?: string; thumbnailUrl?: string; title?: string; sourceUrl?: string }
interface FcWeb { url?: string; title?: string; description?: string }
interface FcResponse { data?: { web?: FcWeb[]; images?: FcImage[] }; error?: string }

async function search(query: string): Promise<FcResponse | null> {
  try {
    const res = await firecrawlFetch("/search", { query, limit: 10, sources: ["web", "images"] });
    if (!res.ok) return null;
    return (await res.json()) as FcResponse;
  } catch {
    return null;
  }
}

/**
 * Discover candidate re-uploads without Lens. Returns candidates shaped like
 * Lens results so the grading stage is identical.
 */
export async function firecrawlDiscover(
  referenceDataUrl: string,
  workTitle: string,
  frameIndex: number,
): Promise<LensCandidate[]> {
  if (!isFirecrawlConfigured()) {
    throw new Error(
      "Reverse image discovery is not configured. Add SERPAPI_API_KEY, or connect Firecrawl, to run copyright detection.",
    );
  }

  const work = await identifyWork(referenceDataUrl, workTitle);
  const base = (work.title || workTitle).trim();

  const queries = [
    `"${base}" poster hd download`,
    `${base} full movie watch online free`,
    `${base} screenshot still image`,
    ...work.descriptors.slice(0, 3).map((d) => `${base} ${d}`),
  ];

  const seen = new Set<string>();
  const out: LensCandidate[] = [];

  const results = await Promise.all(queries.map(search));
  for (const payload of results) {
    for (const img of payload?.data?.images ?? []) {
      const page = img.url ?? img.sourceUrl;
      const image = img.imageUrl ?? img.thumbnailUrl;
      if (!page || !image) continue;
      const key = canonicalUrl(page);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        url: key,
        title: img.title ?? null,
        source: hostOf(key),
        thumbnail: img.thumbnailUrl ?? image,
        imageUrl: image,
        exact: false,
        frameIndex,
      });
    }
  }

  return out.slice(0, 40);
}
