/**
 * Second-stage discovery query expansion when unique candidates fall below TARGET
 * at 60% of the scan deadline. Never weakens evidence thresholds.
 */

import { expandTitleVariants, queryTitleVariants } from "./title-identity";
import {
  DISCOVERY_MIRROR_DOMAINS,
  DISCOVERY_TARGET_DOMAINS,
  DISCOVERY_TORRENT_INDEX_DOMAINS,
  siteQueryForDomain,
} from "./discovery-target-domains";
import type { ReferenceAnalysis } from "./discover.server";
import { TARGET_DISCOVERY_CANDIDATES } from "./discovery-config";

export interface FallbackQueryInput {
  analysis: ReferenceAnalysis;
  workTitle: string;
  uniqueCandidateUrls: number;
  discoveredHosts: string[];
  discoveredFilenames: string[];
  ripTermsSeen: string[];
}

const RIP_TERMS = [
  "HDRip",
  "WEBRip",
  "WEB-DL",
  "DVDRip",
  "CAMRip",
  "HDTS",
  "1080p",
  "720p",
  "mkv",
  "mp4",
];

/**
 * Build extra queries when discovery is below TARGET_DISCOVERY_CANDIDATES.
 * Returns empty when the target is already met.
 */
export function buildSecondStageDiscoveryQueries(input: FallbackQueryInput): string[] {
  if (input.uniqueCandidateUrls >= TARGET_DISCOVERY_CANDIDATES) return [];

  const primary = (input.analysis.title || input.workTitle).trim();
  if (!primary) return [];

  const names = queryTitleVariants(primary, [
    input.workTitle,
    input.analysis.title ?? "",
    ...input.analysis.altTitles,
  ]).slice(0, 6);
  const base = names[0] ?? primary;
  const year = input.analysis.releaseDate?.slice(0, 4) ?? null;
  const titleNoYear = base.replace(/\s*\(?\d{4}\)?\s*$/g, "").trim();
  const titleNoPunct = base.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const titleHyphen = titleNoPunct.replace(/\s+/g, "-");

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const t = q.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  // Title shape variants
  push(`"${titleNoYear}" full movie`);
  push(`"${titleNoPunct}" watch online`);
  push(`"${titleHyphen}" download`);
  if (input.analysis.language) {
    push(`"${base}" ${input.analysis.language} full movie download`);
  }

  for (const v of expandTitleVariants(base).slice(0, 4)) {
    push(`"${v}" watch online free`);
    push(`"${v}" download`);
  }

  // Rip terms from first-pass results + defaults
  const rips = [...new Set([...input.ripTermsSeen, ...RIP_TERMS])].slice(0, 12);
  for (const rip of rips) {
    push(`"${base}" ${rip}`);
    if (year) push(`"${base}" ${year} ${rip}`);
  }

  // Filenames discovered in snippets
  for (const fn of input.discoveredFilenames.slice(0, 8)) {
    push(`"${fn}"`);
    push(`"${base}" ${fn}`);
  }

  // Hosts seen in first pass + registry expansion
  const hosts = [
    ...new Set([
      ...input.discoveredHosts,
      ...DISCOVERY_TARGET_DOMAINS,
      ...DISCOVERY_MIRROR_DOMAINS.slice(0, 6),
      ...DISCOVERY_TORRENT_INDEX_DOMAINS.slice(0, 3),
    ]),
  ].slice(0, 24);

  for (const host of hosts) {
    push(siteQueryForDomain(host, base));
    if (year) push(`site:${host} "${base}" ${year}`);
  }

  for (const actor of input.analysis.actors.slice(0, 2)) {
    push(`"${base}" ${actor} full movie download`);
  }
  if (input.analysis.productionCompany) {
    push(`"${base}" ${input.analysis.productionCompany} leaked`);
  }

  return out.slice(0, 36);
}
