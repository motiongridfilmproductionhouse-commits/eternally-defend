/**
 * AWS Rekognition movie fingerprinting for the Copyright Intelligence engine.
 *
 * A fingerprint is built once per scan from the uploaded reference frames
 * (poster / artwork / sampled video frames) and then matched against every
 * discovered candidate image. Signals: poster & scene labels, OCR title text,
 * recognised actors/celebrities, face similarity and burned-in watermarks.
 *
 * Everything is best-effort — when AWS credentials are absent or a call fails,
 * the fingerprint degrades to empty signals and grading falls back to AI vision.
 */
import {
  compareFaceSimilarity,
  detectLabels,
  detectText,
  isRekognitionConfigured,
  recognizeCelebrities,
  type RekLabel,
} from "@/lib/aws/rekognition-media.server";

export interface MovieFingerprint {
  available: boolean;
  /** primary reference frame bytes used for face comparison */
  frames: Uint8Array[];
  /** scene / object / location labels across all frames */
  labels: string[];
  /** label categories (e.g. "Person Description", "Text and Documents") */
  sceneCategories: string[];
  /** OCR lines extracted by Rekognition */
  ocrLines: string[];
  /** normalised OCR tokens for title matching */
  ocrTokens: string[];
  /** actors / celebrities recognised in the reference material */
  celebrities: string[];
  /** number of distinct faces seen in the reference */
  faceCount: number;
  /** candidate watermark / logo strings detected as short uppercase text */
  watermarkHints: string[];
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "movie",
  "film",
  "full",
  "hd",
  "official",
  "trailer",
  "new",
  "day",
  "watch",
  "online",
  "download",
  "free",
  "a",
  "of",
  "in",
]);

export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function topLabels(labels: RekLabel[]): string[] {
  return labels.filter((l) => l.confidence >= 70).map((l) => l.name);
}

/** Build the reference fingerprint from the uploaded frames. */
export async function buildMovieFingerprint(
  frames: Uint8Array[],
  workTitle: string,
): Promise<MovieFingerprint> {
  const empty: MovieFingerprint = {
    available: false,
    frames,
    labels: [],
    sceneCategories: [],
    ocrLines: [],
    ocrTokens: normalizeTokens(workTitle),
    celebrities: [],
    faceCount: 0,
    watermarkHints: [],
  };
  if (!isRekognitionConfigured() || frames.length === 0) return empty;

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Fingerprint timeout")), 6_000),
    );
    const perFrame = await Promise.race([
      Promise.all(
        frames.slice(0, 4).map(async (bytes) => {
          const [labels, text, celeb] = await Promise.all([
            detectLabels(bytes),
            detectText(bytes),
            recognizeCelebrities(bytes),
          ]);
          return { labels, text, celeb };
        }),
      ),
      timeoutPromise,
    ]);

    const labels = new Set<string>();
    const cats = new Set<string>();
    const ocrLines: string[] = [];
    const celebrities = new Set<string>();
    let faceCount = 0;

    for (const f of perFrame) {
      for (const name of topLabels(f.labels)) labels.add(name);
      for (const l of f.labels) for (const c of l.categories) cats.add(c);
      ocrLines.push(...f.text);
      for (const c of f.celeb.celebrities) if (c.confidence >= 70) celebrities.add(c.name);
      faceCount = Math.max(faceCount, f.celeb.faces);
    }

    const uniqueLines = [...new Set(ocrLines)].slice(0, 60);
    const watermarkHints = uniqueLines
      .filter((l) => l.length <= 24 && /^[A-Z0-9 .·|@#\-_/]+$/.test(l) && /[A-Z]{3,}/.test(l))
      .slice(0, 8);

    return {
      available: true,
      frames,
      labels: [...labels].slice(0, 40),
      sceneCategories: [...cats].slice(0, 12),
      ocrLines: uniqueLines,
      ocrTokens: [
        ...new Set([...normalizeTokens(workTitle), ...normalizeTokens(uniqueLines.join(" "))]),
      ].slice(0, 80),
      celebrities: [...celebrities].slice(0, 8),
      faceCount,
      watermarkHints,
    };
  } catch (e) {
    console.warn("[copyright-fingerprint] build failed", (e as Error).message);
    return empty;
  }
}

export interface FingerprintMatch {
  /** 0-100 Rekognition-only corroboration score */
  score: number;
  faceSimilarity: number;
  celebrityMatches: string[];
  sceneOverlap: number;
  matchedLabels: string[];
  ocrTitleMatch: boolean;
  matchedOcrText: string[];
  watermarkMatch: string | null;
  /** how many independent signals corroborated */
  signals: string[];
}

export const EMPTY_MATCH: FingerprintMatch = {
  score: 0,
  faceSimilarity: 0,
  celebrityMatches: [],
  sceneOverlap: 0,
  matchedLabels: [],
  ocrTitleMatch: false,
  matchedOcrText: [],
  watermarkMatch: null,
  signals: [],
};

/** Compare a discovered candidate image against the reference fingerprint. */
export async function matchCandidateAgainstFingerprint(
  fp: MovieFingerprint,
  candidateBytes: Uint8Array,
  workTitle: string,
): Promise<FingerprintMatch> {
  if (!fp.available) return EMPTY_MATCH;

  try {
    const [labels, text, celeb, faceSim] = await Promise.all([
      detectLabels(candidateBytes, 25),
      detectText(candidateBytes),
      fp.celebrities.length || fp.faceCount
        ? recognizeCelebrities(candidateBytes)
        : Promise.resolve({ celebrities: [], faces: 0 }),
      fp.faceCount && fp.frames[0]
        ? compareFaceSimilarity(fp.frames[0], candidateBytes, 80)
        : Promise.resolve(0),
    ]);

    const refLabels = new Set(fp.labels.map((l) => l.toLowerCase()));
    const candLabels = topLabels(labels);
    const matchedLabels = candLabels.filter((l) => refLabels.has(l.toLowerCase()));
    const sceneOverlap = refLabels.size
      ? Math.round((matchedLabels.length / Math.min(refLabels.size, candLabels.length || 1)) * 100)
      : 0;

    const titleTokens = normalizeTokens(workTitle);
    const candTokens = new Set(normalizeTokens(text.join(" ")));
    const hitTokens = titleTokens.filter((t) => candTokens.has(t));
    const ocrTitleMatch =
      titleTokens.length > 0 &&
      hitTokens.length >= Math.max(1, Math.ceil(titleTokens.length * 0.6));

    const refOcr = new Set(fp.ocrLines.map((l) => l.toLowerCase()));
    const matchedOcrText = text
      .filter((l) => l.length > 3 && refOcr.has(l.toLowerCase()))
      .slice(0, 8);

    const refCelebs = new Set(fp.celebrities.map((c) => c.toLowerCase()));
    const celebrityMatches = celeb.celebrities
      .filter((c) => c.confidence >= 70 && refCelebs.has(c.name.toLowerCase()))
      .map((c) => c.name);

    const candUpper = text.map((l) => l.toUpperCase());
    const watermarkMatch =
      fp.watermarkHints.find((w) => candUpper.some((l) => l.includes(w.toUpperCase()))) ?? null;

    const signals: string[] = [];
    let score = 0;
    if (faceSim >= 80) {
      score += 28;
      signals.push(`face_match_${faceSim}%`);
    }
    if (celebrityMatches.length) {
      score += 20;
      signals.push(`actor_match:${celebrityMatches.slice(0, 2).join(", ")}`);
    }
    if (ocrTitleMatch) {
      score += 22;
      signals.push("ocr_title_match");
    }
    if (matchedOcrText.length) {
      score += 12;
      signals.push("ocr_text_overlap");
    }
    if (sceneOverlap >= 50) {
      score += 18;
      signals.push(`scene_similarity_${sceneOverlap}%`);
    } else if (sceneOverlap >= 30) {
      score += 9;
      signals.push(`scene_similarity_${sceneOverlap}%`);
    }
    if (watermarkMatch) {
      score += 15;
      signals.push(`watermark_match:${watermarkMatch}`);
    }

    return {
      score: Math.min(100, score),
      faceSimilarity: faceSim,
      celebrityMatches,
      sceneOverlap,
      matchedLabels: matchedLabels.slice(0, 12),
      ocrTitleMatch,
      matchedOcrText,
      watermarkMatch,
      signals,
    };
  } catch (e) {
    console.warn("[copyright-fingerprint] match failed", (e as Error).message);
    return EMPTY_MATCH;
  }
}

/**
 * Blend the AI-vision grade with Rekognition corroboration.
 * Multiple independent matching signals (poster + actors + scenes) push a
 * candidate into the high-confidence band; a single weak signal does not.
 */
export function blendConfidence(aiConfidence: number | null, match: FingerprintMatch): number {
  const signalCount = match.signals.length;
  let bonus = 0;
  if (signalCount >= 3) bonus = 22;
  else if (signalCount === 2) bonus = 14;
  else if (signalCount === 1) bonus = 7;

  if (aiConfidence === null) {
    // Rekognition-only path: needs at least two corroborating signals.
    return signalCount >= 2 ? Math.min(88, match.score) : Math.min(45, match.score);
  }
  return Math.max(0, Math.min(100, Math.round(aiConfidence + bonus)));
}
