/**
 * Restore historical, monitored, and known-risk candidates for each scan.
 * Ensures previously discovered sources are rechecked even when fresh discovery misses them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { canonicalUrl, hostOf } from "./url.server";
import {
  buildSiteScopedDiscoveryQueries,
  domainRootsFromUrls,
  type CandidateUnionEntry,
} from "./candidate-union";
import { isActionablePiracy } from "./taxonomy";

type DB = SupabaseClient<Database>;

export interface HistoricalCandidateLoadResult {
  monitoredSourceCandidates: CandidateUnionEntry[];
  historicalFindingCandidates: CandidateUnionEntry[];
  knownRiskDomainCandidates: CandidateUnionEntry[];
  mirrorAndRedirectCandidates: CandidateUnionEntry[];
  siteScopedQueries: string[];
  domainsSearched: string[];
  preservedFindings: Array<{
    source_url: string;
    page_title: string | null;
    classification: string;
    prior_scan_id: string;
    recheck_status: "pending" | "active";
  }>;
}

function normalizeTitleNeedle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function titleMatchesWork(
  blob: string,
  workTitle: string,
  titles: string[],
): boolean {
  const lower = blob.toLowerCase();
  const needles = [workTitle, ...titles]
    .map(normalizeTitleNeedle)
    .filter((t) => t.length >= 3);
  return needles.some((t) => lower.includes(t));
}

function monitoredSourceMatchesWork(
  row: { page_title: string | null; tracked_titles: string[] },
  workTitle: string,
  titles: string[],
): boolean {
  const tracked = Array.isArray(row.tracked_titles) ? row.tracked_titles : [];
  if (titleMatchesWork(row.page_title ?? "", workTitle, titles)) return true;
  return tracked.some((t) => titleMatchesWork(t, workTitle, titles));
}

export async function loadHistoricalScanCandidates(
  supabase: DB,
  opts: {
    userId: string;
    scanId: string;
    workTitle: string;
    titles: string[];
  },
): Promise<HistoricalCandidateLoadResult> {
  const monitoredSourceCandidates: CandidateUnionEntry[] = [];
  const historicalFindingCandidates: CandidateUnionEntry[] = [];
  const knownRiskDomainCandidates: CandidateUnionEntry[] = [];
  const mirrorAndRedirectCandidates: CandidateUnionEntry[] = [];
  const preservedFindings: HistoricalCandidateLoadResult["preservedFindings"] = [];
  const domainSet = new Set<string>();

  const { data: sources } = await supabase
    .from("distribution_sources")
    .select(
      "id,url,domain,page_title,tracked_titles,status,monitor_enabled,evidence,parent_source_id",
    )
    .eq("user_id", opts.userId)
    .eq("status", "active")
    .eq("monitor_enabled", true)
    .order("last_seen_at", { ascending: false })
    .limit(80);

  for (const row of sources ?? []) {
    if (!monitoredSourceMatchesWork(row, opts.workTitle, opts.titles)) continue;

    const evidence = (row.evidence ?? {}) as Record<string, unknown>;
    const evidenceUrl =
      typeof evidence.exact_evidence_url === "string"
        ? evidence.exact_evidence_url
        : row.url;
    const url = canonicalUrl(evidenceUrl);
    domainSet.add(row.domain.toLowerCase());

    monitoredSourceCandidates.push({
      url,
      title: row.page_title,
      query: "monitored_source_recheck",
      text: row.page_title ?? row.domain,
      strong: true,
      origin: "monitored_source",
    });

    const parentId = row.parent_source_id;
    if (parentId) {
      const parent = (sources ?? []).find((s) => s.id === parentId);
      if (parent?.url && canonicalUrl(parent.url) !== url) {
        mirrorAndRedirectCandidates.push({
          url: canonicalUrl(parent.url),
          title: parent.page_title,
          query: "mirror_redirect",
          text: parent.page_title ?? parent.domain,
          strong: true,
          origin: "mirror_redirect",
        });
      }
    }

    const finalDomain =
      typeof evidence.final_domain === "string" ? evidence.final_domain : null;
    if (finalDomain && finalDomain.toLowerCase() !== row.domain.toLowerCase()) {
      try {
        const redirected = canonicalUrl(
          url.replace(row.domain, finalDomain),
        );
        mirrorAndRedirectCandidates.push({
          url: redirected,
          title: row.page_title,
          query: "mirror_redirect",
          text: row.page_title ?? finalDomain,
          strong: true,
          origin: "mirror_redirect",
        });
        domainSet.add(finalDomain.toLowerCase());
      } catch {
        // ignore bad redirect synthesis
      }
    }
  }

  const { data: priorScans } = await supabase
    .from("copyright_scans")
    .select("id,title")
    .eq("user_id", opts.userId)
    .neq("id", opts.scanId)
    .order("created_at", { ascending: false })
    .limit(20);

  const priorScanIds = (priorScans ?? [])
    .filter((s) => titleMatchesWork(s.title ?? "", opts.workTitle, opts.titles))
    .map((s) => s.id);

  if (priorScanIds.length) {
    const { data: priorMatches } = await supabase
      .from("copyright_matches")
      .select("scan_id,source_url,page_title,detection_type,evidence,confidence")
      .eq("user_id", opts.userId)
      .in("scan_id", priorScanIds)
      .order("confidence", { ascending: false })
      .limit(120);

    for (const match of priorMatches ?? []) {
      const ev = (match.evidence ?? {}) as Record<string, unknown>;
      const dist = (ev.distribution ?? {}) as Record<string, unknown>;
      const clientVisible = ev.client_visible !== false && dist.client_visible !== false;
      const classification =
        (dist.classification as string) ?? match.detection_type ?? "UNVERIFIED_LEAD";
      const actionable =
        clientVisible && isActionablePiracy(classification);
      const identityEvidence = Array.isArray(dist.identity_evidence)
        ? (dist.identity_evidence as string[])
        : Array.isArray(ev.identity_evidence)
          ? (ev.identity_evidence as string[])
          : [];

      if (!identityEvidence.length && !actionable) continue;

      const url = canonicalUrl(match.source_url);
      const host = hostOf(url);
      if (host) domainSet.add(host);

      historicalFindingCandidates.push({
        url,
        title: match.page_title,
        query: "historical_finding_recheck",
        text: match.page_title ?? url,
        strong: actionable,
        origin: "historical_finding",
      });

      if (actionable) {
        preservedFindings.push({
          source_url: url,
          page_title: match.page_title,
          classification,
          prior_scan_id: match.scan_id,
          recheck_status: "pending",
        });
      }
    }
  }

  for (const domain of domainSet) {
    knownRiskDomainCandidates.push({
      url: `https://${domain}/`,
      title: opts.workTitle,
      query: `known_risk_domain:${domain}`,
      text: opts.workTitle,
      strong: true,
      origin: "known_risk_domain",
    });
  }

  const siteScopedQueries = buildSiteScopedDiscoveryQueries(
    domainRootsFromUrls([
      ...monitoredSourceCandidates.map((c) => c.url),
      ...historicalFindingCandidates.map((c) => c.url),
      ...knownRiskDomainCandidates.map((c) => c.url),
      ...mirrorAndRedirectCandidates.map((c) => c.url),
    ]),
    opts.titles,
  );

  return {
    monitoredSourceCandidates,
    historicalFindingCandidates,
    knownRiskDomainCandidates,
    mirrorAndRedirectCandidates,
    siteScopedQueries,
    domainsSearched: [...domainSet],
    preservedFindings,
  };
}
