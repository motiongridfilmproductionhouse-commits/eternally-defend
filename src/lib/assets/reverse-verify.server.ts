/**
 * Server-only: reverse-image discovery + dual verification for newly
 * registered protected assets.
 */
import { CompareFacesCommand } from "@aws-sdk/client-rekognition";
import { getRekognition } from "@/lib/aws/clients.server";
import { fetchImageBytes } from "@/lib/aws/s3.server";
import { reverseImageSearch } from "@/lib/discovery/reverse-image.server";
import { actionabilityBlocker } from "@/lib/media/platform-classifier";
import {
  isCorroborated,
  verifyCandidateBytes,
} from "@/lib/media/candidate-verification.server";

type VerifiedMatch = {
  link?: string;
  source?: string;
  title?: string;
  thumbnail?: string;
  image_url?: string;
  faceSimilarity?: number | null;
  hashSimilarity?: number | null;
  hashVerdict?: string | null;
  platform?: string | null;
  removalCapable?: boolean | null;
};

/**
 * Reverse-image discovery + dual verification.
 *
 * Reverse image search only finds *visually related* media. A candidate is kept
 * when it is corroborated either by a real perceptual-hash match against the
 * uploaded original, or by an AWS Rekognition face match against it.
 */
export async function reverseSearchAndVerify(
  imageUrl: string,
  personName: string,
  referenceBytes: Uint8Array,
  fingerprint: { phash: string | null; dhash: string | null; ahash: string | null },
  referenceSha256: string,
) {
  const report = await reverseImageSearch(imageUrl, { subjectHint: personName });
  if (!report.providersSucceeded.length) {
    const reason = report.providersFailed.map((f) => `${f.provider}: ${f.reason}`).join("; ");
    throw new Error(reason || "No reverse-image provider is configured.");
  }

  const candidates = report.candidates.slice(0, 40);
  const verified: VerifiedMatch[] = [];

  for (let offset = 0; offset < candidates.length; offset += 4) {
    const batch = candidates.slice(offset, offset + 4);
    const checked = await Promise.all(
      batch.map(async (candidate) => {
        const candidateUrl = candidate.imageUrl ?? candidate.thumbnailUrl;
        if (!candidateUrl) return null;
        const downloaded = await fetchImageBytes(candidateUrl);
        if (!downloaded) return null;

        // 1. Perceptual hash verification against the uploaded original.
        const hashResult = await verifyCandidateBytes(
          { protectedAssetId: "pending", ...fingerprint },
          candidateUrl,
          downloaded.bytes,
          referenceSha256,
        );

        // 2. Face verification (identity signal, independent of framing).
        let faceSimilarity: number | null = null;
        try {
          const found = await getRekognition().send(
            new CompareFacesCommand({
              SourceImage: { Bytes: referenceBytes },
              TargetImage: { Bytes: downloaded.bytes },
              SimilarityThreshold: 90,
              QualityFilter: "AUTO",
            }),
          );
          faceSimilarity = (found.FaceMatches ?? []).reduce(
            (score, item) => Math.max(score, item.Similarity ?? 0),
            0,
          );
        } catch {
          faceSimilarity = null;
        }

        const hashCorroborated = isCorroborated(hashResult);
        const faceCorroborated = (faceSimilarity ?? 0) >= 90;
        if (!hashCorroborated && !faceCorroborated) return null;

        return {
          link: candidate.pageUrl ?? undefined,
          source: candidate.source ?? undefined,
          title: candidate.title ?? undefined,
          thumbnail: candidate.thumbnailUrl ?? undefined,
          image_url: candidateUrl,
          faceSimilarity,
          hashSimilarity: hashResult.similarity,
          hashVerdict: hashResult.verdict,
          platform: candidate.platform?.kind ?? null,
          removalCapable: candidate.platform?.removalCapable ?? null,
        } as VerifiedMatch;
      }),
    );
    verified.push(...checked.filter((match): match is VerifiedMatch => match !== null));
  }

  const pages = verified
    .filter((match) => match.link)
    .map((match) => ({
      url: match.link!,
      title: match.title ?? match.source ?? "Visual match",
      fullMatches: match.hashVerdict === "EXACT" ? 1 : 0,
      partialMatches: match.hashVerdict === "EXACT" ? 0 : 1,
      thumbnail: match.thumbnail ?? match.image_url ?? null,
      source: match.source ?? null,
      faceSimilarity: match.faceSimilarity ?? null,
      hashSimilarity: match.hashSimilarity ?? null,
      hashVerdict: match.hashVerdict ?? null,
      platform: match.platform ?? null,
      removalCapable: match.removalCapable ?? null,
      actionabilityBlocker: match.link ? actionabilityBlocker(match.link) : "Missing page URL",
    }));

  const images = verified
    .map((match) => match.image_url ?? match.thumbnail ?? "")
    .filter(Boolean)
    .map((url) => ({ url, score: null }));

  return {
    pages,
    fullMatchingImages: images.filter((_, index) => verified[index]?.hashVerdict === "EXACT"),
    partialMatchingImages: [],
    visuallySimilarImages: images,
    bestGuessLabels: report.bestGuessLabels.slice(0, 5),
    searchMetadata: {
      id: null,
      status: "Success",
      processedAt: new Date().toISOString(),
      providersAttempted: report.providersAttempted,
      providersSucceeded: report.providersSucceeded,
      providersFailed: report.providersFailed,
      lensCandidates: report.candidates.length,
      identityVerifiedMatches: verified.length,
      faceThreshold: 90,
      hashAlgorithm: "phash+dhash+ahash",
      identityReference: "uploaded_asset",
    },
  };
}
