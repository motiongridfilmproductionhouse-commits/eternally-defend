/**
 * Admin-only Takedown for a discovered Approved YouTube Sources video —
 * the ONLY code path anywhere in this feature that may create an
 * enforcement case. Every other path (the automatic pipeline in
 * analyze-approved-video.server.ts, and the customer's own
 * approveSourceVideo / sendSourceVideoForReview in
 * approved-sources.functions.ts) never imports case-prep at all.
 *
 * Gated by the same has_role(_user_id, 'admin') RPC check used throughout
 * this codebase (e.g. src/lib/onboarding/admin.functions.ts's
 * requireAdmin), verified against the CALLER's own authenticated session
 * before anything else runs. Only after that check passes does this reach
 * for the service-role client — never as a substitute for the check.
 *
 * Re-captures evidence (idempotent upsert, safe even if the automatic
 * pipeline already captured it) so Takedown works even on a video the
 * automatic classifier never flagged, then calls the exact same
 * AutoEnforcementOrchestrator.onVerifiedFinding entry point every other
 * protection module uses — landing in the same human-gated review queue
 * behind the same, unmodified src/lib/enforcement/worker.ts gates. Records
 * one immutable row in approved_source_takedown_log for every call.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { FindingEvidenceResult } from "@/lib/protection/evidence.server";

async function requireAdmin(context: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
}): Promise<void> {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Forbidden");
}

interface TakedownVideoRow {
  id: string;
  user_id: string;
  url: string | null;
  youtube_video_id: string;
  title: string | null;
}

export interface TakedownDeps {
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
  onVerifiedFinding?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    userId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    finding: any,
  ) => Promise<{ caseId: string | null; status: string; idempotencyDeduplicated: boolean }>;
}

export async function takedownSourceVideoCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  adminUserId: string,
  videoId: string,
  reason: string | undefined,
  deps: TakedownDeps = {},
): Promise<{ ok: boolean; caseId: string | null; evidenceId: string | null }> {
  const { data: v, error } = await supabaseAdmin
    .from("approved_source_videos")
    .select("id, user_id, url, youtube_video_id, title")
    .eq("id", videoId)
    .maybeSingle();
  if (error || !v) throw new Error("approved source video not found");
  const video = v as TakedownVideoRow;

  const canonicalUrl = video.url ?? `https://www.youtube.com/watch?v=${video.youtube_video_id}`;

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

  const onVerifiedFinding =
    deps.onVerifiedFinding ??
    (await import("@/lib/enforcement/orchestrator")).AutoEnforcementOrchestrator.onVerifiedFinding;
  const result = await onVerifiedFinding(supabaseAdmin, video.user_id, {
    id: video.id,
    source: "approved_youtube_sources",
    source_type: "deepfake",
    canonical_url: canonicalUrl,
    risk_type: "DEEPFAKE",
  });

  await supabaseAdmin
    .from("approved_source_videos")
    .update({ review_status: "takedown_requested" })
    .eq("id", videoId);

  await supabaseAdmin.from("approved_source_takedown_log").insert({
    video_id: videoId,
    user_id: video.user_id,
    actor_id: adminUserId,
    action: "takedown_requested",
    reason: reason ?? null,
    enforcement_case_id: result.caseId,
  });

  return { ok: true, caseId: result.caseId, evidenceId: evidence.evidenceId };
}

export const takedownSourceVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason?: string }) =>
    z.object({ id: z.string().min(1), reason: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return takedownSourceVideoCore(supabaseAdmin, userId, data.id, data.reason);
  });

export const listReviewQueueForAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { data: videos } = await supabase
      .from("approved_source_videos")
      .select("*")
      .in("review_status", ["pending_review", "sent_for_review"])
      .order("analyzed_at", { ascending: false });
    return videos ?? [];
  });
