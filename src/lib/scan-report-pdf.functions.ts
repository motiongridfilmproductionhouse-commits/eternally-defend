import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Review = z.object({
  reviewStatus: z.enum([
    "AUTOMATED_LEAD",
    "REVIEW_REQUIRED",
    "REVIEWED_NO_VIOLATION",
    "REVIEWED_POTENTIAL_VIOLATION",
    "ESCALATION_RECOMMENDED",
    "LEGAL_REVIEW_REQUIRED",
  ]),
  reviewerName: z.string().nullish(),
  reviewerRole: z.string().nullish(),
  reviewedAt: z.string().nullish(),
  targetPerson: z.string().nullish(),
  exactOriginalStatement: z.string().nullish(),
  statementLanguage: z.string().nullish(),
  verifiedEnglishTranslation: z.string().nullish(),
  videoStartTimestamp: z.number().nonnegative().nullish(),
  videoEndTimestamp: z.number().nonnegative().nullish(),
  speakerIdentity: z.string().nullish(),
  contentContext: z.string().nullish(),
  contentPosition: z.enum(["SUPPORTIVE", "NEUTRAL", "CRITICAL", "HOSTILE", "UNKNOWN"]),
  statementType: z.enum([
    "FACT",
    "OPINION",
    "INSULT",
    "THREAT",
    "SATIRE",
    "NEWS_REPORT",
    "UNKNOWN",
  ]),
  allegedViolationTypes: z.array(z.string()).max(20),
  violationReason: z.string().nullish(),
  supportingFacts: z.string().nullish(),
  falsityBasis: z.string().nullish(),
  victimImpact: z.string().nullish(),
  confidenceScore: z.number().min(0).max(100).nullish(),
  legalReviewRequired: z.boolean(),
  recommendedAction: z.string().nullish(),
  reviewerNotes: z.string().nullish(),
  reviewerDeclarationSigned: z.boolean().optional(),
});

const Scoring = z.object({
  relevance: z.number(),
  harm: z.number(),
  credibility: z.number(),
  virality: z.number(),
  evidenceCompleteness: z.number(),
  legalActionability: z.number(),
  overallPriority: z.number(),
  version: z.string(),
});

const Evidence = z.object({
  fullPageScreenshotPreserved: z.boolean().optional(),
  originalMediaPreserved: z.boolean().optional(),
  hashesGenerated: z.boolean().optional(),
  chainOfCustodyCreated: z.boolean().optional(),
  translationRequired: z.boolean().optional(),
  translationVerified: z.boolean().optional(),
  channelIdentifiersPreserved: z.boolean().optional(),
  ownershipProofPreserved: z.boolean().optional(),
  recordDataHash: z.string().nullish(),
  screenshotHash: z.string().nullish(),
  transcriptHash: z.string().nullish(),
  originalMediaHash: z.string().nullish(),
  storageObjectPath: z.string().nullish(),
});

const Hit = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().nullish(),
  platform: z.string(),
  source: z.string(),
  author: z.string().nullish(),
  published: z.string().nullish(),
  category: z.string(),
  contentLabel: z.string(),
  severity: z.string(),
  sentiment: z.string(),
  threatScore: z.number(),
  credibilityScore: z.number(),
  reachEstimate: z.number(),
  engagement: z.number(),
  detectionReason: z.string().nullish(),
  recommendedAction: z.string(),
  discoveredAt: z.string().nullish(),
  thumbnailUrl: z.string().nullish(),
  videoId: z.string().nullish(),
  channelId: z.string().nullish(),
  channelUrl: z.string().nullish(),
  views: z.number().nonnegative().nullish(),
  likes: z.number().nonnegative().nullish(),
  comments: z.number().nonnegative().nullish(),
  viewsAvailable: z.boolean().optional(),
  likesAvailable: z.boolean().optional(),
  commentsAvailable: z.boolean().optional(),
  statisticsCapturedAt: z.string().nullish(),
  statisticsSource: z.string().nullish(),
  transcript: z.string().nullish(),
  transcriptSource: z.string().nullish(),
  transcriptConfidence: z.number().min(0).max(100).nullish(),
  review: Review.nullish(),
  scoring: Scoring.nullish(),
  evidence: Evidence.nullish(),
});

const Input = z.object({
  subject: z.string().min(1).max(240),
  period: z.string(),
  generatedAt: z.string(),
  reputationScore: z.number(),
  reputationLevel: z.string(),
  headline: z.string(),
  exportType: z.enum(["PRELIMINARY_INTELLIGENCE", "VERIFIED_EVIDENCE_PACKAGE"]).optional(),
  totals: z.object({
    unique: z.number(),
    critical: z.number(),
    high: z.number(),
    negative: z.number(),
    viral: z.number(),
    totalReach: z.number(),
  }),
  sources: z.array(z.string()).max(40),
  immediateActions: z.array(z.string()).max(30),
  longTerm: z.array(z.string()).max(30),
  hits: z.array(Hit).max(300),
  custodyEvents: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
  artifacts: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        base64: z.string(),
        mimeType: z.string(),
        objectType: z.string(),
      }),
    )
    .max(500)
    .optional(),
});

export const generateScanReportPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const { buildScanReportPdf } = await import("./scan-report-pdf.server");
    const out = await buildScanReportPdf(data);
    if (data.exportType === "VERIFIED_EVIDENCE_PACKAGE") {
      const { buildDeterministicEvidenceZip } = await import("./evidence-manifest.server");
      const metadata = new TextEncoder().encode(
        JSON.stringify(
          { reportId: out.reportId, exportType: data.exportType, hits: data.hits },
          null,
          2,
        ),
      );
      const custody = new TextEncoder().encode(JSON.stringify(data.custodyEvents ?? [], null, 2));
      const supplied = (data.artifacts ?? []).map((item) => ({
        path: item.path,
        bytes: Uint8Array.from(Buffer.from(item.base64, "base64")),
        mimeType: item.mimeType,
        objectType: item.objectType,
      }));
      const zipped = buildDeterministicEvidenceZip(out.reportId, [
        {
          path: `${out.reportId}.pdf`,
          bytes: out.bytes,
          mimeType: "application/pdf",
          objectType: "final_pdf",
        },
        {
          path: "metadata.json",
          bytes: metadata,
          mimeType: "application/json",
          objectType: "metadata",
        },
        {
          path: "chain-of-custody.json",
          bytes: custody,
          mimeType: "application/json",
          objectType: "chain_of_custody",
        },
        ...supplied,
      ]);
      return {
        fileName: `Eterna-Verified-Evidence-${out.reportId}.zip`,
        base64: Buffer.from(zipped.bytes).toString("base64"),
        reportId: out.reportId,
        sha256: zipped.manifestSha256,
        mimeType: "application/zip",
      };
    }
    return {
      fileName: `Eterna-Preliminary-Evidence-${out.reportId}.pdf`,
      base64: Buffer.from(out.bytes).toString("base64"),
      reportId: out.reportId,
      sha256: out.hash,
      mimeType: "application/pdf",
    };
  });
