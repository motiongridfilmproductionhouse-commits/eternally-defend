/**
 * Candidate union + deduplication diagnostics for Copyright Intelligence scans.
 */

import { canonicalUrl, hostOf } from "./url.server";
import type { PageLead } from "./discover.server";

export interface CandidateUnionEntry extends PageLead {
  origin:
    | "fresh_discovery"
    | "monitored_source"
    | "historical_finding"
    | "known_risk_domain"
    | "mirror_redirect"
    | "known_url"
    | "site_scoped_search";
}

export interface CandidateDedupRecord {
  url: string;
  canonical_key: string;
  reason: "duplicate_canonical" | "duplicate_url";
  kept_origin: string;
  dropped_origin: string;
}

export interface CandidateUnionResult {
  leads: CandidateUnionEntry[];
  before_dedup: number;
  after_dedup: number;
  removed: CandidateDedupRecord[];
  by_origin: Record<string, number>;
}

function originRank(origin: CandidateUnionEntry["origin"]): number {
  switch (origin) {
    case "known_url":
      return 100;
    case "historical_finding":
      return 90;
    case "monitored_source":
      return 85;
    case "mirror_redirect":
      return 80;
    case "known_risk_domain":
      return 75;
    case "site_scoped_search":
      return 70;
    case "fresh_discovery":
      return 50;
    default:
      return 40;
  }
}

export function mergeScanCandidateLeads(
  groups: CandidateUnionEntry[][],
): CandidateUnionResult {
  const flat = groups.flat();
  const before = flat.length;
  const byKey = new Map<string, CandidateUnionEntry>();
  const removed: CandidateDedupRecord[] = [];

  for (const lead of flat) {
    const key = canonicalUrl(lead.url);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...lead, url: key });
      continue;
    }
    const keepCurrent =
      originRank(lead.origin) > originRank(existing.origin) ||
      (lead.strong && !existing.strong);
    if (keepCurrent) {
      removed.push({
        url: key,
        canonical_key: key,
        reason: "duplicate_canonical",
        kept_origin: lead.origin,
        dropped_origin: existing.origin,
      });
      byKey.set(key, { ...lead, url: key });
    } else {
      removed.push({
        url: key,
        canonical_key: key,
        reason: "duplicate_canonical",
        kept_origin: existing.origin,
        dropped_origin: lead.origin,
      });
    }
  }

  const leads = [...byKey.values()];
  const by_origin: Record<string, number> = {};
  for (const lead of leads) {
    by_origin[lead.origin] = (by_origin[lead.origin] ?? 0) + 1;
  }

  return {
    leads,
    before_dedup: before,
    after_dedup: leads.length,
    removed,
    by_origin,
  };
}

export function buildSiteScopedDiscoveryQueries(
  domains: string[],
  titles: string[],
): string[] {
  const queries: string[] = [];
  const primary = titles.find((t) => t.trim().length >= 3)?.trim();
  if (!primary) return queries;

  const suffixes = [
    "",
    " watch",
    " download",
    " full movie",
    " stream",
    " CAM",
    " HDRip",
    " WEBRip",
  ];

  for (const domain of [...new Set(domains)].slice(0, 12)) {
    const d = domain.toLowerCase().replace(/^www\./, "");
    if (!d || d.length < 4) continue;
    for (const suffix of suffixes) {
      queries.push(`site:${d} "${primary}"${suffix}`);
      if (queries.length >= 48) return queries;
    }
  }
  return queries;
}

export function domainRootsFromUrls(urls: string[]): string[] {
  return [...new Set(urls.map((u) => hostOf(u)).filter((h): h is string => Boolean(h)))];
}
