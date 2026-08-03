import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guessType, sameDay } from "@/lib/copyright/youtube-monitor-helpers";
import type { Database } from "@/integrations/supabase/types";

type VideoInsert = Database["public"]["Tables"]["copyright_youtube_videos"]["Insert"];

/** Discover and analyse public YouTube videos related to a protected work. */
export const runYoutubeMonitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const [{ readStoredObject, bytesToDataUrl }, { analyzeReference }, { buildMovieFingerprint }, ytm] =
      await Promise.all([
        import("@/lib/copyright/storage.server"),
        import("@/lib/copyright/discover.server"),
        import("@/lib/copyright/fingerprint.server"),
        import("@/lib/copyright/youtube-monitor.server"),
      ]);
    const { analyzeYoutubeVideo, buildYoutubeQueries, corroborateThumbnail, discoverYoutubeVideos, scoreVideo } = ytm;
    const { supabase, userId } = context;

    const { data: scan, error } = await supabase
      .from("copyright_scans").select("*").eq("id", data.scanId).single();
    if (error || !scan) throw new Error(error?.message ?? "Scan not found.");

    const framePaths = (Array.isArray(scan.frame_paths) ? scan.frame_paths : [scan.storage_path])
      .filter(Boolean).slice(0, 3) as string[];
    const frames: Uint8Array[] = [];
    for (const key of framePaths) {
      const bytes = await readStoredObject(key).catch(() => new Uint8Array());
      if (bytes.length) frames.push(bytes);
    }
    if (!frames.length) throw new Error("Reference material for this scan could not be read.");

    const referenceDataUrl = bytesToDataUrl(frames[0], guessType(framePaths[0]));

    const [analysis, fingerprint] = await Promise.all([
      analyzeReference(referenceDataUrl, scan.title),
      buildMovieFingerprint(frames, scan.title),
    ]);

    const queries = buildYoutubeQueries({
      title: scan.title,
      altTitles: analysis.altTitles,
      actors: [...new Set([...(analysis.actors ?? []), ...fingerprint.celebrities])],
      director: null,
      studio: analysis.productionCompany,
      language: analysis.language,
    });

    // Focus on the release window when a release date is known.
    let publishedAfter: string | null = null;
    if (analysis.releaseDate) {
      const rd = new Date(analysis.releaseDate);
      if (!Number.isNaN(+rd)) publishedAfter = new Date(+rd - 7 * 86400_000).toISOString();
    }

    const videos = await discoverYoutubeVideos(queries, { publishedAfter, perQuery: 8 });

    const rows: VideoInsert[] = [];
    for (let i = 0; i < videos.length; i += 4) {
      const batch = videos.slice(i, i + 4);
      const analysed = await Promise.all(batch.map(async (video) => {
        const [intel, rek] = await Promise.all([
          analyzeYoutubeVideo({ video, workTitle: scan.title, referenceDataUrl }),
          corroborateThumbnail(fingerprint, video.thumbnailUrl),
        ]);
        return { video, intel, rek };
      }));

      for (const { video, intel, rek } of analysed) {
        const isSameDay = sameDay(video.publishedAt, analysis.releaseDate);
        const risk = scoreVideo({ intel, video, rekScore: rek?.score ?? 0, sameDayRelease: isSameDay });
        // Keep only videos with copyright usage, reputation risk or a strong visual match.
        const keep =
          (intel && intel.copyrightUsage !== "none") ||
          (intel && intel.sentiment === "negative") ||
          (intel?.reputationRisk.length ?? 0) > 0 ||
          (rek?.score ?? 0) >= 40;
        if (!keep) continue;

        rows.push({
          scan_id: scan.id,
          user_id: userId,
          video_id: video.videoId,
          video_url: video.videoUrl,
          title: video.title,
          description: video.description.slice(0, 2000),
          channel_id: video.channelId,
          channel_title: video.channelTitle,
          channel_url: video.channelUrl,
          thumbnail_url: video.thumbnailUrl,
          published_at: video.publishedAt,
          view_count: video.viewCount,
          like_count: video.likeCount,
          comment_count: video.commentCount,
          duration_seconds: video.durationSeconds,
          matched_query: video.matchedQuery,
          content_category: intel?.contentCategory ?? "unknown",
          copyright_usage: intel?.copyrightUsage ?? "none",
          copyright_signals: (intel?.copyrightSignals ?? []) as unknown as VideoInsert["copyright_signals"],
          sentiment: intel?.sentiment ?? "neutral",
          sentiment_score: intel?.sentimentScore ?? 0,
          risk_score: risk,
          same_day_release: isSameDay,
          ai_summary: intel?.summary ?? null,
          evidence: {
            reputation_risk: intel?.reputationRisk ?? [],
            recognition: rek
              ? {
                  provider: "aws_rekognition",
                  score: rek.score,
                  face_similarity: rek.faceSimilarity,
                  actor_matches: rek.celebrityMatches,
                  scene_overlap: rek.sceneOverlap,
                  ocr_title_match: rek.ocrTitleMatch,
                  signals: rek.signals,
                }
              : { provider: fingerprint.available ? "no_match" : "unavailable" },
            reference_actors: analysis.actors,
            reference_alt_titles: analysis.altTitles,
            release_date: analysis.releaseDate,
            matched_query: video.matchedQuery,
          } as unknown as VideoInsert["evidence"],
        });
      }
    }

    if (rows.length) {
      const { error: upErr } = await supabase
        .from("copyright_youtube_videos").upsert(rows, { onConflict: "scan_id,video_id" });
      if (upErr) throw new Error(upErr.message);
    }

    return {
      scanned: videos.length,
      queries: queries.length,
      flagged: rows.length,
      rekognition: fingerprint.available,
      actors: fingerprint.celebrities,
    };
  });

export const listYoutubeMonitor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("copyright_youtube_videos").select("*")
      .eq("scan_id", data.scanId)
      .order("risk_score", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateYoutubeMonitorReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    videoRowId: z.string().uuid(),
    reviewStatus: z.enum(["pending", "evidence_ready", "dismissed"]),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("copyright_youtube_videos").update({ review_status: data.reviewStatus }).eq("id", data.videoRowId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Release Day Review & Reputation Analysis — monitoring insight only. */
export const runReleaseDayReviewAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const {
      buildReleaseReviewQueries, discoverYoutubeVideos, fetchVideoComments,
      analyzeReleaseReview, scoreReputationImpact,
    } = await import("@/lib/copyright/youtube-monitor.server");
    const { supabase, userId } = context;

    const { data: scan, error } = await supabase
      .from("copyright_scans").select("*").eq("id", data.scanId).single();
    if (error || !scan) throw new Error(error?.message ?? "Scan not found.");

    const framePaths = (Array.isArray(scan.frame_paths) ? scan.frame_paths : [scan.storage_path])
      .filter(Boolean).slice(0, 1) as string[];
    const bytes = framePaths[0] ? await readStoredObject(framePaths[0]).catch(() => new Uint8Array()) : new Uint8Array();
    if (!bytes.length) throw new Error("Reference material for this scan could not be read.");
    const referenceDataUrl = bytesToDataUrl(bytes, guessType(framePaths[0]));

    const analysis = await analyzeReference(referenceDataUrl, scan.title);

    let publishedAfter: string | null = null;
    if (analysis.releaseDate) {
      const rd = new Date(analysis.releaseDate);
      if (!Number.isNaN(+rd)) publishedAfter = new Date(+rd - 3 * 86400_000).toISOString();
    }

    const queries = buildReleaseReviewQueries({
      title: scan.title,
      altTitles: analysis.altTitles,
      actors: analysis.actors,
      language: analysis.language,
    });

    const videos = await discoverYoutubeVideos(queries, { publishedAfter, perQuery: 8 });
    const rows: VideoInsert[] = [];

    for (let i = 0; i < videos.length; i += 3) {
      const batch = videos.slice(i, i + 3);
      const analysed = await Promise.all(batch.map(async (video) => {
        const comments = await fetchVideoComments(video.videoId, 12);
        const intel = await analyzeReleaseReview({
          video, workTitle: scan.title, referenceDataUrl, comments,
        });
        return { video, intel, comments };
      }));

      for (const { video, intel, comments } of analysed) {
        if (!intel || !intel.isReview || intel.reviewType === "not_a_review") continue;
        const isSameDay = sameDay(video.publishedAt, analysis.releaseDate);
        const { score, impact } = scoreReputationImpact({ intel, video, sameDayRelease: isSameDay });

        rows.push({
          scan_id: scan.id,
          user_id: userId,
          video_id: video.videoId,
          video_url: video.videoUrl,
          title: video.title,
          description: video.description.slice(0, 2000),
          channel_id: video.channelId,
          channel_title: video.channelTitle,
          channel_url: video.channelUrl,
          thumbnail_url: video.thumbnailUrl,
          published_at: video.publishedAt,
          view_count: video.viewCount,
          like_count: video.likeCount,
          comment_count: video.commentCount,
          duration_seconds: video.durationSeconds,
          matched_query: video.matchedQuery,
          content_category: intel.reviewType,
          copyright_usage: intel.copyrightUsage,
          copyright_signals: intel.copyrightSignals as unknown as VideoInsert["copyright_signals"],
          sentiment: intel.sentiment,
          sentiment_score: intel.sentimentScore,
          risk_score: score,
          same_day_release: isSameDay,
          ai_summary: intel.summary,
          is_release_review: true,
          review_type: intel.reviewType,
          reputation_impact: impact,
          reputation_impact_score: score,
          key_statements: intel.keyStatements as unknown as VideoInsert["key_statements"],
          misleading_signals: intel.misleadingSignals as unknown as VideoInsert["misleading_signals"],
          comment_samples: comments.slice(0, 8) as unknown as VideoInsert["comment_samples"],
          evidence_timestamps: intel.evidenceTimestamps as unknown as VideoInsert["evidence_timestamps"],
          evidence: {
            mode: "release_day_review",
            release_date: analysis.releaseDate,
            matched_query: video.matchedQuery,
            reputation_risk: intel.misleadingSignals,
          } as unknown as VideoInsert["evidence"],
        });
      }
    }

    if (rows.length) {
      const { error: upErr } = await supabase
        .from("copyright_youtube_videos").upsert(rows, { onConflict: "scan_id,video_id" });
      if (upErr) throw new Error(upErr.message);
    }

    return {
      scanned: videos.length,
      queries: queries.length,
      reviews: rows.length,
      high: rows.filter((r) => r.reputation_impact === "high").length,
    };
  });

export const listReleaseDayReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("copyright_youtube_videos").select("*")
      .eq("scan_id", data.scanId)
      .eq("is_release_review", true)
      .order("reputation_impact_score", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
