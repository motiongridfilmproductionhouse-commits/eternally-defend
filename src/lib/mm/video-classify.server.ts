/**
 * Classifies transcript segments into cautious defamation-adjacent categories.
 * Uses Lovable AI Gateway (Gemini) with strict rules:
 *   - Never label a claim "false" or "confirmed defamation".
 *   - Distinguish direct allegation / quoted / opinion / criticism / news
 *     reporting / satire / denial / clarification / harassment / potentially
 *     defamatory / insufficient evidence.
 *   - Return "insufficient_evidence" whenever a segment does not clearly
 *     mention the protected entity or does not contain an assessable claim.
 */

import type { TimedCaptionSegment } from "./youtube-captions.server";

export type ContextType =
  | "direct_allegation"
  | "quoted_allegation"
  | "opinion"
  | "criticism"
  | "news_reporting"
  | "satire"
  | "denial"
  | "response_clarification"
  | "harassment"
  | "potentially_defamatory"
  | "insufficient_evidence";

export type SpeakerStance = "supports" | "rejects" | "quotes" | "neutral";
export type Severity = "low" | "medium" | "high" | "critical";

export interface ClassifiedFinding {
  segmentIndex: number; // index into the segments array passed in
  matchedEntity: string;
  claimSummary: string;
  contextType: ContextType;
  speakerStance: SpeakerStance;
  riskCategory: string;
  severity: Severity;
  confidence: number;
  translatedText?: string;
  translationLanguage?: string;
  contextBefore?: string;
  contextAfter?: string;
}

const SYSTEM = `You are Eterna, a cautious reputation-intelligence classifier.
Rules — follow strictly:
- Only mark a segment relevant when it mentions the protected entity (or a variant) AND contains something assessable.
- Never label a claim "false", "confirmed defamation", or "defamation". Use "potentially_defamatory" only for statements of fact that could damage reputation and require legal review.
- Distinguish the categories precisely:
  direct_allegation: speaker themselves alleges wrongdoing.
  quoted_allegation: speaker reports someone else's allegation.
  opinion: subjective view, not fact.
  criticism: negative but non-defamatory critique.
  news_reporting: neutral reporting of an event.
  satire: comedic/parody framing.
  denial: speaker denies a claim about the entity.
  response_clarification: speaker clarifies or responds on behalf of / about the entity.
  harassment: targeted abuse, threats, doxxing.
  potentially_defamatory: factual assertion damaging to reputation, needs legal review.
  insufficient_evidence: segment doesn't clearly contain an assessable statement about the entity.
- Prefer "insufficient_evidence" when unsure. Do NOT invent context that isn't in the transcript.
- Confidence is 0-100 for how confident you are in the category, not in the truth of the claim.
- Return original wording verbatim; translate only into English when the segment is not English.
Return JSON only.`;

interface GeminiResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function classifyTranscriptSegments(
  segments: TimedCaptionSegment[],
  entityTerms: string[],
  captionLanguage: string | undefined,
): Promise<{ findings: ClassifiedFinding[]; error?: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { findings: [], error: "LOVABLE_API_KEY missing" };
  if (!segments.length) return { findings: [] };

  // Coarse pre-filter: keep only segments that mention the entity OR sit
  // adjacent to a mention. This bounds tokens sent to the model.
  const nameRe = entityTerms.length
    ? new RegExp(
        entityTerms
          .filter(Boolean)
          .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|"),
        "i",
      )
    : null;

  const kept = new Set<number>();
  if (nameRe) {
    for (const s of segments) if (nameRe.test(s.text)) {
      kept.add(s.index);
      if (s.index > 0) kept.add(s.index - 1);
      if (s.index < segments.length - 1) kept.add(s.index + 1);
    }
  } else {
    // No entity terms → send a small sample to avoid over-classification.
    segments.slice(0, 40).forEach((s) => kept.add(s.index));
  }
  const targetSegments = segments.filter((s) => kept.has(s.index));
  if (!targetSegments.length) return { findings: [] };

  // Chunk to keep prompt size reasonable.
  const CHUNK = 25;
  const findings: ClassifiedFinding[] = [];
  for (let i = 0; i < targetSegments.length; i += CHUNK) {
    const chunk = targetSegments.slice(i, i + CHUNK);
    const payload = {
      protectedEntities: entityTerms,
      captionLanguage: captionLanguage ?? "unknown",
      segments: chunk.map((s) => ({
        segmentIndex: s.index,
        start: s.startSeconds,
        end: s.endSeconds,
        text: s.text,
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
                "Classify each segment. Return JSON: { findings: [{ segmentIndex, matchedEntity, claimSummary, contextType, speakerStance, riskCategory, severity, confidence, translatedText?, translationLanguage? }] }. Include only segments that are NOT insufficient_evidence.\n\n" +
                JSON.stringify(payload),
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[video-classify]", res.status, txt.slice(0, 200));
        continue;
      }
      const j = (await res.json()) as GeminiResponse;
      const content = j.choices?.[0]?.message?.content ?? "{}";
      let parsed: unknown;
      try { parsed = JSON.parse(content); } catch { continue; }
      const arr = (parsed as { findings?: unknown[] })?.findings;
      if (!Array.isArray(arr)) continue;
      for (const f of arr) {
        if (!f || typeof f !== "object") continue;
        const r = f as Record<string, unknown>;
        const segmentIndex = Number(r.segmentIndex);
        if (!Number.isFinite(segmentIndex)) continue;
        const contextType = String(r.contextType ?? "insufficient_evidence") as ContextType;
        if (contextType === "insufficient_evidence") continue;
        findings.push({
          segmentIndex,
          matchedEntity: String(r.matchedEntity ?? "").slice(0, 160),
          claimSummary: String(r.claimSummary ?? "").slice(0, 500),
          contextType,
          speakerStance: (String(r.speakerStance ?? "neutral") as SpeakerStance),
          riskCategory: String(r.riskCategory ?? "unspecified").slice(0, 80),
          severity: (String(r.severity ?? "low").toLowerCase() as Severity),
          confidence: Math.max(0, Math.min(100, Number(r.confidence ?? 0))),
          translatedText: r.translatedText ? String(r.translatedText).slice(0, 1000) : undefined,
          translationLanguage: r.translationLanguage ? String(r.translationLanguage).slice(0, 8) : undefined,
        });
      }
    } catch (e) {
      console.error("[video-classify] network:", e);
    }
  }
  return { findings };
}

/** hh:mm:ss format for display. */
export function formatTimeDisplay(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}
