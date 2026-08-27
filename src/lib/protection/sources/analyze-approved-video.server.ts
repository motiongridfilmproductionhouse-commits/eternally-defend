/**
 * Runs one approved-source video through the existing two-gate pipeline
 * (identity match, then synthetic/manipulation detection — see
 * target-identity.ts) and records the result. No new face-recognition or
 * synthetic-media detection code: this only orchestrates
 * filterCandidatesByTargetFace and classifyHitsWithHive. Heavy pipeline
 * pieces (AWS Rekognition, Hive) are dynamically imported — mirrors
 * dispatch/deepfake.server.ts's deps-injection shape so this stays
 * unit-testable without those SDKs.
 *
 * Every completed analysis lands in review_status: "pending_review" —
 * nothing is ever auto-approved or auto-acted-on. A synthetic/manipulated
 * match still runs captureAndRecordFindingEvidence (a passive fetch+hash
 * record; no case, nobody notified) so evidence isn't lost if the source
 * content disappears before a human reviews it, but it does NOT call
 * AutoEnforcementOrchestrator.onVerifiedFinding automatically — case-prep
 * only happens via the explicit, admin-gated Takedown action in
 * admin-takedown.functions.ts. The customer's own review actions
 * (approveSourceVideo / sendSourceVideoForReview in
 * approved-sources.functions.ts) never touch evidence or enforcement code
 * at all, by construction.
 *
 * Both gates surface a THIRD outcome ("error" / "unknown") distinct from a
 * confident negative — filterCandidatesByTargetFace's "errors" bucket
 * (comparison_failed / no_image) and classifyHitsWithHive's
 * classification_status !== "completed" (provider_error / no_media) both
 * mean "we don't know", not "confirmed safe". Either one routes straight to
 * needs_review so a provider outage can never silently clear real content —
 * see classification.ts's decideApprovedSourceClassification for why.
 */
import { findExistingDeepfakeTarget } from "@/lib/protection/dispatch/deepfake.server";
import type { FaceVerifiedCandidate } from "@/lib/deepfake/face-filter.server";
import type { ClassifiedHit, RawHit } from "@/lib/deepfake/classify.server";
import type { FindingEvidenceResult } from "@/lib/protection/evidence.server";
import {
  decideApprovedSourceClassification,
  classificationRequiresEvidence,
  type FaceMatchOutcome,
  type SyntheticOutcome,
} from "./classification";

interface ApprovedSourceVideoRow {
  id: string;
  user_id: string;
  source_id: string;
  youtube_video_id: string;
  title: string | null;
  thumbnail_url: string | null;
  url: string | null;
}

export interface AnalyzeApprovedVideoDeps {
  findExistingDeepfakeTarget?: typeof findExistingDeepfakeTarget;
  filterCandidatesByTargetFace?: (input: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    userId: string;
    profileId: string;
    candidates: Array<{ url: string; query: string; thumbnail_url?: string }>;
  }) => Promise<{
    matched: FaceVerifiedCandidate[];
    rejected: FaceVerifiedCandidate[];
    errors: FaceVerifiedCandidate[];
  }>;
  classifyHitsWithHive?: (hits: RawHit[]) => Promise<ClassifiedHit[]>;
  captureAndRecordFindingEvidence?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabaseAdmin: any,
    input: {
      userId: string;
      moduleKey: string;
      findingSourceTable: string;
      findingId: string;
      url: string;
      title?: string;
      mediaType?: "image" | "video" | "page";
    },
  ) => Promise<FindingEvidenceResult>;
}

export async function analyzeApprovedSourceVideo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  videoRowId: string,
  deps: AnalyzeApprovedVideoDeps = {},
): Promise<void> {
  const { data: v, error } = await supabaseAdmin
    .from("approved_source_videos")
    .select("id, user_id, source_id, youtube_video_id, title, thumbnail_url, url")
    .eq("id", videoRowId)
    .maybeSingle();
  if (error || !v) throw new Error("approved source video not found");
  const video = v as ApprovedSourceVideoRow;

  await supabaseAdmin
    .from("approved_source_videos")
    .update({ analysis_status: "running" })
    .eq("id", video.id);

  const canonicalUrl = video.url ?? `https://www.youtube.com/watch?v=${video.youtube_video_id}`;

  const findTarget = deps.findExistingDeepfakeTarget ?? findExistingDeepfakeTarget;
  const target = await findTarget(supabaseAdmin, video.user_id);
  const hasReferenceProfile = !!target && target.referenceFaceCount >= 3;

  if (!hasReferenceProfile) {
    await supabaseAdmin
      .from("approved_source_videos")
      .update({
        analysis_status: "skipped",
        analysis_error: !target
          ? "No target face profile enrolled."
          : "Fewer than 3 reference faces enrolled.",
        classification: "needs_review",
        review_status: "pending_review",
        analyzed_at: new Date().toISOString(),
      })
      .eq("id", video.id);
    return;
  }

  let faceMatch: FaceMatchOutcome = "error";
  let faceSimilarity = 0;
  let faceError: string | null = null;
  try {
    const filterCandidates =
      deps.filterCandidatesByTargetFace ??
      (await import("@/lib/deepfake/face-filter.server")).filterCandidatesByTargetFace;
    const result = await filterCandidates({
      supabase: supabaseAdmin,
      userId: video.user_id,
      profileId: target!.profileId,
      candidates: [
        {
          url: canonicalUrl,
          query: video.title ?? "",
          thumbnail_url: video.thumbnail_url ?? undefined,
        },
      ],
    });
    if (result.errors.length > 0) {
      // comparison_failed / no_image — the comparison could not be
      // completed. NOT a confident "different person"; must not be
      // downgraded to not_subject.
      faceMatch = "error";
      faceSimilarity = result.errors[0]?.face_similarity ?? 0;
      faceError = "Face comparison could not be completed.";
    } else if (result.matched.length > 0) {
      faceMatch = "matched";
      faceSimilarity = result.matched[0]?.face_similarity ?? 0;
    } else {
      faceMatch = "not_matched";
      faceSimilarity = result.rejected[0]?.face_similarity ?? 0;
    }
  } catch (err) {
    console.warn("[approved-sources] face match failed", video.id, (err as Error).message);
    faceMatch = "error";
    faceError = "Face comparison could not be completed.";
  }

  let synthetic: SyntheticOutcome = "unknown";
  let syntheticConfidence = 0;
  let syntheticError: string | null = null;
  if (faceMatch === "matched") {
    try {
      const classifyHits =
        deps.classifyHitsWithHive ??
        (await import("@/lib/deepfake/hive.server")).classifyHitsWithHive;
      const hiveHit: RawHit & { thumbnail_url?: string } = {
        url: canonicalUrl,
        title: video.title ?? undefined,
        query: video.title ?? "",
        thumbnail_url: video.thumbnail_url ?? undefined,
      };
      const [classified] = await classifyHits([hiveHit]);
      syntheticConfidence = classified?.confidence ?? 0;
      if (classified?.classification_status === "completed") {
        synthetic = classified.is_synthetic ? "synthetic" : "clean";
      } else {
        // provider_error / no_media / failed — inconclusive. NOT a
        // confident "clean"; must not be downgraded to legitimate_appearance.
        synthetic = "unknown";
        syntheticError = "Synthetic-media classification could not be completed.";
      }
    } catch (err) {
      console.warn(
        "[approved-sources] synthetic classification failed",
        video.id,
        (err as Error).message,
      );
      synthetic = "unknown";
      syntheticError = "Synthetic-media classification could not be completed.";
    }
  }

  const classification = decideApprovedSourceClassification({
    hasReferenceProfile,
    faceMatch,
    faceSimilarity,
    synthetic,
    syntheticConfidence,
  });

  // Passive evidence preservation only — never case-prep. A verified/probable
  // deepfake match here is a SUGGESTION for the customer's review queue, not
  // an automatic action. Evidence capture is idempotent (upserts on
  // (user_id, module_key, url)), so if an admin later takes this down, the
  // Takedown action re-captures/upserts the same record safely.
  let evidenceId: string | null = null;
  if (classificationRequiresEvidence(classification)) {
    const captureEvidence =
      deps.captureAndRecordFindingEvidence ??
      (await import("@/lib/protection/evidence.server")).captureAndRecordFindingEvidence;
    const evidence = await captureEvidence(supabaseAdmin, {
      userId: video.user_id,
      moduleKey: "approved_youtube_sources",
      findingSourceTable: "approved_source_videos",
      findingId: video.id,
      url: canonicalUrl,
      title: video.title ?? undefined,
      mediaType: "video",
    });
    evidenceId = evidence.evidenceId;
  }

  await supabaseAdmin
    .from("approved_source_videos")
    .update({
      analysis_status: "completed",
      analysis_error: faceError ?? syntheticError ?? null,
      classification,
      review_status: "pending_review",
      face_match: faceMatch === "matched",
      face_similarity: faceSimilarity,
      is_synthetic: synthetic === "synthetic",
      synthetic_confidence: syntheticConfidence,
      automated_finding_evidence_id: evidenceId,
      analyzed_at: new Date().toISOString(),
    })
    .eq("id", video.id);
}
