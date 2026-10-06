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
    const res = await firecrawlFetch("/scrape", { url, formats: ["markdown"], onlyMainContent: true });
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
  title?: string; description?: string; text?: string;
}): Promise<AiInsight | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  const textPart = [
    `URL: ${input.url}`, `Platform: ${input.platform}`, `Content type: ${input.contentType}`,
    `Title: ${input.title ?? "n/a"}`, `Caption/description: ${input.description ?? "n/a"}`,
    input.text ? `Page text (excerpt): ${input.text.slice(0, 3000)}` : "",
  ].filter(Boolean).join("\n");
  const content: Record<string, unknown>[] = [{ type: "input_text", text: textPart }];
  if (input.thumbnail) content.push({ type: "input_image", image_url: input.thumbnail, detail: "high" });

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        instructions:
          "You review public online content submitted for a removal request. Using the thumbnail image (including any on-screen text, in any language such as Malayalam) and the caption, describe in 2 to 3 plain English sentences what the content shows and claims. Then name the most likely policy issue. Only state what is visible or written; never invent facts. If the thumbnail is missing, say the assessment is based on text only.",
        input: [{ role: "user", content }],
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: "removal_insight", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok || !res.body) return null;
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
