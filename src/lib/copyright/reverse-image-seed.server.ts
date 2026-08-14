/**
 * Reverse-image discovery seed for copyright scans.
 *
 * The reference material stored for a scan is published as a short-lived signed
 * URL and pushed through the reverse-image providers. Returned pages become
 * ordinary discovery candidates and are still verified downstream by the
 * perceptual-hash comparison — this only widens discovery.
 */
import { getSignedGetUrl } from "@/lib/aws/s3.server";
import {
  reverseImageProvidersConfigured,
  reverseImageSearch,
} from "@/lib/discovery/reverse-image.server";
import { classifyPlatform } from "@/lib/media/platform-classifier";
import type { DiscoveryCandidate } from "@/lib/copyright/url.server";

export interface ReverseImageSeedResult {
  candidates: DiscoveryCandidate[];
  diagnostics: {
    configured_providers: string[];
    providers_succeeded: string[];
    providers_failed: Array<{ provider: string; reason: string }>;
    raw_candidates: number;
    seeded_candidates: number;
    skipped_infrastructure: number;
    best_guess_labels: string[];
    error?: string;
  };
}

export async function seedCandidatesFromReferenceImage(
  referenceKey: string,
  title: string,
): Promise<ReverseImageSeedResult> {
  const configured = reverseImageProvidersConfigured();
  const empty: ReverseImageSeedResult = {
    candidates: [],
    diagnostics: {
      configured_providers: configured,
      providers_succeeded: [],
      providers_failed: [],
      raw_candidates: 0,
      seeded_candidates: 0,
      skipped_infrastructure: 0,
      best_guess_labels: [],
    },
  };
  if (!configured.length) {
    return { ...empty, diagnostics: { ...empty.diagnostics, error: "no_reverse_image_provider" } };
  }

  try {
    const seedUrl = await getSignedGetUrl(referenceKey, 900);
    const report = await reverseImageSearch(seedUrl, { subjectHint: title });

    const candidates: DiscoveryCandidate[] = [];
    let skipped = 0;
    for (const candidate of report.candidates) {
      const pageUrl = candidate.pageUrl;
      if (!pageUrl) {
        skipped += 1;
        continue;
      }
      const platform = candidate.platform ?? classifyPlatform(pageUrl);
      // A CDN/proxy or search-result URL is never a removal target.
      if (!platform || platform.isInfrastructure || platform.isSearchSurface) {
        skipped += 1;
        continue;
      }
      candidates.push({
        url: pageUrl,
        title: candidate.title,
        source: `reverse_image:${candidate.provider}`,
        thumbnail: candidate.thumbnailUrl,
        imageUrl: candidate.imageUrl,
        exact: candidate.matchType === "exact",
        frameIndex: 0,
        query: `reverse_image_search(${candidate.matchType})`,
        keywordMatch: null,
        category: null,
        language: null,
        websiteType: null,
        priorityScore: candidate.matchType === "exact" ? 85 : 60,
      });
    }

    return {
      candidates,
      diagnostics: {
        configured_providers: configured,
        providers_succeeded: report.providersSucceeded,
        providers_failed: report.providersFailed,
        raw_candidates: report.candidates.length,
        seeded_candidates: candidates.length,
        skipped_infrastructure: skipped,
        best_guess_labels: report.bestGuessLabels.slice(0, 5),
      },
    };
  } catch (error) {
    return {
      ...empty,
      diagnostics: { ...empty.diagnostics, error: (error as Error).message },
    };
  }
}
