/**
 * Pre-Enrollment Intelligence — query plan (pure).
 *
 * Builds the exact query strings each source family issues for one locked
 * identity. Every query is stored on the scan (query_terms) and on each
 * provider observation, so a scan can be reproduced from its records.
 *
 * Query purposes:
 *  - identity_primary : the plain quoted name. Its result ranks are the only
 *                       ranks the Search Reputation stage uses ("what someone
 *                       sees when they search the name").
 *  - identity_context : name + staff-supplied context (profession, organisation,
 *                       known works, aliases) to find the right person.
 *  - risk_probe       : name + neutral risk vocabulary, to surface potentially
 *                       harmful coverage. Never used for search-rank statistics.
 */

import type { SourceFamilyKey } from "./source-registry";

export type QueryPurpose = "identity_primary" | "identity_context" | "risk_probe";

export interface PlannedQuery {
  query: string;
  purpose: QueryPurpose;
}

export interface QueryPlanTarget {
  name: string;
  aliases?: string[];
  profession?: string | null;
  organization?: string | null;
  countryRegion?: string | null;
  knownWorks?: string[];
}

const RISK_PROBES = [
  "controversy OR allegation OR complaint",
  "fake account OR impersonation OR scam",
  "leaked OR morphed OR deepfake",
];

function quoted(value: string): string {
  const clean = value.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  return clean ? `"${clean}"` : "";
}

function uniq(list: PlannedQuery[]): PlannedQuery[] {
  const seen = new Set<string>();
  const out: PlannedQuery[] = [];
  for (const q of list) {
    const key = q.query.toLowerCase();
    if (!q.query || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

/** Queries for general web-search families (Google, Web). */
export function webQueries(target: QueryPlanTarget): PlannedQuery[] {
  const name = quoted(target.name);
  if (!name) return [];
  const context: PlannedQuery[] = [];
  if (target.profession)
    context.push({ query: `${name} ${target.profession}`, purpose: "identity_context" });
  if (target.organization)
    context.push({ query: `${name} ${quoted(target.organization)}`, purpose: "identity_context" });
  for (const work of (target.knownWorks ?? []).slice(0, 1)) {
    context.push({ query: `${name} ${quoted(work)}`, purpose: "identity_context" });
  }
  for (const alias of (target.aliases ?? []).slice(0, 1)) {
    context.push({ query: quoted(alias), purpose: "identity_context" });
  }
  return uniq([
    { query: name, purpose: "identity_primary" },
    ...context.slice(0, 2),
    ...RISK_PROBES.map((probe) => ({ query: `${name} ${probe}`, purpose: "risk_probe" as const })),
  ]);
}

export function planQueries(family: SourceFamilyKey, target: QueryPlanTarget): PlannedQuery[] {
  const name = quoted(target.name);
  if (!name) return [];
  switch (family) {
    case "google_search":
    case "web_general":
      return webQueries(target);
    case "news":
      return uniq([
        { query: `${name} news`, purpose: "identity_context" },
        { query: `${name} ${RISK_PROBES[0]} news`, purpose: "risk_probe" },
      ]);
    case "images":
      return [{ query: target.name.trim(), purpose: "identity_context" }];
    case "youtube":
    case "fact_check":
    case "encyclopaedic":
      return [{ query: target.name.trim(), purpose: "identity_context" }];
    default:
      return [];
  }
}

/** Every query string the scan intends to issue, for prospect_scans.query_terms. */
export function allPlannedQueryTerms(
  families: SourceFamilyKey[],
  target: QueryPlanTarget,
): string[] {
  const out = new Set<string>();
  for (const family of families) for (const q of planQueries(family, target)) out.add(q.query);
  return Array.from(out);
}
