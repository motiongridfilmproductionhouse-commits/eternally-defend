import type { ReputationReport } from "@/routes/api/scan";
import type { PersistScanInput } from "@/lib/scans.functions";

/**
 * Maps a ReputationReport into persistScan's input shape. Mirrors the
 * mapping done client-side in src/routes/_app.scan.tsx after a manual scan,
 * so headless (orchestrator-triggered) and manual scans persist identically.
 */
export function mapReputationReportToPersistInput(report: ReputationReport): PersistScanInput {
  const hits = report.hits.map((h) => ({
    source: h.source,
    sourceType: h.source === "YouTube" ? "youtube_video" : h.source.toLowerCase(),
    externalId: h.media?.videoId ?? null,
    canonicalUrl: h.url,
    permalink: h.url,
    title: h.title,
    description: h.description,
    author: h.author ?? h.media?.channelTitle ?? null,
    thumbnailUrl: h.media?.thumbnailHi ?? h.media?.thumbnail ?? null,
    language: h.language,
    publishedAt: h.published ?? null,
    reach: h.reachEstimate,
    engagement: h.engagement,
    velocity: h.viral ? "viral" : null,
    riskScore: h.threatScore,
    threatScore: h.threatScore,
    severity: h.severity,
    growthPct: h.media?.growthPerDay ?? null,
    riskType: h.category,
    tags: h.keywords,
    metrics: {
      views: h.media?.views ?? null,
      likes: h.media?.likes ?? null,
      comments: h.media?.comments ?? null,
      growthPerDay: h.media?.growthPerDay ?? null,
      engagementRate: h.media?.engagementRate ?? null,
      credibilityScore: h.credibilityScore,
      viralityScore: h.viralityScore,
    } as Record<string, unknown>,
    sourceMetadata: {
      platform: h.platform,
      channelId: h.media?.channelId ?? null,
      // Which discovery provider(s) actually found this hit — extends the
      // existing JSONB column rather than a schema migration. See
      // RawHit.provider / ScanHit.discoveredByProviders in api/scan.ts for
      // where this is populated; [] (not omitted) means the pipeline ran
      // but no provider tag was captured for this hit.
      discoveredByProviders: h.discoveredByProviders ?? [],
    } as Record<string, unknown>,
    evidenceRefs: [],
    classificationTier: h.classificationTier ?? null,
    riskEvidenceFound: h.riskEvidence?.riskEvidenceFound ?? false,
    evidenceClassification: h.riskEvidence
      ? ({
          riskClassification: h.riskClassification ?? null,
          contentType: h.contentType ?? null,
          evidenceLevel: h.evidenceLevel ?? null,
          riskCategory: h.riskEvidence.riskCategory,
          evidenceText: h.riskEvidence.evidenceText,
          evidenceSource: h.riskEvidence.evidenceSource,
          confidence: h.riskEvidence.confidence,
          reason: h.riskEvidence.reason,
          detectionReason: h.detectionReason ?? null,
        } as Record<string, unknown>)
      : null,
  }));

  return {
    query: report.query,
    params: { period: report.period, sources: report.sourcesRequested },
    sources: report.sourcesRequested,
    period: report.period,
    hits,
    totals: {
      total: report.totals.total,
      unique: report.totals.unique,
      duplicatesRemoved: report.totals.duplicatesRemoved,
    },
  };
}
