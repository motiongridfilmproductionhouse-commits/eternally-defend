/**
 * Removal-link insight: fetch the post's preview thumbnail + caption (direct
 * fetch, Firecrawl fallback) and ask OpenAI (via Lovable AI Gateway Responses,
 * streamed) to describe what the content shows. Never throws; returns null
 * fields on failure. Full video frames are not available from public pages,
 * so analysis is based on the thumbnail, title and caption only.
 */
import { firecrawlFetch, isFirecrawlConfigured } from "@/lib/firecrawl-client.server";

export interface PageExtras {
  thumbnail?: string;
  title?: string;
  description?: string;
  publisher?: string;
  text?: string;
}

export async function scrapeWithFirecrawl(url: string): Promise<PageExtras | null> {
  if (!isFirecrawlConfigured()) return null;
  try {
    const res = await Promise.race([
      firecrawlFetch("/scrape", { url, formats: ["markdown"], onlyMainContent: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("firecrawl timeout")), 25_000)),
    ]);
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { markdown?: string; metadata?: Record<string, unknown> } };
    const m = j.data?.metadata ?? {};
    const s = (k: string) => {
      const v = m[k];
      return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
    };
    return {
      thumbnail: s("ogImage") ?? s("og:image") ?? s("twitter:image"),
      title: s("ogTitle") ?? s("title"),
      description: s("ogDescription") ?? s("description"),
      publisher: s("ogSiteName"),
      text: j.data?.markdown?.slice(0, 4000),
    };
  } catch {
    return null;
  }
}

export interface SocialVideo { thumbnail?: string; frames: string[]; durationSec?: number; caption?: string }

/** Facebook blocks direct reads; the linked Apify connector returns the reel's thumbnail and its 1-frame-per-second storyboard. */
export async function fetchFacebookViaApify(url: string): Promise<SocialVideo | null> {
  const lk = process.env["LOVABLE_API_KEY"], ak = process.env["APIFY_API_KEY"];
  if (!lk || !ak) return null;
  try {
    const res = await fetch(
      "https://connector-gateway.lovable.dev/apify/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items?timeout=60",
      { method: "POST", signal: AbortSignal.timeout(70_000), headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": ak, "Content-Type": "application/json" },
        body: JSON.stringify({ startUrls: [{ url }], resultsLimit: 1 }) },
    );
    if (!res.ok) return null;
    const items = (await res.json()) as Record<string, any>[];
    const d = items?.[0];
    if (!d) return null;
    const sprites: string[] =
      d.video_player_scrubber_preview_renderer?.video?.scrubber_preview_thumbnail_information?.sprite_uris ?? [];
    const caption = typeof d.text === "string" ? d.text : typeof d.message?.text === "string" ? d.message.text : undefined;
    return {
      thumbnail: d.preferred_thumbnail?.image?.uri ?? d.thumbnail ?? undefined,
      frames: sprites.filter((s) => typeof s === "string" && s.startsWith("https://")).slice(0, 4),
      durationSec: typeof d.playable_duration_in_ms === "number" ? Math.round(d.playable_duration_in_ms / 1000) : undefined,
      caption,
    };
  } catch {
    return null;
  }
}

export interface AiInsight {
  summary: string;
  detectedIssue: string;
  harmIndicators: string[];
  confidence: "low" | "medium" | "high";
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "detectedIssue", "harmIndicators", "confidence"],
  properties: {
    summary: { type: "string" },
    detectedIssue: {
      type: "string",
      enum: ["Defamation", "Impersonation", "Privacy", "Deepfake", "Copyright", "Harassment", "None evident", "Unclear"],
    },
    harmIndicators: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
};

export async function analyzeWithOpenAI(input: {
  url: string; platform: string; contentType: string; thumbnail?: string;
  title?: string; description?: string; text?: string; frames?: string[]; durationSec?: number;
}): Promise<AiInsight | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  const textPart = [
    `URL: ${input.url}`, `Platform: ${input.platform}`, `Content type: ${input.contentType}`,
    `Title: ${input.title ?? "n/a"}`, `Caption/description: ${input.description ?? "n/a"}`,
    input.text ? `Page text (excerpt): ${input.text.slice(0, 3000)}` : "",
  ].filter(Boolean).join("\n");
  const content: Record<string, unknown>[] = [{ type: "input_text", text: textPart }];
  // Social CDNs often refuse fetches from the model provider, so inline images as data URLs.
  const inline = async (src: string) => {
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const type = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      if (!type.startsWith("image/")) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > 8_000_000) return null;
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return `data:${type};base64,${btoa(bin)}`;
    } catch { return null; }
  };
  for (const src of [input.thumbnail, ...(input.frames ?? [])].filter(Boolean) as string[]) {
    const d = await inline(src);
    if (d) content.push({ type: "input_image", image_url: d, detail: "high" });
  }
  if (input.frames?.length) content.unshift({ type: "input_text", text: `The images after the first are storyboard sheets: a grid of frames taken every 1 second across the whole video${input.durationSec ? ` (${input.durationSec}s long)` : ""}, read left to right, top to bottom.` });

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions:
          "You review public online content submitted for a removal request. Using the thumbnail image (including any on-screen text, in any language such as Malayalam) and the caption, describe in 2 to 4 plain English sentences what the content shows and claims across the whole video (use storyboard frames when provided). Then name the most likely policy issue. Only state what is visible or written; never invent facts. If the thumbnail is missing, say the assessment is based on text only.",
        input: [{ role: "user", content }],
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "removal_insight", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok || !res.body) { console.error("removal insight AI", res.status, (await res.text()).slice(0, 300)); return null; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const ev = JSON.parse(d) as { type?: string; delta?: string };
          if (ev.type === "response.output_text.delta" && ev.delta) out += ev.delta;
        } catch { /* partial */ }
      }
    }
    return JSON.parse(out) as AiInsight;
  } catch {
    return null;
  }
}
