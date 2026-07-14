import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Video Analysis functions — captions-only foundation.
 *
 * Idempotent per (user, video). Safe to call from a scan finalizer or from
 * a user-triggered "Re-analyze" button. Never fabricates timestamps.
 */

const AnalyzeInput = z.object({
  videoId: z.string().min(1),
  scanId: z.string().uuid().optional().nullable(),
  scanHitId: z.string().uuid().optional().nullable(),
  entityTerms: z.array(z.string()).max(30).default([]),
  preferredLanguages: z.array(z.string()).max(8).default([]),
  channelId: z.string().optional().nullable(),
  channelName: z.string().optional().nullable(),
  channelUrl: z.string().optional().nullable(),
});

export const analyzeYoutubeVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnalyzeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { videoId } = data;

    // Fast path: if we already have a completed job for this video+scan, return existing counts.
    const existing = await supabase
      .from("video_analysis_jobs")
      .select("id, analysis_state, captions_state, finding_count, transcript_segment_count")
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("video_id", videoId)
      .eq("scan_id", data.scanId ?? "")
      .maybeSingle();

    // Upsert an analysis job row (initial state).
    const jobUpsert = await supabase
      .from("video_analysis_jobs")
      .upsert(
        {
          user_id: userId,
          platform: "youtube",
          video_id: videoId,
          scan_id: data.scanId ?? null,
          scan_hit_id: data.scanHitId ?? null,
          analysis_state: "running",
          started_at: new Date().toISOString(),
        } as never,
        { onConflict: "user_id,platform,video_id,scan_id" },
      )
      .select("id")
      .single();
    if (jobUpsert.error) throw new Error(`job upsert: ${jobUpsert.error.message}`);
    const jobId = jobUpsert.data.id;

    // If a completed job already exists for this exact scope, don't re-run.
    if (existing.data?.analysis_state === "completed") {
      return {
        jobId,
        captionsState: existing.data.captions_state,
        transcriptSegmentCount: existing.data.transcript_segment_count,
        findingCount: existing.data.finding_count,
        skipped: true,
      };
    }

    // 1) Fetch captions.
    const { fetchYoutubeCaptions } = await import("@/lib/mm/youtube-captions.server");
    const cap = await fetchYoutubeCaptions(videoId, data.preferredLanguages);

    // If captions unavailable, mark metadata-only and exit cleanly.
    if (!cap.available || !cap.segments?.length) {
      await supabase
        .from("video_analysis_jobs")
        .update({
          captions_state: cap.reason === "no_caption_tracks" ? "captions_unavailable" : "metadata_only",
          analysis_state: "completed",
          error: cap.reason,
          completed_at: new Date().toISOString(),
        } as never)
        .eq("id", jobId);
      return { jobId, captionsState: "metadata_only", transcriptSegmentCount: 0, findingCount: 0, reason: cap.reason };
    }

    // 2) Enrich creator (best-effort).
    let creatorProfileId: string | null = null;
    if (data.channelId) {
      const { fetchYoutubeChannel, computeCreatorIntelligence } = await import("@/lib/mm/youtube-channel.server");
      const info = (await fetchYoutubeChannel(data.channelId)) ?? {
        channelId: data.channelId,
        channelUrl: data.channelUrl ?? `https://www.youtube.com/channel/${data.channelId}`,
        channelName: data.channelName ?? undefined,
      };
      const intelligence = computeCreatorIntelligence({
        subscriberCount: info.subscriberCount,
        totalViewCount: info.totalViewCount,
        videoCount: info.videoCount,
        findingsCount: 0,
        criticalFindingsCount: 0,
      });
      const up = await supabase
        .from("video_creator_profiles")
        .upsert(
          {
            user_id: userId,
            platform: "youtube",
            channel_id: info.channelId,
            channel_url: info.channelUrl,
            channel_name: info.channelName ?? null,
            channel_handle: info.handle ?? null,
            profile_image_url: info.profileImageUrl ?? null,
            description: info.description?.slice(0, 4000) ?? null,
            country: info.country ?? null,
            channel_created_at: info.channelCreatedAt ?? null,
            subscriber_count: info.subscriberCount ?? null,
            total_view_count: info.totalViewCount ?? null,
            video_count: info.videoCount ?? null,
            influence_score: intelligence.influenceScore,
            credibility_score: intelligence.credibilityScore,
            threat_amplification_score: intelligence.threatAmplificationScore,
            first_detected_at: new Date().toISOString(),
            latest_detected_at: new Date().toISOString(),
          } as never,
          { onConflict: "user_id,platform,channel_id" },
        )
        .select("id")
        .single();
      if (!up.error) creatorProfileId = up.data.id;
    }

    // 3) Persist transcript segments (idempotent per video).
    await supabase
      .from("video_transcript_segments")
      .delete()
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("video_id", videoId);

    const segmentRows = cap.segments.map((s) => ({
      user_id: userId,
      platform: "youtube",
      video_id: videoId,
      scan_hit_id: data.scanHitId ?? null,
      source: cap.source ?? "youtube_caption",
      language: cap.language ?? null,
      is_auto_generated: cap.isAutoGenerated ?? null,
      start_seconds: s.startSeconds,
      end_seconds: s.endSeconds,
      text: s.text.slice(0, 4000),
    }));

    // Batch insert 500 at a time.
    const insertedIds: string[] = [];
    for (let i = 0; i < segmentRows.length; i += 500) {
      const slice = segmentRows.slice(i, i + 500);
      const ins = await supabase.from("video_transcript_segments").insert(slice as never).select("id, start_seconds");
      if (ins.error) throw new Error(`segments insert: ${ins.error.message}`);
      for (const r of ins.data ?? []) insertedIds.push((r as { id: string }).id);
    }

    // Rebuild segment index (order by start_seconds) → id map.
    const orderedSegments = [...cap.segments].sort((a, b) => a.startSeconds - b.startSeconds);
    const dbRows = await supabase
      .from("video_transcript_segments")
      .select("id, start_seconds, text")
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("video_id", videoId)
      .order("start_seconds", { ascending: true });
    if (dbRows.error) throw new Error(dbRows.error.message);
    const segIndexToDbId = new Map<number, string>();
    (dbRows.data ?? []).forEach((row, idx) => segIndexToDbId.set(idx, (row as { id: string }).id));

    // 4) Classify with Gemini.
    const { classifyTranscriptSegments, formatTimeDisplay } = await import("@/lib/mm/video-classify.server");
    const { findings } = await classifyTranscriptSegments(
      orderedSegments.map((s, i) => ({ ...s, index: i })),
      data.entityTerms,
      cap.language,
    );

    // 5) Replace prior timestamp findings for this video+user, then insert fresh.
    await supabase
      .from("video_timestamp_findings")
      .delete()
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("video_id", videoId);

    const findingRows = findings.map((f) => {
      const seg = orderedSegments[f.segmentIndex];
      const prev = f.segmentIndex > 0 ? orderedSegments[f.segmentIndex - 1] : null;
      const next = f.segmentIndex < orderedSegments.length - 1 ? orderedSegments[f.segmentIndex + 1] : null;
      const startSec = seg?.startSeconds ?? 0;
      const endSec = seg?.endSeconds ?? startSec;
      return {
        user_id: userId,
        scan_id: data.scanId ?? null,
        scan_hit_id: data.scanHitId ?? null,
        creator_profile_id: creatorProfileId,
        platform: "youtube",
        video_id: videoId,
        video_url: `https://www.youtube.com/watch?v=${videoId}`,
        channel_id: data.channelId ?? null,
        channel_url: data.channelUrl ?? (data.channelId ? `https://www.youtube.com/channel/${data.channelId}` : null),
        channel_name: data.channelName ?? null,
        segment_id: segIndexToDbId.get(f.segmentIndex) ?? null,
        start_seconds: startSec,
        end_seconds: endSec,
        start_time_display: formatTimeDisplay(startSec),
        end_time_display: formatTimeDisplay(endSec),
        original_text: seg?.text.slice(0, 2000) ?? "",
        original_language: cap.language ?? null,
        translated_text: f.translatedText ?? null,
        translation_language: f.translationLanguage ?? null,
        context_before: prev?.text.slice(0, 500) ?? null,
        context_after: next?.text.slice(0, 500) ?? null,
        matched_entity: f.matchedEntity || null,
        claim_summary: f.claimSummary || null,
        context_type: f.contextType,
        speaker_stance: f.speakerStance,
        risk_category: f.riskCategory,
        severity: f.severity,
        confidence: f.confidence,
        evidence_source: cap.isAutoGenerated ? "auto_caption" : "timestamped_transcript",
        watch_exact_moment_url: `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(startSec)}s`,
        review_status: "pending",
      };
    });
    for (let i = 0; i < findingRows.length; i += 200) {
      const slice = findingRows.slice(i, i + 200);
      const ins = await supabase.from("video_timestamp_findings").insert(slice as never);
      if (ins.error) throw new Error(`findings insert: ${ins.error.message}`);
    }

    // 6) Finalize job + creator counters.
    const captionsState = orderedSegments.length > 20 ? "captions_analysed" : "partial_captions";
    await supabase
      .from("video_analysis_jobs")
      .update({
        captions_state: captionsState,
        analysis_state: "completed",
        transcript_segment_count: orderedSegments.length,
        finding_count: findingRows.length,
        caption_language: cap.language ?? null,
        caption_source: cap.source ?? "youtube_caption",
        completed_at: new Date().toISOString(),
      } as never)
      .eq("id", jobId);

    if (creatorProfileId) {
      const criticalCount = findingRows.filter((f) => f.severity === "critical" || f.severity === "high").length;
      // Bump counters (best-effort; ignore errors).
      await supabase.rpc; // no-op reference
      const now = new Date().toISOString();
      await supabase
        .from("video_creator_profiles")
        .update({
          findings_count: (findingRows.length),
          critical_findings_count: criticalCount,
          latest_detected_at: now,
        } as never)
        .eq("id", creatorProfileId);
      await supabase.from("video_creator_risk_history").insert({
        user_id: userId,
        creator_profile_id: creatorProfileId,
        findings_count: findingRows.length,
        critical_findings_count: criticalCount,
        reason: "video_analysis",
      } as never);
    }

    return {
      jobId,
      captionsState,
      transcriptSegmentCount: orderedSegments.length,
      findingCount: findingRows.length,
    };
  });

/* -------------- Read APIs -------------- */

export const listVideoTimestampFindings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ videoId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [findings, job] = await Promise.all([
      supabase
        .from("video_timestamp_findings")
        .select(
          "id, start_seconds, end_seconds, start_time_display, end_time_display, speaker_label, original_text, original_language, translated_text, translation_language, context_before, context_after, matched_entity, claim_summary, context_type, speaker_stance, risk_category, severity, confidence, evidence_source, watch_exact_moment_url, review_status, reviewer_notes, video_url, channel_url, channel_name, creator_profile_id",
        )
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("video_id", data.videoId)
        .order("start_seconds", { ascending: true }),
      supabase
        .from("video_analysis_jobs")
        .select("captions_state, analysis_state, transcript_segment_count, finding_count, caption_language, error")
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("video_id", data.videoId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (findings.error) throw new Error(findings.error.message);
    return { findings: findings.data ?? [], job: job.data ?? null };
  });

export const updateFindingReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "false_positive", "legal_review"]),
        notes: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("video_timestamp_findings")
      .update({
        review_status: data.status,
        reviewer_notes: data.notes ?? null,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCreatorProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ channelId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [profile, findings] = await Promise.all([
      supabase
        .from("video_creator_profiles")
        .select("*")
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("channel_id", data.channelId)
        .maybeSingle(),
      supabase
        .from("video_timestamp_findings")
        .select("id, video_id, video_url, start_seconds, watch_exact_moment_url, severity, context_type, claim_summary, matched_entity, original_text")
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("channel_id", data.channelId)
        .order("start_seconds", { ascending: true })
        .limit(200),
    ]);
    return { profile: profile.data ?? null, findings: findings.data ?? [] };
  });

export const setCreatorMonitoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ channelId: z.string(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("video_creator_profiles")
      .update({ monitoring_enabled: data.enabled } as never)
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("channel_id", data.channelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
