/**
 * Reference analysis + reverse-discovery for the Copyright Intelligence engine.
 *
 * No SerpApi / Google Lens. The reference frame is analysed with AI vision
 * (title, OCR text, watermarks, visual descriptors), and those signals drive
 * Firecrawl web + image search to surface possible re-uploads, screenshots,
 * trailer copies, clips and piracy sources.
 */

import { firecrawlFetch, isFirecrawlConfigured } from "@/lib/firecrawl-client.server";
import { canonicalUrl, hostOf, type DiscoveryCandidate } from "./url.server";

export interface ReferenceAnalysis {
  title: string | null;
  /** short search phrases describing the exact frame */
  descriptors: string[];
  /** visible on-screen / printed text */
  ocrText: string | null;
  /** studio, distributor or site watermark burned into the frame */
  watermark: string | null;
  /** visual fingerprint notes (palette, composition, subjects) */
  visualFeatures: string[];
  mediaType: string | null;
}

interface GatewayResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const ANALYSIS_SYSTEM = `You analyse a rights-holder's reference frame (poster, artwork, still or video frame).
Return JSON:
{
  "title": string,            // the film/show/artwork it belongs to, "" if unsure
  "descriptors": string[],    // 4-8 short search phrases describing this exact frame
  "ocrText": string,          // ALL visible text, verbatim ("" if none)
  "watermark": string,        // any burned-in watermark / studio / site brand ("" if none)
  "visualFeatures": string[], // 3-6 notes: palette, composition, subjects, framing
  "mediaType": string         // poster | artwork | still | screenshot | trailer_frame | unknown
}
Respond with JSON only.`;

/** AI-vision analysis of the reference frame. */
export async function analyzeReference(
  referenceDataUrl: string,
  workTitle: string,
): Promise<ReferenceAnalysis> {
  const key = process.env.LOVABLE_API_KEY;
  const fallback: ReferenceAnalysis = {
    title: workTitle,
    descriptors: [],
    ocrText: null,
    watermark: null,
    visualFeatures: [],
    mediaType: null,
  };
  if (!key) return fallback;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: ANALYSIS_SYSTEM },
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
    if (!res.ok) return fallback;
    const json = (await res.json()) as GatewayResponse;
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const list = (v: unknown, n: number) =>
      Array.isArray(v) ? v.map((d) => String(d).slice(0, 80)).filter(Boolean).slice(0, n) : [];
    return {
      title: parsed.title ? String(parsed.title).slice(0, 120) : workTitle,
      descriptors: list(parsed.descriptors, 8),
      ocrText: parsed.ocrText ? String(parsed.ocrText).slice(0, 1500) : null,
      watermark: parsed.watermark ? String(parsed.watermark).slice(0, 200) : null,
      visualFeatures: list(parsed.visualFeatures, 6),
      mediaType: parsed.mediaType ? String(parsed.mediaType).slice(0, 40) : null,
    };
  } catch {
    return fallback;
  }
}

interface FcImage {
  url?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  sourceUrl?: string;
}
interface FcWeb { url?: string; title?: string; description?: string }
interface FcResponse { data?: { web?: FcWeb[]; images?: FcImage[] }; error?: string }

async function search(query: string): Promise<{ query: string; payload: FcResponse | null }> {
  try {
    const res = await firecrawlFetch("/search", {
      query,
      limit: 10,
      sources: ["web", "images"],
    });
    if (!res.ok) return { query, payload: null };
    return { query, payload: (await res.json()) as FcResponse };
  } catch {
    return { query, payload: null };
  }
}

/** Capture a screenshot of a page so the grader has visual evidence. */
async function screenshot(url: string): Promise<string | null> {
  try {
    const res = await firecrawlFetch("/scrape", {
      url,
      formats: ["screenshot"],
      onlyMainContent: true,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      screenshot?: string;
      data?: { screenshot?: string };
    };
    const shot = json.screenshot ?? json.data?.screenshot ?? null;
    if (!shot) return null;
    return shot.startsWith("data:") || shot.startsWith("http")
      ? shot
      : `data:image/png;base64,${shot}`;
  } catch {
    return null;
  }
}

const PIRACY_HINTS = /(download|watch|free|full[- ]?movie|hdrip|camrip|webrip|torrent|telegram|leak|1080p|720p|dual[- ]?audio|filmy|movierulz|tamilrockers)/i;

function buildQueries(a: ReferenceAnalysis, workTitle: string): string[] {
  const base = (a.title || workTitle).trim();
  const ocrPhrase = (a.ocrText ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 6 && l.length < 60)[0];

  const queries = [
    `"${base}" poster hd image download`,
    `"${base}" full movie watch online free download`,
    `${base} hdrip webrip 1080p download`,
    `${base} movie screenshot still frame`,
    `${base} trailer clip mp4 download`,
    ...a.descriptors.slice(0, 3).map((d) => `${base} ${d}`),
    ...a.visualFeatures.slice(0, 2).map((f) => `${base} ${f}`),
  ];
  if (ocrPhrase) queries.push(`"${ocrPhrase}" ${base}`);
  if (a.watermark) queries.push(`${base} ${a.watermark}`);
  return [...new Set(queries.filter(Boolean))].slice(0, 12);
}

/**
 * Discover candidate re-uploads with Firecrawl, seeded by the AI-vision
 * analysis of the reference frame.
 */
export async function firecrawlDiscover(
  referenceDataUrl: string,
  workTitle: string,
  frameIndex: number,
  analysis?: ReferenceAnalysis,
): Promise<DiscoveryCandidate[]> {
  if (!isFirecrawlConfigured()) {
    throw new Error(
      "Reverse discovery is not configured. Connect Firecrawl to run copyright detection.",
    );
  }

  const a = analysis ?? (await analyzeReference(referenceDataUrl, workTitle));
  const queries = buildQueries(a, workTitle);

  const seen = new Set<string>();
  const out: DiscoveryCandidate[] = [];
  const webLeads: Array<{ url: string; title: string | null; query: string }> = [];

  const results = await Promise.all(queries.map(search));

  for (const { query, payload } of results) {
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
        exact: PIRACY_HINTS.test(`${img.title ?? ""} ${key}`),
        frameIndex,
        query,
      });
    }

    for (const web of payload?.data?.web ?? []) {
      if (!web.url) continue;
      const key = canonicalUrl(web.url);
      if (seen.has(key)) continue;
      const text = `${web.title ?? ""} ${web.description ?? ""} ${key}`;
      if (!PIRACY_HINTS.test(text)) continue;
      seen.add(key);
      webLeads.push({ url: key, title: web.title ?? null, query });
    }
  }

  // Capture screenshots for the strongest page-only piracy leads so the
  // grader always has visual evidence to compare against.
  const shots = await Promise.all(
    webLeads.slice(0, 6).map(async (lead) => ({ lead, shot: await screenshot(lead.url) })),
  );
  for (const { lead, shot } of shots) {
    if (!shot) continue;
    out.push({
      url: lead.url,
      title: lead.title,
      source: hostOf(lead.url),
      thumbnail: shot,
      imageUrl: shot,
      exact: true,
      frameIndex,
      query: lead.query,
    });
  }

  return out.slice(0, 40);
}
