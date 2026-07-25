import type {
  RawHit,
  ClassifiedHit,
} from "./classify.server";

const HIVE_ENDPOINT =
  process.env.HIVE_API_URL ??
  "https://api.hivemoderation.com/api/v1/task/sync";

const IMAGE_EXTENSIONS =
  /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;

const VIDEO_EXTENSIONS =
  /\.(?:avi|mkv|mov|mp4|webm|wmv)(?:$|[?#])/i;

type HiveModel = "ai_generated_media" | "deepfake";

type HiveScore = {
  label: string;
  score: number;
};

export type HiveClassificationStatus =
  | "completed"
  | "no_media"
  | "provider_error";

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Hive response formats may differ between products/projects.
 * Recursively collect objects containing a label/class and score.
 */
function collectHiveScores(
  value: unknown,
  output: HiveScore[] = [],
  seen: WeakSet<object> = new WeakSet(),
): HiveScore[] {
  if (!value || typeof value !== "object") {
    return output;
  }

  if (seen.has(value)) {
    return output;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectHiveScores(item, output, seen);
    }

    return output;
  }

  const record = value as Record<string, unknown>;

  const rawLabel =
    record.class ??
    record.label ??
    record.name ??
    record.type ??
    record.category;

  const rawScore =
    record.score ??
    record.value ??
    record.confidence ??
    record.probability;

  if (typeof rawLabel === "string") {
    const numericScore = toNumber(rawScore);

    if (numericScore !== null) {
      output.push({
        label: normalizeLabel(rawLabel),
        score: clamp(numericScore > 1 ? numericScore / 100 : numericScore),
      });
    }
  }

  for (const child of Object.values(record)) {
    collectHiveScores(child, output, seen);
  }

  return output;
}

function highestMatchingScore(
  scores: HiveScore[],
  patterns: RegExp[],
): number {
  let highest = 0;

  for (const item of scores) {
    if (patterns.some((pattern) => pattern.test(item.label))) {
      highest = Math.max(highest, item.score);
    }
  }

  return highest;
}

function getMediaUrl(hit: RawHit): string | null {
  const extendedHit = hit as RawHit & {
    image_url?: string;
    imageUrl?: string;
    thumbnail_url?: string;
    thumbnailUrl?: string;
    media_url?: string;
    mediaUrl?: string;
  };

  const candidates = [
    extendedHit.image_url,
    extendedHit.imageUrl,
    extendedHit.media_url,
    extendedHit.mediaUrl,
    extendedHit.thumbnail_url,
    extendedHit.thumbnailUrl,
    hit.url,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") {
      continue;
    }

    let parsed: URL;

    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      continue;
    }

    const isDirectMedia =
      IMAGE_EXTENSIONS.test(candidate) ||
      VIDEO_EXTENSIONS.test(candidate);

    const isExplicitMediaField =
      candidate === extendedHit.image_url ||
      candidate === extendedHit.imageUrl ||
      candidate === extendedHit.media_url ||
      candidate === extendedHit.mediaUrl ||
      candidate === extendedHit.thumbnail_url ||
      candidate === extendedHit.thumbnailUrl;

    if (isDirectMedia || isExplicitMediaField) {
      return candidate;
    }
  }

  return null;
}

async function callHive(
  mediaUrl: string,
  model: HiveModel,
  postId: string,
): Promise<unknown> {
  const apiKey = process.env.HIVE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("HIVE_API_KEY is missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(HIVE_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `token ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        user_id: "eterna-deepfake-intel",
        post_id: postId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80),
        url: mediaUrl,
        models: [model],
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();

    let payload: unknown;

    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = {
        raw_response: responseText.slice(0, 1_000),
      };
    }

    if (!response.ok) {
      throw new Error(
        `Hive ${model} request failed (${response.status}): ` +
          JSON.stringify(payload).slice(0, 1_500),
      );
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function createUnclassifiedResult(
  hit: RawHit,
  status: HiveClassificationStatus,
  reasoning: string,
): ClassifiedHit {
  return {
    ...hit,
    risk_level: "LOW",
    content_category: "unclassified",
    confidence: 0,
    is_synthetic: false,
    face_referenced: false,
    takedown_recommended: false,
    ai_reasoning: reasoning,
    classification_status: status,
    visibility: "triage",
    hive_deepfake_score: 0,
    hive_ai_generated_score: 0,
  } as ClassifiedHit;
}

async function classifyOneWithHive(
  hit: RawHit,
  index: number,
): Promise<ClassifiedHit> {
  const mediaUrl = getMediaUrl(hit);

  if (!mediaUrl) {
    return createUnclassifiedResult(
      hit,
      "no_media",
      "Relevant page found, but no publicly accessible image or video URL was available for Hive analysis.",
    );
  }

  const uniqueId = `${Date.now()}-${index}`;

  try {
    const [generatedResponse, deepfakeResponse] =
      await Promise.all([
        callHive(
          mediaUrl,
          "ai_generated_media",
          `eterna-ai-${uniqueId}`,
        ),
        callHive(
          mediaUrl,
          "deepfake",
          `eterna-df-${uniqueId}`,
        ),
      ]);

    const generatedScores =
      collectHiveScores(generatedResponse);

    const deepfakeScores =
      collectHiveScores(deepfakeResponse);

    const aiGeneratedScore = highestMatchingScore(
      generatedScores,
      [
        /^ai_generated$/,
        /ai_generated/,
        /synthetic/,
        /generated_image/,
        /generated_video/,
      ],
    );

    const positiveDeepfakeScore = highestMatchingScore(
      deepfakeScores,
      [
        /^deepfake$/,
        /^yes_deepfake$/,
        /deepfake_yes/,
        /face_swap/,
        /faceswap/,
      ],
    );

    const negativeDeepfakeScore = highestMatchingScore(
      deepfakeScores,
      [
        /^no_deepfake$/,
        /not_deepfake/,
        /deepfake_no/,
      ],
    );

    const deepfakeScore =
      positiveDeepfakeScore > 0
        ? positiveDeepfakeScore
        : negativeDeepfakeScore > 0
          ? 1 - negativeDeepfakeScore
          : 0;

    const finalScore = Math.max(
      aiGeneratedScore,
      deepfakeScore,
    );

    /*
     * Hive documentation recommends 0.90 for deepfake images.
     * Deepfake video thresholds require frame-level handling;
     * this first integration uses conservative media-level routing.
     */
    const isDeepfake = deepfakeScore >= 0.9;
    const isAiGenerated = aiGeneratedScore >= 0.9;

    let riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    let category: string;

    if (isDeepfake && finalScore >= 0.95) {
      riskLevel = "CRITICAL";
      category = "deepfake";
    } else if (isDeepfake) {
      riskLevel = "HIGH";
      category = "deepfake";
    } else if (isAiGenerated) {
      riskLevel = "MEDIUM";
      category = "synthetic_media";
    } else {
      riskLevel = "LOW";
      category = "not_confirmed";
    }

    const confidence = Math.round(finalScore * 100);

    return {
      ...hit,
      media_url: mediaUrl,
      risk_level: riskLevel,
      content_category: category,
      confidence,
      is_synthetic: isDeepfake || isAiGenerated,
      face_referenced: isDeepfake,
      takedown_recommended: isDeepfake,
      ai_reasoning:
        `Hive media analysis completed. ` +
        `Deepfake score: ${Math.round(deepfakeScore * 100)}%. ` +
        `AI-generated score: ${Math.round(aiGeneratedScore * 100)}%.`,
      classification_status: "completed",
      visibility:
        isDeepfake || isAiGenerated
          ? "primary"
          : "triage",
      hive_deepfake_score: deepfakeScore,
      hive_ai_generated_score: aiGeneratedScore,
      hive_raw: {
        ai_generated_media: generatedResponse,
        deepfake: deepfakeResponse,
      },
    } as ClassifiedHit;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error("[DEEPFAKE:HIVE] Classification failed:", {
      url: hit.url,
      mediaUrl,
      error: message,
    });

    return createUnclassifiedResult(
      hit,
      "provider_error",
      `Hive analysis unavailable: ${message}`,
    );
  }
}

export async function classifyHitsWithHive(
  hits: RawHit[],
): Promise<ClassifiedHit[]> {
  if (!process.env.HIVE_API_KEY?.trim()) {
    console.warn(
      "[DEEPFAKE:HIVE] HIVE_API_KEY is missing. Results will be routed to triage.",
    );

    return hits.map((hit) =>
      createUnclassifiedResult(
        hit,
        "provider_error",
        "Hive API key is not configured.",
      ),
    );
  }

  const output: ClassifiedHit[] = [];

  /*
   * Small batches avoid sending every request simultaneously.
   * Increase carefully after checking your Hive rate limits.
   */
  const batchSize = 3;

  for (let start = 0; start < hits.length; start += batchSize) {
    const batch = hits.slice(start, start + batchSize);

    const batchResults = await Promise.all(
      batch.map((hit, offset) =>
        classifyOneWithHive(hit, start + offset),
      ),
    );

    output.push(...batchResults);
  }

  console.log("[DEEPFAKE:HIVE] Classification summary:", {
    submitted: hits.length,
    completed: output.filter(
      (item: any) =>
        item.classification_status === "completed",
    ).length,
    noMedia: output.filter(
      (item: any) =>
        item.classification_status === "no_media",
    ).length,
    providerErrors: output.filter(
      (item: any) =>
        item.classification_status === "provider_error",
    ).length,
    confirmedDeepfakes: output.filter(
      (item: any) =>
        item.content_category === "deepfake",
    ).length,
  });

  return output;
}
