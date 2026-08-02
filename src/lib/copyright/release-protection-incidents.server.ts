/**
 * Release protection incident persistence from scan findings.
 * Public-source leads only — deduplicated per protection row + URL + type.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyWebLeakCandidate,
  classifyYoutubeLeakCandidate,
  daysUntilRelease,
  incidentDedupKey,
  isPrivateOrUnsafeMonitorUrl,
  shouldAlertForIncident,
  type AlertThreshold,
  type LeakRiskLevel,
} from "@/lib/copyright/release-protection";

export interface ReleaseProtectionScanFinding {
  url: string;
  sourceKind: "web" | "youtube";
  pageTitle?: string | null;
  pageText?: string | null;
  hasDownloadLink?: boolean;
  hasTorrentMagnet?: boolean;
  hasEmbeddedPlayer?: boolean;
  isNewsArticle?: boolean;
  isOfficialDomain?: boolean;
  clientVisible?: boolean;
  strongEvidence?: boolean;
  durationSeconds?: number | null;
  publishedAt?: string | null;
  description?: string | null;
  channelTitle?: string | null;
}

export async function upsertReleaseProtectionIncident(
  supabase: SupabaseClient,
  input: {
    protectionId: string;
    userId: string;
    incidentType: string;
    sourceUrl: string;
    sourceKind: "web" | "youtube";
    riskLevel: LeakRiskLevel;
    releaseTiming: "pre_release" | "post_release" | "release_day";
    evidence?: Record<string, unknown>;
    seenAt?: string;
  },
): Promise<{ created: boolean; id: string }> {
  if (isPrivateOrUnsafeMonitorUrl(input.sourceUrl)) {
    throw new Error("Refusing to store incident for private or unsafe URL.");
  }

  const seenAt = input.seenAt ?? new Date().toISOString();
  const { data: existing } = await supabase
    .from("release_protection_incidents")
    .select("id, recurrence_count, last_seen_at")
    .eq("release_protection_id", input.protectionId)
    .eq("source_url", input.sourceUrl)
    .eq("incident_type", input.incidentType)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("release_protection_incidents")
      .update({
        last_seen_at: seenAt,
        recurrence_count: (existing.recurrence_count as number) + 1,
        risk_level: input.riskLevel,
        evidence: (input.evidence ?? {}) as never,
      })
      .eq("id", existing.id);
    return { created: false, id: existing.id as string };
  }

  const { data, error } = await supabase
    .from("release_protection_incidents")
    .insert({
      release_protection_id: input.protectionId,
      user_id: input.userId,
      incident_type: input.incidentType,
      source_url: input.sourceUrl,
      source_kind: input.sourceKind,
      risk_level: input.riskLevel,
      release_timing: input.releaseTiming,
      first_seen_at: seenAt,
      last_seen_at: seenAt,
      evidence: (input.evidence ?? {}) as never,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not create incident.");
  return { created: true, id: data.id as string };
}

export function findingsFromDistributionMatches(
  rows: Array<{
    source_url: string;
    page_title?: string | null;
    platform?: string | null;
    evidence?: Record<string, unknown> | null;
  }>,
): ReleaseProtectionScanFinding[] {
  return rows.map((row) => {
    const ev = (row.evidence ?? {}) as Record<string, unknown>;
    const dist = (ev.distribution ?? {}) as Record<string, unknown>;
    const indicatorKeys = Array.isArray(dist.indicator_keys)
      ? (dist.indicator_keys as string[])
      : [];
    const classification = String(ev.classification ?? dist.classification ?? "");
    return {
      url: row.source_url,
      sourceKind:
        row.platform === "youtube" || /youtube\.com|youtu\.be/i.test(row.source_url)
          ? "youtube"
          : "web",
      pageTitle: row.page_title,
      pageText: String(ev.ocr_text ?? ""),
      hasDownloadLink: indicatorKeys.some((k) => /download/i.test(k)),
      hasTorrentMagnet: indicatorKeys.some((k) => /torrent|magnet/i.test(k)),
      hasEmbeddedPlayer: indicatorKeys.some((k) => /embed|player/i.test(k)),
      isNewsArticle: /NEWS|REVIEW/i.test(classification),
      isOfficialDomain: /OFFICIAL/i.test(classification),
      clientVisible: Boolean(ev.client_visible),
      strongEvidence: Boolean(dist.strong_evidence ?? ev.strong_evidence),
    };
  });
}

function releaseTimingLabel(releaseDateIso: string, nowMs = Date.now()): "pre_release" | "post_release" | "release_day" {
  const until = daysUntilRelease(releaseDateIso, nowMs);
  if (until > 0) return "pre_release";
  if (until === 0) return "release_day";
  return "post_release";
}

function classifyFinding(
  finding: ReleaseProtectionScanFinding,
  releaseDateIso: string,
): { risk: LeakRiskLevel; incidentType: string; labels: string[] } {
  if (finding.sourceKind === "youtube") {
    const yt = classifyYoutubeLeakCandidate({
      title: finding.pageTitle ?? "",
      description: finding.description ?? undefined,
      durationSeconds: finding.durationSeconds,
      publishedAt: finding.publishedAt,
      releaseDate: releaseDateIso,
      channelTitle: finding.channelTitle,
    });
    const incidentType =
      yt.classification === "suspected_full_film"
        ? "new_youtube_upload"
        : yt.classification === "suspected_leaked_footage"
          ? "pre_release_leak"
          : "new_youtube_video";
    return { risk: yt.risk, incidentType, labels: [yt.classification] };
  }

  const web = classifyWebLeakCandidate({
    pageTitle: finding.pageTitle ?? undefined,
    pageText: finding.pageText ?? undefined,
    hasDownloadLink: finding.hasDownloadLink,
    hasTorrentMagnet: finding.hasTorrentMagnet,
    hasEmbeddedPlayer: finding.hasEmbeddedPlayer,
    releaseDate: releaseDateIso,
    isNewsArticle: finding.isNewsArticle,
    isOfficialDomain: finding.isOfficialDomain,
  });
  const incidentType = web.labels.includes("torrent_magnet")
    ? "new_torrent_magnet"
    : web.labels.includes("download_link")
      ? "new_file_host_link"
      : "first_appearance";
  return { risk: web.risk, incidentType, labels: web.labels };
}

export async function syncReleaseProtectionIncidentsFromScan(
  supabase: SupabaseClient,
  input: {
    protectionId: string;
    userId: string;
    releaseDateIso: string;
    alertThreshold: AlertThreshold;
    findings: ReleaseProtectionScanFinding[];
  },
): Promise<{ incidentsCreated: number; preReleaseFindings: number; candidatesFound: number }> {
  let incidentsCreated = 0;
  let preReleaseFindings = 0;
  const timing = releaseTimingLabel(input.releaseDateIso);
  const candidatesFound = input.findings.length;

  for (const finding of input.findings) {
    if (!finding.url || isPrivateOrUnsafeMonitorUrl(finding.url)) continue;
    if (finding.isOfficialDomain) continue;
    if (finding.isNewsArticle) continue;

    const classified = classifyFinding(finding, input.releaseDateIso);
    if (classified.risk === "contextual" || classified.risk === "low") continue;
    if (!finding.clientVisible && !finding.strongEvidence && classified.risk === "medium") continue;

    const dedup = incidentDedupKey(finding.url, classified.incidentType);
    const result = await upsertReleaseProtectionIncident(supabase, {
      protectionId: input.protectionId,
      userId: input.userId,
      incidentType: classified.incidentType,
      sourceUrl: finding.url,
      sourceKind: finding.sourceKind,
      riskLevel: classified.risk,
      releaseTiming: timing,
      evidence: {
        dedup_key: dedup,
        labels: classified.labels,
        page_title: finding.pageTitle,
        alert_eligible: shouldAlertForIncident(classified.risk, input.alertThreshold),
        review_status: finding.strongEvidence ? "verified_access_evidence" : "review_required",
      },
    });
    if (result.created) incidentsCreated += 1;
    if (timing === "pre_release") preReleaseFindings += 1;
  }

  return { incidentsCreated, preReleaseFindings, candidatesFound };
}

export async function finalizeReleaseMonitorRun(
  supabase: SupabaseClient,
  input: {
    scanId: string;
    protectionId: string;
    status: "completed" | "partial" | "failed";
    providersAttempted: number;
    providersSucceeded: number;
    providersFailed: number;
    candidatesFound: number;
    incidentsCreated: number;
    preReleaseFindings: number;
    errorSummary?: string | null;
  },
): Promise<void> {
  const completedAt = new Date().toISOString();
  await supabase
    .from("release_monitor_runs")
    .update({
      status: input.status === "failed" ? "failed" : "completed",
      completed_at: completedAt,
      providers_attempted: input.providersAttempted,
      providers_succeeded: input.providersSucceeded,
      providers_failed: input.providersFailed,
      candidates_found: input.candidatesFound,
      incidents_created: input.incidentsCreated,
      pre_release_findings: input.preReleaseFindings,
      error_summary: input.errorSummary ?? null,
    })
    .eq("scan_id", input.scanId)
    .eq("release_protection_id", input.protectionId);
}
