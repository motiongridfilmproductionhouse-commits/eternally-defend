/**
 * Merge discovery results from independent providers without domain collapse.
 * Deduplicates by canonical URL; allows multiple pages per hostname up to cap.
 */

import { canonicalUrl, hostOf } from "./url.server";
import type { PageLead } from "./discover.server";
import { MAX_DISCOVERY_CANDIDATES, MAX_PAGES_PER_DOMAIN } from "./discovery-config";

export interface ProviderPageLead extends PageLead {
  source_provider: string;
}

export interface MergeProviderLeadsResult {
  leads: ProviderPageLead[];
  raw_results_received: number;
  unique_candidate_urls: number;
  unique_candidate_domains: number;
  duplicates_dropped: number;
  domain_cap_skipped: number;
  by_provider: Record<string, number>;
}

export function mergeProviderPageLeads(
  groups: Array<{ provider: string; leads: PageLead[] }>,
  options?: { maxCandidates?: number; maxPerDomain?: number },
): MergeProviderLeadsResult {
  const maxCandidates = options?.maxCandidates ?? MAX_DISCOVERY_CANDIDATES;
  const maxPerDomain = options?.maxPerDomain ?? MAX_PAGES_PER_DOMAIN;

  let raw = 0;
  let duplicatesDropped = 0;
  let domainCapSkipped = 0;
  const byUrl = new Map<string, ProviderPageLead>();
  const perDomain = new Map<string, number>();
  const by_provider: Record<string, number> = {};

  for (const group of groups) {
    for (const lead of group.leads) {
      raw += 1;
      let key: string;
      try {
        key = canonicalUrl(lead.url);
      } catch {
        continue;
      }
      const host = (hostOf(key) ?? "").toLowerCase();
      const domainCount = perDomain.get(host) ?? 0;

      if (byUrl.has(key)) {
        duplicatesDropped += 1;
        continue;
      }
      if (domainCount >= maxPerDomain) {
        domainCapSkipped += 1;
        continue;
      }
      if (byUrl.size >= maxCandidates) {
        domainCapSkipped += 1;
        continue;
      }

      const row: ProviderPageLead = {
        ...lead,
        url: key,
        source_provider: group.provider,
      };
      byUrl.set(key, row);
      perDomain.set(host, domainCount + 1);
      by_provider[group.provider] = (by_provider[group.provider] ?? 0) + 1;
    }
  }

  const leads = [...byUrl.values()];
  const domains = new Set(
    leads.map((l) => hostOf(l.url)).filter((h): h is string => Boolean(h)),
  );

  return {
    leads,
    raw_results_received: raw,
    unique_candidate_urls: leads.length,
    unique_candidate_domains: domains.size,
    duplicates_dropped: duplicatesDropped,
    domain_cap_skipped: domainCapSkipped,
    by_provider,
  };
}
