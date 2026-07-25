import { GoogleGenAI } from "@google/genai";

// Cautious classifier for deepfake / synthetic-media search hits.
// Uses Google Gemini directly via GOOGLE_API_KEY.

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface RawHit {
  url: string;
  title?: string;
  description?: string;
  query: string;
}

export interface ClassifiedHit extends RawHit {
  risk_level: RiskLevel;
  content_category: string;
  confidence: number;
  is_synthetic: boolean;
  face_referenced: boolean;
  takedown_recommended: boolean;
  ai_reasoning: string;

  classification_status?: "completed" | "no_media" | "provider_error" | "failed";
  visibility?: "primary" | "triage";
  media_url?: string;
  hive_deepfake_score?: number;
  hive_ai_generated_score?: number;
  hive_raw?: unknown;
}

const SYSTEM = `You are Eterna Sentinel's cautious deepfake and synthetic-media triage classifier.

For every public search result, classify:
- risk_level:
  CRITICAL: deepfake pornography, AI intimate imagery, fake leaked intimate content, identity abuse
  HIGH: face swaps, explicit manipulation, viral fake media
  MEDIUM: discussions, rumours, AI-generated memes
  LOW: news, research, educational references, unrelated
- content_category: deepfake_porn, face_swap, fake_leak, ai_nudes, discussion, news_report, educational, research, unrelated
- is_synthetic: true only when the page clearly describes or appears to host synthetic or manipulated media of the target
- face_referenced: true when the target's face or likeness is specifically mentioned
- takedown_recommended: true only for CRITICAL or HIGH actionable results
- confidence: integer from 0 to 100
- ai_reasoning: one or two cautious sentences

Never assert that allegations are proven.
Use phrases such as "appears to describe" or "claims to host".
When uncertain, use LOW and set all boolean risk flags to false.

Return valid JSON only in this exact structure:
{
  "items": [
    {
      "index": 0,
      "risk_level": "LOW",
      "content_category": "unrelated",
      "confidence": 0,
      "is_synthetic": false,
      "face_referenced": false,
      "takedown_recommended": false,
      "ai_reasoning": ""
    }
  ]
}`;

interface GeminiItem {
  index?: number;
  risk_level?: string;
  content_category?: string;
  confidence?: number;
  is_synthetic?: boolean;
  face_referenced?: boolean;
  takedown_recommended?: boolean;
  ai_reasoning?: string;
}

interface GeminiOutput {
  items?: GeminiItem[];
}

export async function classifyHits(
  hits: RawHit[],
  target: { name: string; aliases: string[]; handles: string[] },
): Promise<ClassifiedHit[]> {
  const key = process.env.GOOGLE_API_KEY;

  if (!key) {
    throw new Error("GOOGLE_API_KEY missing");
  }

  if (!hits.length) {
    return [];
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const CHUNK = 15;
  const out: ClassifiedHit[] = [];

  for (let i = 0; i < hits.length; i += CHUNK) {
    const chunk = hits.slice(i, i + CHUNK);

    const payload = {
      target,
      results: chunk.map((hit, index) => ({
        index,
        url: hit.url,
        title: hit.title ?? "",
        description: hit.description ?? "",
        query: hit.query,
      })),
    };

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `${SYSTEM}\n\nClassify all of these search results:\n` +
                  JSON.stringify(payload),
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const content = response.text ?? "{}";

      let parsed: GeminiOutput = {};

      try {
        parsed = JSON.parse(content) as GeminiOutput;
      } catch (error) {
        console.warn("[deepfake:classify] invalid JSON", error);
      }

      const byIndex = new Map<number, GeminiItem>();

      for (const item of parsed.items ?? []) {
        const index = Number(item.index);

        if (Number.isInteger(index)) {
          byIndex.set(index, item);
        }
      }

      chunk.forEach((hit, index) => {
        const result = byIndex.get(index);

        if (!result) {
          out.push(fallback(hit));
          return;
        }

        const riskText = String(result.risk_level ?? "LOW").toUpperCase();

        const riskLevel: RiskLevel =
          riskText === "CRITICAL" ||
          riskText === "HIGH" ||
          riskText === "MEDIUM" ||
          riskText === "LOW"
            ? riskText
            : "LOW";

        out.push({
          ...hit,
          risk_level: riskLevel,
          content_category: String(
            result.content_category ?? "unclassified",
          ).slice(0, 60),
          confidence: clampConfidence(result.confidence),
          is_synthetic: result.is_synthetic === true,
          face_referenced: result.face_referenced === true,
          takedown_recommended:
            result.takedown_recommended === true &&
            (riskLevel === "CRITICAL" || riskLevel === "HIGH"),
          ai_reasoning: String(result.ai_reasoning ?? "").slice(0, 600),
        });
      });
    } catch (error) {
      console.warn("[deepfake:classify] Gemini request failed", error);

      for (const hit of chunk) {
        out.push(fallback(hit));
      }
    }
  }

  return out;
}

function clampConfidence(value: unknown): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function fallback(hit: RawHit): ClassifiedHit {
  return {
    ...hit,
    risk_level: "LOW",
    content_category: "unclassified",
    confidence: 0,
    is_synthetic: false,
    face_referenced: false,
    takedown_recommended: false,
    ai_reasoning: "Classifier unavailable; manual review is required.",
  };
}
