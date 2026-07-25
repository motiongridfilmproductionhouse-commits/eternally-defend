// Cautious classifier for deepfake / synthetic-media search hits.
// Uses Lovable AI Gateway (Gemini) via LOVABLE_API_KEY.

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
  confidence: number; // 0..100
  is_synthetic: boolean;
  face_referenced: boolean;
  takedown_recommended: boolean;
  ai_reasoning: string;
}

const SYSTEM = `You are Eterna Sentinel's cautious deepfake & synthetic-media triage classifier.
For every public search result you receive, classify along these axes:
- risk_level: CRITICAL (deepfake pornography, AI intimate imagery, fake leaked intimate content, identity abuse),
  HIGH (face swaps, explicit manipulation, viral fake media),
  MEDIUM (discussions, rumours, AI-generated memes),
  LOW (news, research, educational references, unrelated).
- content_category: short label such as "deepfake_porn", "face_swap", "fake_leak", "ai_nudes",
  "discussion", "news_report", "educational", "research", "unrelated".
- is_synthetic: true only when the page clearly describes/hosts synthetic or manipulated media of the target.
- face_referenced: true when the target's face/likeness is specifically mentioned or shown.
- takedown_recommended: true only for CRITICAL or HIGH results that appear actionable.
- confidence: 0-100, your certainty in the classification (not in the truth of the underlying claim).
- ai_reasoning: 1-2 sentences justifying the classification. Never assert defamation, criminal wrongdoing,
  or that specific content is real vs. fake. Prefer "appears to describe", "claims to host".
When unsure, downgrade to LOW and set is_synthetic/face_referenced/takedown_recommended = false.
Return JSON only.`;

interface GeminiResp { choices?: Array<{ message?: { content?: string } }> }

export async function classifyHits(
  hits: RawHit[],
  target: { name: string; aliases: string[]; handles: string[] },
): Promise<ClassifiedHit[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  if (!hits.length) return [];

  const CHUNK = 15;
  const out: ClassifiedHit[] = [];
  for (let i = 0; i < hits.length; i += CHUNK) {
    const chunk = hits.slice(i, i + CHUNK);
    const payload = {
      target,
      results: chunk.map((h, idx) => ({
        index: idx,
        url: h.url,
        title: h.title ?? "",
        description: h.description ?? "",
        query: h.query,
      })),
    };
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content:
                'Classify each result. Return JSON: { "items": [{ "index", "risk_level", "content_category", "confidence", "is_synthetic", "face_referenced", "takedown_recommended", "ai_reasoning" }] }\n\n' +
                JSON.stringify(payload),
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.warn("[deepfake:classify]", res.status, txt.slice(0, 200));
        // fall back: mark all in chunk as LOW/unclassified
        for (const h of chunk) out.push(fallback(h));
        continue;
      }
      const j = (await res.json()) as GeminiResp;
      const content = j.choices?.[0]?.message?.content ?? "{}";
      let parsed: unknown;
      try { parsed = JSON.parse(content); } catch { parsed = {}; }
      const items = (parsed as { items?: unknown[] }).items;
      const byIndex = new Map<number, Record<string, unknown>>();
      if (Array.isArray(items)) {
        for (const it of items) {
          if (it && typeof it === "object") {
            const r = it as Record<string, unknown>;
            const idx = Number(r.index);
            if (Number.isFinite(idx)) byIndex.set(idx, r);
          }
        }
      }
      chunk.forEach((h, idx) => {
        const r = byIndex.get(idx);
        if (!r) { out.push(fallback(h)); return; }
        const risk = String(r.risk_level ?? "LOW").toUpperCase();
        const risk_level: RiskLevel = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const)
          .includes(risk as RiskLevel) ? (risk as RiskLevel) : "LOW";
        out.push({
          ...h,
          risk_level,
          content_category: String(r.content_category ?? "unclassified").slice(0, 60),
          confidence: Math.max(0, Math.min(100, Math.round(Number(r.confidence ?? 0)))),
          is_synthetic: Boolean(r.is_synthetic),
          face_referenced: Boolean(r.face_referenced),
          takedown_recommended: Boolean(r.takedown_recommended),
          ai_reasoning: String(r.ai_reasoning ?? "").slice(0, 600),
        });
      });
    } catch (e) {
      console.warn("[deepfake:classify] network", e);
      for (const h of chunk) out.push(fallback(h));
    }
  }
  return out;
}

function fallback(h: RawHit): ClassifiedHit {
  return {
    ...h,
    risk_level: "LOW",
    content_category: "unclassified",
    confidence: 0,
    is_synthetic: false,
    face_referenced: false,
    takedown_recommended: false,
    ai_reasoning: "Classifier unavailable; requires manual review.",
  };
}
