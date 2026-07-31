/**
 * Unauthorized Distribution Monitor.
 *
 * Reuses the EXISTING crawler pipeline (Firecrawl transport via
 * `analyzeDistributionPage`) — no new crawling framework. Responsibilities:
 *
 *  1. Register every distribution source found by a copyright scan
 *     (website, mirror domain, Telegram channel, Discord server, Reddit
 *     community, forum, public file-sharing source) into
 *     `distribution_sources`.
 *  2. Re-crawl registered sources on a schedule, detect new movie uploads,
 *     new mirrors, redirects and domain changes, and write incidents plus a
 *     monitoring-run history row.
 *
 * Evidence collection only — nothing here reports or takes down content.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { hostOf, canonicalUrl } from "./url.server";
import {
  analyzeDistributionPage,
  type DistributionAnalysis,
} from "./distribution.server";

type DB = SupabaseClient<Database>;
type SourceRow = Database["public"]["Tables"]["distribution_sources"]["Row"];

export type SourceKind =
  | "website"
  | "mirror_domain"
  | "telegram_channel"
  | "discord_server"
  | "reddit_community"
  | "forum"
  | "file_sharing"
  | "torrent_index"
  | "video_platform";

const FILE_SHARE_HOSTS = [
  "mega.nz", "mega.co.nz", "mediafire.com", "gofile.io", "pixeldrain.com", "krakenfiles.com",
  "1fichier.com", "anonfiles.com", "workupload.com", "send.cm", "dropbox.com", "drive.google.com",
];

/** Classify a discovered source by URL + inspected content type. */
export function sourceKindFor(url: string, contentType?: string | null): SourceKind {
  const host = (hostOf(url) ?? "").toLowerCase();
  const u = url.toLowerCase();
  if (host.endsWith("t.me") || host.endsWith("telegram.me") || host.endsWith("telegram.org")) return "telegram_channel";
  if (host.endsWith("discord.gg") || host.includes("discord.com")) return "discord_server";
  if (host.endsWith("reddit.com") || host.endsWith("redd.it")) return "reddit_community";
  if (FILE_SHARE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "file_sharing";
  if (contentType === "torrent_index_site") return "torrent_index";
  if (contentType === "reupload_platform") return "video_platform";
  if (/(forum|board|community|thread|viewtopic|showthread)/.test(u)) return "forum";
  if (contentType === "file_distribution_site") return "file_sharing";
  return "website";
}

function intervalFor(risk: string): number {
  if (risk === "high") return 360;
  if (risk === "medium") return 720;
  return 1440;
}

function riskScoreFor(a: DistributionAnalysis): number {
  const base = a.domainRisk === "high" ? 70 : a.domainRisk === "medium" ? 45 : 20;
  return Math.max(0, Math.min(100, Math.round((base + a.confidence) / 2)));
}

function linkDomains(links: string[]): string[] {
  return [...new Set(links.map((l) => hostOf(l)).filter((h): h is string => !!h))];
}

/**
 * Upsert a discovered distribution source and register it in the Auto Monitor.
 * Returns the stored source row, or null when the analysis is not strong enough.
 */
export async function registerDistributionSource(
  supabase: DB,
  opts: {
    userId: string;
    scanId?: string | null;
    workTitle?: string | null;
    platform?: string | null;
    analysis: DistributionAnalysis;
  },
): Promise<SourceRow | null> {
  const a = opts.analysis;
  const domain = a.domain ?? hostOf(a.url);
  if (!domain) return null;

  const kind = sourceKindFor(a.url, a.contentType);
  const nowIso = new Date().toISOString();

  const { data: existing } = await supabase
    .from("distribution_sources")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("domain", domain)
    .maybeSingle();

  const titles = new Set<string>([
    ...((existing?.tracked_titles as string[] | null) ?? []),
    ...(opts.workTitle ? [opts.workTitle] : []),
  ]);

  const evidence = {
    indicators: a.indicators,
    distribution_links: a.distributionLinks,
    quality_tags: a.qualityTags,
    link_domains: linkDomains(a.distributionLinks),
    release_timing: a.releaseTiming,
    release_offset_days: a.releaseOffsetDays,
    reason: a.reason,
    last_page_title: a.pageTitle,
  };

  const payload = {
    user_id: opts.userId,
    domain,
    url: canonicalUrl(a.url),
    source_kind: kind,
    content_type: a.contentType,
    platform: opts.platform ?? null,
    page_title: a.pageTitle,
    risk_level: a.domainRisk,
    risk_score: riskScoreFor(a),
    confidence: a.confidence,
    indicators: a.indicatorKeys as unknown as Database["public"]["Tables"]["distribution_sources"]["Insert"]["indicators"],
    evidence: evidence as unknown as Database["public"]["Tables"]["distribution_sources"]["Insert"]["evidence"],
    screenshot_url: a.screenshot ?? existing?.screenshot_url ?? null,
    tracked_titles: [...titles],
    discovered_scan_id: existing?.discovered_scan_id ?? opts.scanId ?? null,
    monitor_enabled: existing?.monitor_enabled ?? true,
    monitor_interval_minutes: intervalFor(a.domainRisk),
    status: "active",
    last_seen_at: nowIso,
    next_check_at: new Date(Date.now() + intervalFor(a.domainRisk) * 60_000).toISOString(),
  };

  const { data: saved, error } = await supabase
    .from("distribution_sources")
    .upsert(payload, { onConflict: "user_id,domain" })
    .select("*")
    .single();

  if (error || !saved) return null;

  if (!existing) {
    await createIncident(supabase, {
      userId: opts.userId,
      sourceId: saved.id,
      scanId: opts.scanId ?? null,
      workTitle: opts.workTitle ?? null,
      incidentType: "new_source_discovered",
      severity: a.domainRisk,
      confidence: a.confidence,
      url: a.url,
      summary: `New unauthorized distribution source discovered (${kind.replace(/_/g, " ")}): ${domain}.`,
      evidence: { indicators: a.indicatorKeys, reason: a.reason, screenshot: a.screenshot },
    });
  }

  return saved;
}

async function createIncident(
  supabase: DB,
  opts: {
    userId: string;
    sourceId: string;
    scanId?: string | null;
    workTitle?: string | null;
    incidentType: string;
    severity: string;
    confidence: number;
    url?: string | null;
    summary: string;
    evidence?: unknown;
  },
) {
  await supabase.from("distribution_incidents").insert({
    user_id: opts.userId,
    source_id: opts.sourceId,
    scan_id: opts.scanId ?? null,
    work_title: opts.workTitle ?? null,
    incident_type: opts.incidentType,
    severity: opts.severity,
    confidence: opts.confidence,
    url: opts.url ?? null,
    summary: opts.summary,
    evidence: (opts.evidence ?? {}) as Database["public"]["Tables"]["distribution_incidents"]["Insert"]["evidence"],
  });
  
  const { data: src } = await supabase
    .from("distribution_sources")
    .select("incident_count")
    .eq("id", opts.sourceId)
    .maybeSingle();
  await supabase
    .from("distribution_sources")
    .update({ incident_count: (src?.incident_count ?? 0) + 1 })
    .eq("id", opts.sourceId);
}

/**
 * Re-crawl a single registered source with the existing crawler and record
 * incidents for new uploads, mirrors, redirects and domain changes.
 */
export async function monitorOneSource(
  supabase: DB,
  source: SourceRow,
  runType: "auto_monitor" | "scan" | "manual" = "auto_monitor",
): Promise<{ reachable: boolean; incidents: number; changes: string[] }> {
  const startedAt = new Date().toISOString();
  const titles = (source.tracked_titles as string[] | null) ?? [];
  const prev = (source.evidence ?? {}) as Record<string, unknown>;
  const prevLinks = new Set(((prev.distribution_links as string[] | undefined) ?? []).map(canonicalUrl));
  const prevDomains = new Set((prev.link_domains as string[] | undefined) ?? []);

  const analysis = await analyzeDistributionPage({
    url: source.url,
    title: source.page_title,
    titles: titles.length ? titles : [source.domain],
  }).catch(() => null);

  const changes: string[] = [];
  let incidents = 0;

  if (!analysis) {
    await supabase
      .from("distribution_sources")
      .update({
        last_checked_at: new Date().toISOString(),
        check_count: source.check_count + 1,
        status: "unreachable",
        next_check_at: new Date(Date.now() + source.monitor_interval_minutes * 60_000).toISOString(),
      })
      .eq("id", source.id);
    await supabase.from("distribution_monitor_runs").insert({
      user_id: source.user_id,
      source_id: source.id,
      run_type: runType,
      status: "completed",
      reachable: false,
      risk_level: source.risk_level,
      changes: ["unreachable"] as unknown as Database["public"]["Tables"]["distribution_monitor_runs"]["Insert"]["changes"],
      notes: "Source did not respond to the crawler.",
      finished_at: new Date().toISOString(),
      started_at: startedAt,
    });
    return { reachable: false, incidents: 0, changes: ["unreachable"] };
  }

  const newLinks = analysis.distributionLinks.filter((l) => !prevLinks.has(canonicalUrl(l)));
  const domains = linkDomains(analysis.distributionLinks);
  const newDomains = domains.filter((d) => !prevDomains.has(d));
  const finalDomain = analysis.domain ?? source.domain;
  const domainChanged = finalDomain !== source.domain;

  const emit = async (type: string, summary: string, severity: string, evidence: unknown) => {
    await createIncident(supabase, {
      userId: source.user_id,
      sourceId: source.id,
      workTitle: titles[0] ?? null,
      incidentType: type,
      severity,
      confidence: analysis.confidence,
      url: analysis.url,
      summary,
      evidence,
    });
    incidents++;
    changes.push(type);
  };

  if (newLinks.length) {
    await emit(
      "new_upload",
      `${newLinks.length} new distribution link(s) detected on ${source.domain}.`,
      analysis.domainRisk,
      { new_links: newLinks.slice(0, 20), quality_tags: analysis.qualityTags, screenshot: analysis.screenshot },
    );
  }
  if (newDomains.length) {
    await emit(
      "mirror_detected",
      `New mirror/host domain(s) linked from ${source.domain}: ${newDomains.slice(0, 5).join(", ")}.`,
      analysis.domainRisk,
      { new_domains: newDomains.slice(0, 20) },
    );
  }
  if (domainChanged) {
    await emit(
      "domain_change",
      `Source resolved to a different domain (${source.domain} → ${finalDomain}) — possible redirect or domain hop.`,
      "high",
      { previous_domain: source.domain, new_domain: finalDomain },
    );
  }
  if (!changes.length && analysis.strongEvidence) {
    changes.push("still_active");
  }

  const evidence = {
    indicators: analysis.indicators,
    distribution_links: analysis.distributionLinks,
    quality_tags: analysis.qualityTags,
    link_domains: domains,
    release_timing: analysis.releaseTiming,
    release_offset_days: analysis.releaseOffsetDays,
    reason: analysis.reason,
    last_page_title: analysis.pageTitle,
  };

  await supabase
    .from("distribution_sources")
    .update({
      status: analysis.strongEvidence ? "active" : "inactive",
      content_type: analysis.contentType,
      risk_level: analysis.domainRisk,
      risk_score: riskScoreFor(analysis),
      confidence: analysis.confidence,
      indicators: analysis.indicatorKeys as unknown as Database["public"]["Tables"]["distribution_sources"]["Update"]["indicators"],
      evidence: evidence as unknown as Database["public"]["Tables"]["distribution_sources"]["Update"]["evidence"],
      screenshot_url: analysis.screenshot ?? source.screenshot_url,
      page_title: analysis.pageTitle ?? source.page_title,
      last_seen_at: analysis.strongEvidence ? new Date().toISOString() : source.last_seen_at,
      last_checked_at: new Date().toISOString(),
      check_count: source.check_count + 1,
      monitor_interval_minutes: intervalFor(analysis.domainRisk),
      next_check_at: new Date(Date.now() + intervalFor(analysis.domainRisk) * 60_000).toISOString(),
    })
    .eq("id", source.id);

  await supabase.from("distribution_monitor_runs").insert({
    user_id: source.user_id,
    source_id: source.id,
    run_type: runType,
    status: "completed",
    reachable: true,
    confidence: analysis.confidence,
    risk_level: analysis.domainRisk,
    changes: changes as unknown as Database["public"]["Tables"]["distribution_monitor_runs"]["Insert"]["changes"],
    incidents_created: incidents,
    notes: analysis.reason.slice(0, 400),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  });

  return { reachable: true, incidents, changes };
}

/**
 * Sweep registered sources that are due for a re-check. Used by the scheduled
 * worker and by the "check all known sources" pass of every movie scan.
 */
export async function runAutoMonitor(
  supabase: DB,
  opts: { userId?: string; limit?: number; force?: boolean; sourceIds?: string[]; runType?: "auto_monitor" | "scan" | "manual" },
): Promise<{ checked: number; incidents: number }> {
  let q = supabase
    .from("distribution_sources")
    .select("*")
    .eq("monitor_enabled", true)
    .order("next_check_at", { ascending: true })
    .limit(opts.limit ?? 10);

  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.sourceIds?.length) q = q.in("id", opts.sourceIds);
  else if (!opts.force) q = q.lte("next_check_at", new Date().toISOString());

  const { data: due } = await q;
  let incidents = 0;
  let checked = 0;

  for (const source of due ?? []) {
    try {
      const res = await monitorOneSource(supabase, source as SourceRow, opts.runType ?? "auto_monitor");
      incidents += res.incidents;
      checked++;
    } catch {
      // keep sweeping; a single unreachable source must not abort the run
    }
  }
  return { checked, incidents };
}
