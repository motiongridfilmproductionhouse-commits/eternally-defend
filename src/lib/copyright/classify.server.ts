/**
 * Evidence grading for copyright candidates.
 *
 * Each candidate image is compared against the reference frame with a
 * multimodal model. The model must justify a confidence score; anything it
 * flags as review/news/commentary/unrelated is discarded, and anything under
 * 50% is dropped by the caller.
 */

export type DetectionType =
  | "reuploaded_artwork"
  | "poster_copy"
  | "movie_screenshot"
  | "trailer_copy"
  | "video_clip"
  | "cam_recording"
  | "ripped_copy"
  | "edited_derivative"
  | "unrelated";

export interface GradedMatch {
  confidence: number;
  detectionType: DetectionType;
  transformations: string[];
  ocrText: string | null;
  watermark: string | null;
  reason: string;
  falsePositive: boolean;
}

const SYSTEM = `You are a cautious copyright-infringement evidence grader.
You compare a REFERENCE frame owned by the rights holder against a CANDIDATE image found online.

Return a confidence score 0-100 for "this candidate reproduces the reference work":
- 90-100 exact or near-exact reproduction (same frame/artwork, possibly rescaled or recompressed)
- 70-89 probable reproduction (crop, mirror, colour shift, overlay, heavy compression, re-render)
- 50-69 possible similarity that needs a human decision
- below 50 not a reproduction

Set falsePositive = true when the candidate is a review article, news report, commentary,
fan art, a different work, a stock photo, a person photo, or unrelated content that merely
shares style or subject. Never infer infringement from title text alone.

Also report:
- detectionType: one of reuploaded_artwork, poster_copy, movie_screenshot, trailer_copy,
  video_clip, cam_recording, ripped_copy, edited_derivative, unrelated
- transformations: short tags such as crop, resize, mirror, compression, watermark_added,
  logo_overlay, colour_shift, letterbox, cam_capture, text_overlay
- ocrText: visible on-screen text in the candidate (empty string if none)
- watermark: any visible watermark/site brand burned into the candidate, else empty string
- reason: one short sentence citing the concrete visual evidence.
Return JSON only.`;

interface GatewayResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

const TYPES = new Set<DetectionType>([
  "reuploaded_artwork", "poster_copy", "movie_screenshot", "trailer_copy",
  "video_clip", "cam_recording", "ripped_copy", "edited_derivative", "unrelated",
]);

export async function gradeCandidate(opts: {
  referenceDataUrl: string;
  candidateImageUrl: string;
  candidatePageUrl: string;
  candidateTitle: string | null;
  platform: string | null;
  workTitle: string;
  lensExact: boolean;
}): Promise<GradedMatch | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;

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
            content: [
              {
                type: "text",
                text:
                  `Protected work: ${opts.workTitle}\n` +
                  `Candidate page: ${opts.candidatePageUrl}\n` +
                  `Candidate platform: ${opts.platform ?? "unknown"}\n` +
                  `Candidate title: ${opts.candidateTitle ?? "(none)"}\n` +
                  `Reverse-image engine bucket: ${opts.lensExact ? "exact match" : "visually similar"}\n\n` +
                  `First image = REFERENCE. Second image = CANDIDATE.\n` +
                  `Respond as JSON: { "confidence": number, "detectionType": string, "transformations": string[], "ocrText": string, "watermark": string, "reason": string, "falsePositive": boolean }`,
              },
              { type: "image_url", image_url: { url: opts.referenceDataUrl } },
              { type: "image_url", image_url: { url: opts.candidateImageUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      console.error("[copyright-grade]", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return null;
    }
    const json = (await res.json()) as GatewayResponse;
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;

    const detectionType = String(parsed.detectionType ?? "unrelated") as DetectionType;
    return {
      confidence: clampScore(parsed.confidence),
      detectionType: TYPES.has(detectionType) ? detectionType : "reuploaded_artwork",
      transformations: Array.isArray(parsed.transformations)
        ? parsed.transformations.map((t) => String(t).slice(0, 40)).slice(0, 10)
        : [],
      ocrText: parsed.ocrText ? String(parsed.ocrText).slice(0, 1000) : null,
      watermark: parsed.watermark ? String(parsed.watermark).slice(0, 200) : null,
      reason: String(parsed.reason ?? "").slice(0, 400),
      falsePositive: Boolean(parsed.falsePositive),
    };
  } catch (e) {
    console.error("[copyright-grade] network", e);
    return null;
  }
}

export function bandFor(confidence: number): "confirmed" | "probable" | "review" {
  if (confidence >= 90) return "confirmed";
  if (confidence >= 70) return "probable";
  return "review";
}
