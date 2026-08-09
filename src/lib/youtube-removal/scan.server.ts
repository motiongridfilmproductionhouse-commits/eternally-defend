/**
 * Orchestrator for the targeted YouTube defamation / removal-candidate scan.
 *
 * Pipeline: DISCOVER (broad, paginated, deduped) -> CLASSIFY CHANNELS
 * (exclude established news organisations by default unless NEWS_ALLEGATIONS or ALL_SOURCES selected)
 * -> VERIFY TARGET + ANALYZE (captions + AI) -> PRIORITIZE -> PERSIST.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildQueryPlan, buildNarrativeQueries } from "./queries";
import { classifyChannel } from "./news-exclusion";
import { analyzeRemovalCandidate, priorityScore, type VideoAnalysis } from "./analyze.server";
import {
  searchVideos,
  fetchVideoDetails,
  fetchChannelDetails,
  type DiscoveredVideo,
} from "./youtube-search.server";
import {
  SourceScope,
  detectNewsAllegationSignals,
  classifyNewsTopics,
  classifySourceType,
  buildAllegationQueryPlan,
} from "./news-intelligence";

type Supa = SupabaseClient<Database>;

const MAX_ANALYZED = 50;

async function patchScan(
  supabase: Supa,
  scanId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase.from("youtube_removal_scans").update(patch as never).eq("id", scanId);
}

export async function runYoutubeRemovalScan(
  supabase: Supa,
  userId: string,
  scanId: string,
  sourceScope: SourceScope = "NON_OFFICIAL_ONLY",
): Promise<{ status: string }> {
  const { data: scan, error } = await supabase
    .from("youtube_removal_scans")
    .select("*")
    .eq("id", scanId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scan) throw new Error("Scan not found");

  const targetName = scan.target_name;
  const aliases = scan.aliases ?? [];
  const activeScope: SourceScope = (scan as any).source_scope || sourceScope;

  let stage = "discovery";
  try {
    await patchScan(supabase, scanId, {
      status: "running",
      stage: "discovery",
      progress: 5,
      started_at: new Date().toISOString(),
      source_scope: activeScope,
      failed_stage: null,
      failure_code: null,
      error_message: null,
    });

    // ---- 1. DISCOVERY --------------------------------------------------
    let plan = buildQueryPlan({ targetName, aliases });
    if (activeScope === "NEWS_ALLEGATIONS" || activeScope === "ALL_SOURCES") {
      const allegationQueries = buildAllegationQueryPlan(targetName, aliases);
      plan = [...plan, ...allegationQueries];
    }

    const byVideo = new Map<string, DiscoveredVideo>();
    const usedQueries: string[] = [];
    let providerErrors = 0;

    const runQueries = async (queries: string[], pages: number) => {
      for (const q of queries) {
        try {
          const hits = await searchVideos(q, { pages });
          usedQueries.push(q);
          for (const hit of hits) {
            const existing = byVideo.get(hit.videoId);
            if (existing) {
              if (!existing.queries.includes(q)) existing.queries.push(q);
            } else {
              byVideo.set(hit.videoId, hit);
            }
          }
        } catch (e) {
          providerErrors++;
          const status = (e as { status?: number }).status;
          if (status === 403) throw e; // quota / key problem — fail loudly
          console.error("[yt-removal] query failed", q, e);
        }
      }
    };

    await runQueries(plan.slice(0, 14), 2);
    await patchScan(supabase, scanId, { progress: 25, discovered_count: byVideo.size });
    await runQueries(plan.slice(14), 1);

    if (!byVideo.size) {
      if (providerErrors) throw new Error("All discovery queries failed");
      await patchScan(supabase, scanId, {
        status: "completed",
        stage: "completed",
        progress: 100,
        completed_at: new Date().toISOString(),
        queries: usedQueries,
        stats: { provider_errors: providerErrors, note: "no_search_results" },
      });
      return { status: "completed" };
    }

    // ---- 2. HYDRATE + CHANNEL CLASSIFICATION ---------------------------
    stage = "hydration";
    await patchScan(supabase, scanId, {
      stage: "hydration",
      progress: 40,
      discovered_count: byVideo.size,
      queries: usedQueries,
    });

    const details = await fetchVideoDetails(Array.from(byVideo.keys()));
    const channels = await fetchChannelDetails(details.map((d) => d.channelId));

    interface Candidate {
      detail: (typeof details)[number];
      queries: string[];
      channelClass: "official_news" | "independent";
      channelReason: string;
      channelHandle: string | null;
      sourceType: ReturnType<typeof classifySourceType>;
    }

    const candidates: Candidate[] = details.map((detail) => {
      const channel = channels.get(detail.channelId);
      const cls = classifyChannel({
        channelTitle: channel?.title ?? detail.channelTitle,
        channelHandle: channel?.handle ?? null,
        channelDescription: channel?.description ?? null,
      });
      const sourceType = classifySourceType(channel?.title ?? detail.channelTitle, cls.channelClass);
      return {
        detail,
        queries: byVideo.get(detail.videoId)?.queries ?? [],
        channelClass: cls.channelClass,
        channelReason: cls.reason,
        channelHandle: channel?.handle ?? null,
        sourceType,
      };
    });

    const officialNews = candidates.filter((c) => c.channelClass === "official_news");
    const independentCandidates = candidates.filter((c) => c.channelClass === "independent");

    const analysable = activeScope === "NON_OFFICIAL_ONLY"
      ? independentCandidates.sort((a, b) => (b.detail.viewCount ?? 0) - (a.detail.viewCount ?? 0))
      : candidates.sort((a, b) => (b.detail.viewCount ?? 0) - (a.detail.viewCount ?? 0));

    const excludedNews = activeScope === "NON_OFFICIAL_ONLY" ? officialNews : [];

    // ---- 3. VERIFY + ANALYZE -------------------------------------------
    stage = "analysis";
    await patchScan(supabase, scanId, {
      stage: "analysis",
      progress: 55,
      excluded_news_count: excludedNews.length,
    });

    const analysed: Array<{
      candidate: Candidate;
      analysis: VideoAnalysis;
      isAllegationMatch: boolean;
      matchedSignals: string[];
      topicTags: ReturnType<typeof classifyNewsTopics>;
    }> = [];
    const narratives = new Set<string>();
    const batch = analysable.slice(0, MAX_ANALYZED);

    for (let i = 0; i < batch.length; i += 4) {
      const slice = batch.slice(i, i + 4);
      const results = await Promise.all(
        slice.map(async (candidate) => {
          const analysis = await analyzeRemovalCandidate({
            targetName,
            aliases,
            video: {
              videoId: candidate.detail.videoId,
              title: candidate.detail.title,
              description: candidate.detail.description,
              channelTitle: candidate.detail.channelTitle,
              publishedAt: candidate.detail.publishedAt,
              viewCount: candidate.detail.viewCount,
              likeCount: candidate.detail.likeCount,
              commentCount: candidate.detail.commentCount,
              durationSeconds: candidate.detail.durationSeconds,
              tags: candidate.detail.tags,
              isUnavailable: candidate.detail.isUnavailable,
            },
          });

          const fullText = `${candidate.detail.title} ${candidate.detail.description}`;
          const { isAllegationMatch, matchedSignals } = detectNewsAllegationSignals(fullText);
          const topicTags = classifyNewsTopics(fullText, matchedSignals);

          return {
            candidate,
            analysis,
            isAllegationMatch,
            matchedSignals,
            topicTags,
          };
        }),
      );
      analysed.push(...results);
      for (const r of results) r.analysis.narratives.forEach((n) => narratives.add(n));
      await patchScan(supabase, scanId, {
        progress: Math.min(90, 55 + Math.round(((i + slice.length) / batch.length) * 30)),
      });
    }

    // ---- 4. PERSIST -----------------------------------------------------
    stage = "persist";
    const rows = [
      ...analysed.map(({ candidate, analysis, isAllegationMatch, matchedSignals, topicTags }) => ({
        scan_id: scanId,
        user_id: userId,
        video_id: candidate.detail.videoId,
        video_url: `https://www.youtube.com/watch?v=${candidate.detail.videoId}`,
        title: candidate.detail.title,
        description: candidate.detail.description.slice(0, 5000),
        channel_id: candidate.detail.channelId || null,
        channel_title: candidate.detail.channelTitle,
        channel_url: candidate.detail.channelId
          ? `https://www.youtube.com/channel/${candidate.detail.channelId}`
          : null,
        published_at: candidate.detail.publishedAt || null,
        thumbnail_url: candidate.detail.thumbnailUrl,
        view_count: candidate.detail.viewCount,
        like_count: candidate.detail.likeCount,
        comment_count: candidate.detail.commentCount,
        duration_seconds: candidate.detail.durationSeconds,
        is_unavailable: candidate.detail.isUnavailable,
        discovery_queries: candidate.queries,
        subject_status: analysis.subjectStatus,
        subject_confidence: analysis.subjectConfidence,
        verification_reason: analysis.verificationReason,
        channel_class: candidate.channelClass,
        source_type: candidate.sourceType,
        is_official_news: candidate.channelClass === "official_news",
        is_official_news_allegation: candidate.channelClass === "official_news" && isAllegationMatch,
        allegation_matched: isAllegationMatch,
        allegation_signals: matchedSignals,
        news_topic_tags: topicTags,
        content_types: analysis.contentTypes,
        risk_level: analysis.riskLevel,
        removal_potential: analysis.removalPotential,
        potential_violation: analysis.potentialViolation,
        problematic_claim: analysis.problematicClaim,
        assessment_reason: analysis.assessmentReason,
        recommended_action: analysis.recommendedAction,
        recommended_route: analysis.recommendedRoute,
        evidence_needed: analysis.evidenceNeeded,
        evidence_timestamps: analysis.evidenceTimestamps,
        evidence_verified: analysis.evidenceVerified,
        transcript_state: analysis.transcriptState,
        transcript_language: analysis.transcriptLanguage,
        priority_score: priorityScore({
          analysis,
          viewCount: candidate.detail.viewCount,
          likeCount: candidate.detail.likeCount,
          commentCount: candidate.detail.commentCount,
          publishedAt: candidate.detail.publishedAt || null,
          discoveryQueryCount: candidate.queries.length,
        }),
        analysis: { channelReason: candidate.channelReason, modelError: analysis.modelError ?? null },
      })),
      ...excludedNews.map((candidate) => ({
        scan_id: scanId,
        user_id: userId,
        video_id: candidate.detail.videoId,
        video_url: `https://www.youtube.com/watch?v=${candidate.detail.videoId}`,
        title: candidate.detail.title,
        description: null,
        channel_id: candidate.detail.channelId || null,
        channel_title: candidate.detail.channelTitle,
        channel_url: candidate.detail.channelId
          ? `https://www.youtube.com/channel/${candidate.detail.channelId}`
          : null,
        published_at: candidate.detail.publishedAt || null,
        thumbnail_url: candidate.detail.thumbnailUrl,
        view_count: candidate.detail.viewCount,
        like_count: candidate.detail.likeCount,
        comment_count: candidate.detail.commentCount,
        duration_seconds: candidate.detail.durationSeconds,
        is_unavailable: candidate.detail.isUnavailable,
        discovery_queries: candidate.queries,
        subject_status: "excluded_official_news",
        subject_confidence: 0,
        verification_reason: candidate.channelReason,
        channel_class: "official_news" as const,
        source_type: "OFFICIAL_NEWS" as const,
        is_official_news: true,
        is_official_news_allegation: false,
        allegation_matched: false,
        allegation_signals: [],
        news_topic_tags: [],
        content_types: [],
        risk_level: "low",
        removal_potential: "not_eligible",
        potential_violation: null,
        problematic_claim: null,
        assessment_reason: "EXCLUDED_OFFICIAL_NEWS — established broadcaster",
        recommended_action: "MONITOR / REVIEW",
        recommended_route: "monitor_only",
        evidence_needed: null,
        evidence_timestamps: [],
        evidence_verified: false,
        transcript_state: null,
        transcript_language: null,
        priority_score: 0,
        analysis: {},
      })),
    ];

    for (let i = 0; i < rows.length; i += 100) {
      const { error: upsertError } = await supabase
        .from("youtube_removal_findings")
        .upsert(rows.slice(i, i + 100) as never, { onConflict: "scan_id,video_id" });
      if (upsertError) throw new Error(`findings upsert failed: ${upsertError.message}`);
    }

    const verified = analysed.filter((a) => a.analysis.subjectStatus === "verified");
    const actionable = verified.filter(
      (a) => a.analysis.removalPotential === "high" || a.analysis.removalPotential === "medium",
    );

    const officialNewsVerified = verified.filter((a) => a.candidate.channelClass === "official_news");
    const officialNewsAllegationMatched = officialNewsVerified.filter((a) => a.isAllegationMatch);

    await patchScan(supabase, scanId, {
      status: "completed",
      stage: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      queries: usedQueries,
      discovered_count: byVideo.size,
      verified_count: verified.length,
      not_subject_count: analysed.filter((a) => a.analysis.subjectStatus === "not_subject").length,
      excluded_news_count: excludedNews.length,
      actionable_count: actionable.length,
      stats: {
        provider_errors: providerErrors,
        queries_run: usedQueries.length,
        analysed: analysed.length,
        analysable: analysable.length,
        source_scope: activeScope,
        official_news_discovered: officialNews.length,
        official_news_target_verified: officialNewsVerified.length,
        official_news_allegation_matched: officialNewsAllegationMatched.length,
        independent_verified: verified.filter((a) => a.candidate.channelClass !== "official_news").length,
        total_verified_all_sources: verified.length,
        narrative_seeds: Array.from(narratives).slice(0, 12),
        suggested_followup_queries: buildNarrativeQueries(targetName, Array.from(narratives)).slice(0, 10),
      },
    });

    return { status: "completed" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number }).status;
    await patchScan(supabase, scanId, {
      status: "failed",
      stage: "failed",
      failed_stage: stage,
      failure_code:
        status === 403
          ? "youtube_quota_or_key"
          : message.includes("YOUTUBE_API_KEY_MISSING")
            ? "youtube_key_missing"
            : "scan_error",
      error_message: message.slice(0, 500),
      completed_at: new Date().toISOString(),
    });
    throw e;
  }
}
