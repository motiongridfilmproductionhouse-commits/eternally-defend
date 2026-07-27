import type { RawHit, ClassifiedHit } from "./classify.server";

/**
 * Vision-based deepfake / synthetic-media classifier.
 *
 * Used when no dedicated media-forensics provider (Hive) key is configured.
 * Analyses the actual image found on the page with a multimodal model through
 * the Lovable AI gateway, so results are media-level rather than text-only.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;

const SYSTEM = `You are a cautious deepfake and synthetic-media forensics analyst.
You are shown an image found on a public page that may target a protected person.

Assess:
- synthetic_score (0-100): likelihood the image is AI-generated, face-swapped or digitally manipulated
- explicit_score (0-100): how sexual/intimate the imagery is
- depicts_person: whether a human face is clearly visible
- category: one of deepfake, synthetic_media, explicit_content_page, real_media, not_confirmed
- reasoning: one or two cautious sentences, never asserting allegations as proven

Return JSON only:
{"synthetic_score":0,"explicit_score":0,"depicts_person":false,"category":"not_confirmed","reasoning":""}`;

function mediaUrlOf(hit: RawHit): string | null {
  const h = hit as RawHit & {
    image_url?: string;
    media_url?: string;
    thumbnail_url?: string;
  };
  for (const candidate of [h.media_url, h.image_url, h.thumbnail_url]) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }
  if (IMAGE_EXTENSIONS.test(hit.url)) return hit.url;
  return null;
}

type VisionVerdict = {
  synthetic_score: number;
  explicit_score: number;
  depicts_person: boolean;
  category: string;
  reasoning: string;
};

async function analyseImage(
  imageUrl: string,
  hit: RawHit,
  apiKey: string,
): Promise<VisionVerdict | null> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Page title: ${hit.title ?? "(none)"}\nPage URL: ${hit.url}\nSearch query: ${hit.query}`,
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI gateway ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as Partial<VisionVerdict>;
    return {
      synthetic_score: Number(parsed.synthetic_score) || 0,
      explicit_score: Number(parsed.explicit_score) || 0,
      depicts_person: Boolean(parsed.depicts_person),
      category: String(parsed.category ?? "not_confirmed"),
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return null;
  }
}

function toClassified(
  hit: RawHit,
  mediaUrl: string,
  verdict: VisionVerdict,
): ClassifiedHit {
  const synthetic = verdict.synthetic_score;
  const explicit = verdict.explicit_score;

  let risk: ClassifiedHit["risk_level"];
  let category: string;

  if (synthetic >= 70 && explicit >= 60) {
    risk = "CRITICAL";
    category = "deepfake";
  } else if (synthetic >= 70) {
    risk = "HIGH";
    category = "deepfake";
  } else if (synthetic >= 45 || explicit >= 70) {
    risk = "MEDIUM";
    category = synthetic >= 45 ? "synthetic_media" : "explicit_content_page";
  } else {
    risk = "LOW";
    category = "not_confirmed";
  }

  const confidence = Math.round(Math.max(synthetic, explicit));

  return {
    ...hit,
    media_url: mediaUrl,
    risk_level: risk,
    content_category: category,
    confidence,
    is_synthetic: synthetic >= 45,
    face_referenced: verdict.depicts_person,
    takedown_recommended: risk === "CRITICAL" || risk === "HIGH",
    ai_reasoning:
      `AI vision analysis: synthetic ${Math.round(synthetic)}%, explicit ${Math.round(explicit)}%. ` +
      verdict.reasoning,
    classification_status: "completed",
    visibility: risk === "LOW" ? "triage" : "primary",
  } as ClassifiedHit;
}

export function isVisionClassifierConfigured(): boolean {
  return Boolean(process.env.LOVABLE_API_KEY?.trim());
}

export async function classifyHitsWithVision(
  hits: RawHit[],
): Promise<ClassifiedHit[]> {
  const apiKey = process.env.LOVABLE_API_KEY?.trim();
  if (!apiKey) return [];

  const output: ClassifiedHit[] = [];
  const batchSize = 3;

  for (let start = 0; start < hits.length; start += batchSize) {
    const batch = hits.slice(start, start + batchSize);

    const results = await Promise.all(
      batch.map(async (hit) => {
        const mediaUrl = mediaUrlOf(hit);

        if (!mediaUrl) {
          return {
            ...hit,
            risk_level: "LOW",
            content_category: "unclassified",
            confidence: 0,
            is_synthetic: false,
            face_referenced: false,
            takedown_recommended: false,
            ai_reasoning:
              "Page found, but no publicly accessible image was available for media analysis.",
            classification_status: "no_media",
            visibility: "triage",
          } as ClassifiedHit;
        }

        try {
          const verdict = await analyseImage(mediaUrl, hit, apiKey);
          if (!verdict) throw new Error("unparsable model response");
          return toClassified(hit, mediaUrl, verdict);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.warn("[DEEPFAKE:VISION] analysis failed:", {
            url: hit.url,
            mediaUrl,
            error: message,
          });
          return {
            ...hit,
            media_url: mediaUrl,
            risk_level: "LOW",
            content_category: "unclassified",
            confidence: 0,
            is_synthetic: false,
            face_referenced: false,
            takedown_recommended: false,
            ai_reasoning: `Media analysis unavailable: ${message}`,
            classification_status: "provider_error",
            visibility: "triage",
          } as ClassifiedHit;
        }
      }),
    );

    output.push(...results);
  }

  console.log("[DEEPFAKE:VISION] Summary:", {
    submitted: hits.length,
    analysed: output.filter((i) => i.classification_status === "completed")
      .length,
    flagged: output.filter((i) => i.visibility === "primary").length,
  });

  return output;
}
