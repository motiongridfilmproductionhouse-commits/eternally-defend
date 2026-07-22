/**
 * Narrative Intelligence
 *
 * Combines eligible Multimedia Intelligence findings and Channel Watch risks.
 * Informational and not-relevant results are excluded.
 * Allegations remain unverified until human review.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function normalizeClaim(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function claimKey(value: string): string {
  const normalized = normalizeClaim(value);
  return `claim-text:${hashText(normalized || value)}`;
}

function hostPath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function validIso(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

type GroupFinding = {
  id: string;
  origin: "multimedia" | "channel_watch";
  title: string;
  createdAt: string;
  sourceRef: string;
  sourceName: string;
  reach: number;
  target: string;
  severity: string;
  confidence: number;
  multimediaFindingId?: string;
};

type Group = {
  key: string;
  kind: string;
  target: string;
  summary: string;
  findings: GroupFinding[];
  sources: Set<string>;
  reachBySource: Map<string, number>;
  hostCounts: Map<string, number>;
};

function addToGroup(
  groups: Map<string, Group>,
  input: {
    key: string;
    kind: string;
    target: string;
    summary: string;
    finding: GroupFinding;
  },
) {
  const group = groups.get(input.key) ?? {
    key: input.key,
    kind: input.kind,
    target: input.target,
    summary: input.summary,
    findings: [],
    sources: new Set<string>(),
    reachBySource: new Map<string, number>(),
    hostCounts: new Map<string, number>(),
  };

  group.findings.push(input.finding);
  group.sources.add(input.finding.sourceRef);

  if (!group.reachBySource.has(input.finding.sourceRef)) {
    group.reachBySource.set(
      input.finding.sourceRef,
      input.finding.reach,
    );
  }

  group.hostCounts.set(
    input.finding.sourceName,
    (group.hostCounts.get(input.finding.sourceName) ?? 0) + 1,
  );

  groups.set(input.key, group);
}

export const clusterFindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [
      jobsResult,
      findingsResult,
      channelVideosResult,
      watchesResult,
    ] = await Promise.all([
      supabase
        .from("multimedia_analysis_jobs")
        .select(
          "id,source_ref,source_kind,source_metadata,target_name",
        )
        .eq("user_id", userId),

      supabase
        .from("timestamp_findings")
        .select(
          "id,job_id,title,extracted_claim_id,severity,created_at,confidence",
        )
        .eq("user_id", userId),

      supabase
        .from("channel_watch_videos")
        .select(
          "id,watch_id,video_id,title,description,url,published_at,detected_at,view_count,risk_score,classification,review_status,analysis_status,mention_match",
        )
        .eq("user_id", userId)
        .eq("analysis_status", "completed")
        .in("classification", [
          "potential_harm",
          "potential_impersonation",
        ])
        .limit(1000),

      supabase
        .from("channel_watches")
        .select("id,channel_title,handle,reason,channel_url")
        .eq("user_id", userId),
    ]);

    if (jobsResult.error) throw new Error(jobsResult.error.message);
    if (findingsResult.error) throw new Error(findingsResult.error.message);
    if (channelVideosResult.error) {
      throw new Error(channelVideosResult.error.message);
    }
    if (watchesResult.error) throw new Error(watchesResult.error.message);

    const jobs = jobsResult.data ?? [];
    const multimediaFindings = findingsResult.data ?? [];
    const channelVideos = channelVideosResult.data ?? [];
    const watches = watchesResult.data ?? [];

    const jobMap = new Map(
      jobs.map((job: any) => [job.id, job]),
    );

    const watchMap = new Map(
      watches.map((watch: any) => [watch.id, watch]),
    );

    const groups = new Map<string, Group>();

    // Existing Multimedia Intelligence findings.
    for (const finding of multimediaFindings as any[]) {
      const job: any = jobMap.get(finding.job_id);
      if (!job) continue;

      const metadata = job.source_metadata ?? {};
      const sourceRef =
        job.source_ref ||
        (metadata.video_id
          ? `https://www.youtube.com/watch?v=${metadata.video_id}`
          : `multimedia:${job.id}`);

      const summary = String(
        finding.title ??
        metadata.title ??
        job.target_name ??
        "Unverified narrative",
      );

      const key = finding.extracted_claim_id
        ? `claim:${finding.extracted_claim_id}`
        : metadata.video_id
          ? `video:${metadata.video_id}`
          : job.source_ref?.startsWith("http")
            ? `url:${hostPath(job.source_ref)}`
            : claimKey(summary);

      let sourceName = job.source_kind ?? "multimedia";
      try {
        sourceName = new URL(sourceRef).host;
      } catch {
        // Retain source kind.
      }

      addToGroup(groups, {
        key,
        kind: finding.extracted_claim_id ? "claim" : "multimedia",
        target: job.target_name ?? "Protected subject",
        summary,
        finding: {
          id: finding.id,
          origin: "multimedia",
          title: summary,
          createdAt: validIso(finding.created_at),
          sourceRef,
          sourceName,
          reach: Number(metadata.view_count ?? 0),
          target: job.target_name ?? "Protected subject",
          severity: finding.severity ?? "unknown",
          confidence: Number(finding.confidence ?? 0),
          multimediaFindingId: finding.id,
        },
      });
    }

    let importedChannelWatch = 0;

    // Eligible Channel Watch findings.
    for (const video of channelVideos as any[]) {
      const watch: any = watchMap.get(video.watch_id);
      if (!watch) continue;

      const mentionMatch =
        video.mention_match &&
        typeof video.mention_match === "object"
          ? video.mention_match as Record<string, unknown>
          : {};

      const timestampFindings = Array.isArray(
        mentionMatch.timestamp_findings,
      )
        ? mentionMatch.timestamp_findings as Array<Record<string, unknown>>
        : [];

      const sourceRef =
        video.url ||
        `https://www.youtube.com/watch?v=${video.video_id}`;

      const sourceName =
        watch.channel_title ??
        watch.handle ??
        "YouTube Channel Watch";

      const target =
        watch.reason ??
        "Protected subject";

      const fallbackSummary =
        video.title ??
        video.description ??
        `Potential risk concerning ${target}`;

      const eligibleFindings =
        timestampFindings.length > 0
          ? timestampFindings
          : [{
              claimSummary: fallbackSummary,
              severity:
                Number(video.risk_score ?? 0) >= 85
                  ? "critical"
                  : Number(video.risk_score ?? 0) >= 70
                    ? "high"
                    : Number(video.risk_score ?? 0) >= 40
                      ? "medium"
                      : "low",
              confidence: 0,
            }];

      for (
        let findingIndex = 0;
        findingIndex < eligibleFindings.length;
        findingIndex += 1
      ) {
        const finding = eligibleFindings[findingIndex];

        const summary = String(
          finding.claimSummary ??
          finding.translatedText ??
          finding.text ??
          fallbackSummary,
        ).trim();

        if (!summary) continue;

        addToGroup(groups, {
          key: `subject-risk:${hashText(normalizeClaim(target))}:${video.classification}`,
          kind: "channel_watch_campaign",
          target,
          summary: `${target} — ${String(video.classification).replaceAll("_", " ")}`,
          finding: {
            id: `${video.id}:${findingIndex}`,
            origin: "channel_watch",
            title: summary,
            createdAt: validIso(
              video.detected_at ??
              video.published_at,
            ),
            sourceRef,
            sourceName,
            reach: Number(video.view_count ?? 0),
            target,
            severity: String(
              finding.severity ??
              (
                Number(video.risk_score ?? 0) >= 70
                  ? "high"
                  : "medium"
              ),
            ),
            confidence: Number(finding.confidence ?? 0),
          },
        });

        importedChannelWatch += 1;
      }
    }

    // Remove obsolete claim-text clusters replaced by the merged
    // subject-risk Channel Watch clusters. Only clusters sharing one of
    // the currently imported Channel Watch source URLs are removed.
    const activeClusterKeys = new Set(groups.keys());

    const channelSourceRefs = new Set(
      (channelVideos as any[]).map(
        (video) =>
          video.url ||
          `https://www.youtube.com/watch?v=${video.video_id}`,
      ),
    );

    const existingClustersResult = await supabase
      .from("narrative_clusters")
      .select("id,cluster_key,sources")
      .eq("user_id", userId);

    if (existingClustersResult.error) {
      throw new Error(existingClustersResult.error.message);
    }

    const obsoleteClusterIds = (existingClustersResult.data ?? [])
      .filter((existing: any) => {
        if (activeClusterKeys.has(existing.cluster_key)) return false;
        if (!String(existing.cluster_key).startsWith("claim-text:")) {
          return false;
        }

        const existingSources = Array.isArray(existing.sources)
          ? existing.sources
          : [];

        return existingSources.some(
          (source: unknown) =>
            typeof source === "string" &&
            channelSourceRefs.has(source),
        );
      })
      .map((existing: any) => existing.id);

    if (obsoleteClusterIds.length > 0) {
      const deleteResult = await supabase
        .from("narrative_clusters")
        .delete()
        .eq("user_id", userId)
        .in("id", obsoleteClusterIds);

      if (deleteResult.error) {
        throw new Error(deleteResult.error.message);
      }
    }

    let created = 0;
    let updated = 0;
    let linked = 0;

    for (const group of groups.values()) {
      const times = group.findings
        .map((finding) => new Date(finding.createdAt).getTime())
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      if (times.length === 0) continue;

      const firstDetected = new Date(times[0]).toISOString();
      const latestDetected = new Date(
        times[times.length - 1],
      ).toISOString();

      const dominantSource =
        [...group.hostCounts.entries()]
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const combinedReach =
        [...group.reachBySource.values()]
          .reduce((sum, reach) => sum + reach, 0);

      const payload = {
        user_id: userId,
        cluster_key: group.key,
        target_name: group.target,
        source_count: group.sources.size,
        combined_reach: combinedReach,
        first_detected_at: firstDetected,
        latest_detected_at: latestDetected,
        dominant_source: dominantSource,
        narrative_summary: group.summary,
        sources: Array.from(group.sources).slice(0, 100) as any,
      };

      const existingResult = await supabase
        .from("narrative_clusters")
        .select("id")
        .eq("user_id", userId)
        .eq("cluster_key", group.key)
        .maybeSingle();

      if (existingResult.error) {
        throw new Error(existingResult.error.message);
      }

      let clusterId: string;

      if (existingResult.data?.id) {
        clusterId = existingResult.data.id;

        const updateResult = await supabase
          .from("narrative_clusters")
          .update(payload)
          .eq("id", clusterId);

        if (updateResult.error) {
          throw new Error(updateResult.error.message);
        }

        updated += 1;
      } else {
        const insertResult = await supabase
          .from("narrative_clusters")
          .insert(payload)
          .select("id")
          .single();

        if (insertResult.error || !insertResult.data) {
          throw new Error(
            insertResult.error?.message ??
            "Unable to create narrative cluster",
          );
        }

        clusterId = insertResult.data.id;
        created += 1;
      }

      const multimediaIds = group.findings
        .filter(
          (finding) =>
            finding.origin === "multimedia" &&
            finding.multimediaFindingId,
        )
        .map(
          (finding) => finding.multimediaFindingId as string,
        );

      if (multimediaIds.length > 0) {
        const linkResult = await supabase
          .from("timestamp_findings")
          .update({ cluster_id: clusterId } as any)
          .in("id", multimediaIds);

        if (linkResult.error) {
          throw new Error(linkResult.error.message);
        }

        linked += multimediaIds.length;
      }
    }

    return {
      created,
      updated,
      linked,
      clusters: groups.size,
      importedChannelWatch,
      eligibleChannelVideos: channelVideos.length,
    };
  });

export const listNarrativeClusters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const result = await supabase
      .from("narrative_clusters")
      .select("*")
      .eq("user_id", userId)
      .order("latest_detected_at", { ascending: false })
      .limit(100);

    if (result.error) throw new Error(result.error.message);

    const clusters = (result.data ?? []).map((cluster: any) => {
      const ageDays = Math.max(
        1,
        (
          Date.now() -
          new Date(cluster.first_detected_at).getTime()
        ) / 86400000,
      );

      const velocity = cluster.source_count / ageDays;

      const threat = Math.min(
        100,
        Math.round(
          velocity * 10 +
          Math.log10(
            Math.max(1, cluster.combined_reach),
          ) * 8 +
          cluster.source_count * 3,
        ),
      );

      return {
        ...cluster,
        narrative_velocity: Number(velocity.toFixed(2)),
        threat_score: threat,
      };
    });

    return { clusters };
  });

export const getClusterDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({
      clusterId: z.string().uuid(),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const clusterResult = await supabase
      .from("narrative_clusters")
      .select("*")
      .eq("id", data.clusterId)
      .eq("user_id", userId)
      .maybeSingle();

    if (clusterResult.error) {
      throw new Error(clusterResult.error.message);
    }

    const cluster: any = clusterResult.data;
    if (!cluster) {
      return {
        cluster: null,
        findings: [],
        channelWatchFindings: [],
      };
    }

    const multimediaResult = await supabase
      .from("timestamp_findings")
      .select("*")
      .eq("cluster_id", data.clusterId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (multimediaResult.error) {
      throw new Error(multimediaResult.error.message);
    }

    const sources = Array.isArray(cluster.sources)
      ? cluster.sources.filter(
          (source: unknown): source is string =>
            typeof source === "string",
        )
      : [];

    let channelWatchFindings: any[] = [];

    if (sources.length > 0) {
      const channelResult = await supabase
        .from("channel_watch_videos")
        .select(
          "id,watch_id,video_id,title,description,url,published_at,detected_at,view_count,risk_score,classification,review_status,mention_match",
        )
        .eq("user_id", userId)
        .in("url", sources.slice(0, 100))
        .order("detected_at", { ascending: false });

      if (channelResult.error) {
        throw new Error(channelResult.error.message);
      }

      channelWatchFindings = (channelResult.data ?? []).map((finding: any) => {
        const mention =
          finding.mention_match &&
          typeof finding.mention_match === "object"
            ? finding.mention_match as Record<string, unknown>
            : {};

        const timestamps = Array.isArray(mention.timestamp_findings)
          ? mention.timestamp_findings
          : [];

        const hasTranscript =
          Boolean(mention.transcript) ||
          Boolean(mention.transcript_text) ||
          timestamps.length > 0;

        const hasSubjectMatch =
          Boolean(mention.matched) ||
          Boolean(mention.subject_matched) ||
          Boolean(mention.match_count) ||
          timestamps.length > 0;

        const riskScore = Math.max(
          0,
          Math.min(100, Number(finding.risk_score ?? 0)),
        );

        const evidenceStrength = Math.min(
          100,
          Math.round(
            riskScore * 0.45 +
            (hasSubjectMatch ? 20 : 0) +
            (hasTranscript ? 15 : 0) +
            (finding.url ? 10 : 0) +
            (finding.review_status === "confirmed" ? 10 : 0),
          ),
        );

        return {
          ...finding,
          evidence_strength: evidenceStrength,
          evidence_signals: {
            subject_match: hasSubjectMatch,
            transcript_or_timestamps: hasTranscript,
            source_url: Boolean(finding.url),
            human_confirmed: finding.review_status === "confirmed",
          },
        };
      });
    }

    return {
      cluster,
      findings: multimediaResult.data ?? [],
      channelWatchFindings,
    };
  });

const NarrativeReviewInput = z.object({
  videoId: z.string().uuid(),
  decision: z.enum([
    "confirmed",
    "not_relevant",
    "pending",
  ]),
});

export const reviewNarrativeFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => NarrativeReviewInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const result = await supabase
      .from("channel_watch_videos")
      .update({
        review_status: data.decision,
      } as any)
      .eq("id", data.videoId)
      .eq("user_id", userId)
      .select("id,review_status")
      .maybeSingle();

    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error("Channel Watch finding not found");

    return {
      ok: true,
      finding: result.data,
    };
  });

const NarrativeRemovalInput = z.object({
  videoId: z.string().uuid(),
  clusterId: z.string().uuid(),
});

export const createNarrativeRemovalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => NarrativeRemovalInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const videoResult = await supabase
      .from("channel_watch_videos")
      .select(
        "id,watch_id,video_id,title,description,url,published_at,detected_at,view_count,risk_score,classification,review_status,mention_match",
      )
      .eq("id", data.videoId)
      .eq("user_id", userId)
      .maybeSingle();

    if (videoResult.error) {
      throw new Error(videoResult.error.message);
    }

    const video: any = videoResult.data;
    if (!video) throw new Error("Channel Watch finding not found");

    if (video.review_status !== "confirmed") {
      throw new Error(
        "Human confirmation is required before creating a removal draft",
      );
    }

    const watchResult = await supabase
      .from("channel_watches")
      .select("id,channel_title,handle,channel_url,reason")
      .eq("id", video.watch_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (watchResult.error) {
      throw new Error(watchResult.error.message);
    }

    const watch: any = watchResult.data;
    const targetUrl =
      video.url ||
      `https://www.youtube.com/watch?v=${video.video_id}`;

    const existingResult = await supabase
      .from("enforcement_requests")
      .select("id,status")
      .eq("user_id", userId)
      .eq("target_url", targetUrl)
      .in("status", [
        "Draft",
        "Evidence Review",
        "Authorization Pending",
        "Ready for Approval",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }

    let requestId = existingResult.data?.id ?? null;

    if (!requestId) {
      const requestResult = await supabase
        .from("enforcement_requests")
        .insert({
          user_id: userId,
          scan_hit_id: null,
          platform: "YouTube",
          method: "Narrative Intelligence Review",
          target_url: targetUrl,
          status: "Draft",
          submission_status: "not_submitted",
          metadata: {
            created_from: "narrative_intelligence",
            narrative_cluster_id: data.clusterId,
            channel_watch_video_id: video.id,
            classification: video.classification,
            risk_score: video.risk_score,
            review_status: video.review_status,
            channel_title: watch?.channel_title ?? null,
            channel_handle: watch?.handle ?? null,
            protected_subject: watch?.reason ?? null,
            human_approval_required: true,
          },
        } as any)
        .select("id")
        .single();

      if (requestResult.error || !requestResult.data) {
        throw new Error(
          requestResult.error?.message ??
          "Unable to create Removal Center draft",
        );
      }

      requestId = requestResult.data.id;
    }

    const capturedAt = new Date().toISOString();
    const evidencePayload = {
      captured_at: capturedAt,
      narrative_cluster_id: data.clusterId,
      channel_watch_video_id: video.id,
      youtube_video_id: video.video_id,
      title: video.title,
      description: video.description,
      target_url: targetUrl,
      published_at: video.published_at,
      detected_at: video.detected_at,
      view_count: video.view_count,
      risk_score: video.risk_score,
      classification: video.classification,
      review_status: video.review_status,
      mention_match: video.mention_match,
      channel_title: watch?.channel_title ?? null,
      channel_handle: watch?.handle ?? null,
      channel_url: watch?.channel_url ?? null,
      protected_subject: watch?.reason ?? null,
    };

    const bytes = new TextEncoder().encode(
      JSON.stringify(evidencePayload),
    );

    const digest = await crypto.subtle.digest("SHA-256", bytes);

    const sha256 = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const evidenceResult = await supabase
      .from("enforcement_evidence")
      .insert({
        user_id: userId,
        enforcement_request_id: requestId,
        evidence_type: "channel_watch_narrative",
        reference: targetUrl,
        payload: {
          ...evidencePayload,
          sha256,
        },
      } as any);

    if (evidenceResult.error) {
      throw new Error(evidenceResult.error.message);
    }

    return {
      ok: true,
      enforcementRequestId: requestId,
      sha256,
      submissionStatus: "not_submitted",
    };
  });

