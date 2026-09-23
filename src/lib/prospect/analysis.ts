/**
 * Pre-Enrollment Intelligence — analysis over STORED rows (pure, client-safe).
 *
 * Everything the staff screens print — category totals, live counters, search
 * reputation percentages, propagation clusters — is computed here from the rows
 * the runner persisted. Nothing is estimated, seeded or predetermined: an empty
 * table yields zeros and the UI renders an honest empty state.
 */

import { contentItemKey } from "./fingerprint";
import type { IdentityBucket } from "./identity-resolution";
import type { FindingState, RiskFindingInput } from "./risk-model";
import { computeCoverage, type CoverageReport, type SourceRow } from "./coverage";

/* ── Row shapes (subset of the prospect_* tables) ─────────────────────────── */

export interface DiscoveryRow {
  id: string;
  family_key: string;
  platform: string | null;
  discovery_method: string;
  original_url: string;
  canonical_url: string;
  content_fingerprint: string;
  title: string | null;
  snippet: string | null;
  published_at: string | null;
  retrieved_at: string;
  identity_bucket: IdentityBucket;
  identity_confidence: number;
  identity_explanation: string | null;
  thumbnail_url?: string | null;
  media_kind?: string | null;
  extraction_status?: string | null;
}

export interface FindingRow {
  id: string;
  discovery_id: string;
  stage_key: string;
  category: string;
  severity: string | null;
  detection_reason: string;
  confidence: number | null;
  state: FindingState;
  verified_by?: string | null;
}

export interface ObservationRow {
  discovery_id: string;
  provider: string;
  family_key: string;
  query_used: string | null;
  query_purpose?: string | null;
  result_rank: number | null;
}

export interface CapabilityRow {
  analysis_key: string;
  status: "ran" | "unavailable";
  reason: string | null;
  candidates_considered: number;
}

/* ── Source authority (documented, deterministic) ─────────────────────────── */

const AUTHORITY_RULES: Array<{ re: RegExp; score: number; label: string }> = [
  { re: /\.gov(\.[a-z]{2})?$|\.nic\.in$/, score: 9, label: "government" },
  { re: /(^|\.)wikipedia\.org$/, score: 8, label: "encyclopaedia" },
  {
    re: /(^|\.)(bbc\.co\.uk|reuters\.com|apnews\.com|nytimes\.com|theguardian\.com|thehindu\.com|indianexpress\.com|hindustantimes\.com|timesofindia\.indiatimes\.com|ndtv\.com|manoramaonline\.com|mathrubhumi\.com|cnn\.com|forbes\.com|variety\.com|hollywoodreporter\.com)$/,
    score: 7,
    label: "major publisher",
  },
  {
    re: /(^|\.)(youtube\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com)$/,
    score: 5,
    label: "major platform",
  },
];

export function sourceAuthority(url: string): number {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return 0;
  }
  for (const rule of AUTHORITY_RULES) if (rule.re.test(host)) return rule.score;
  return 3;
}

export function severityNumber(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
}

/** High-priority = severity ≥ 7 (documented threshold, used by counters and summary). */
export const HIGH_PRIORITY_SEVERITY = 7;

/* ── Search rank (from observations of the plain-name query only) ─────────── */

export function bestSearchRanks(observations: ObservationRow[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const o of observations) {
    if (o.query_purpose !== "identity_primary") continue;
    if (typeof o.result_rank !== "number" || o.result_rank <= 0) continue;
    const prev = ranks.get(o.discovery_id);
    if (prev === undefined || o.result_rank < prev) ranks.set(o.discovery_id, o.result_rank);
  }
  return ranks;
}

/* ── Propagation clustering ───────────────────────────────────────────────── */

export interface ClusterLink {
  discoveryId: string;
  reasons: string[];
}

export interface PropagationCluster {
  key: string;
  memberIds: string[];
  earliestId: string;
  earliestBasis: "published_at" | "retrieved_at";
  links: ClusterLink[];
}

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "in",
  "on",
  "to",
  "for",
  "with",
  "is",
  "at",
  "by",
  "from",
  "video",
  "news",
  "official",
  "watch",
  "full",
  "new",
  "latest",
  "|",
  "-",
]);

export function titleTokens(title: string | null | undefined): string[] {
  return (
    String(title ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      // Malayalam range kept so native-script titles still cluster.
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[^a-z0-9\u0D00-\u0D7F ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
  );
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function youtubeId(url: string): string | null {
  const m = url.match(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{6,})/);
  return m ? m[1]! : null;
}

/**
 * Cluster related content using only stored evidence:
 *  - identical retrieved-content fingerprint at different URLs
 *  - near-identical titles (token Jaccard ≥ 0.8, ≥ 5 meaningful tokens)
 *  - the same YouTube video id referenced from different pages
 * The earliest member is "earliest discovered" — never "original" — because
 * origin cannot be established from public search results alone.
 */
export function clusterPropagation(rows: DiscoveryRow[]): PropagationCluster[] {
  const eligible = rows.filter((r) => r.identity_bucket !== "UNRELATED");
  const parent = new Map<string, string>();
  const reasons = new Map<string, Set<string>>();
  const find = (id: string): string => {
    let p = parent.get(id) ?? id;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(id, p);
    return p;
  };
  const union = (a: string, b: string, why: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
    for (const id of [a, b]) {
      if (!reasons.has(id)) reasons.set(id, new Set());
      reasons.get(id)!.add(why);
    }
  };

  const byFingerprint = new Map<string, string>();
  const byYoutube = new Map<string, string>();
  const tokens = eligible.map((r) => ({ id: r.id, t: titleTokens(r.title) }));

  for (const r of eligible) {
    if (r.content_fingerprint) {
      const first = byFingerprint.get(r.content_fingerprint);
      if (first) union(first, r.id, "identical retrieved content");
      else byFingerprint.set(r.content_fingerprint, r.id);
    }
    const yt = youtubeId(r.canonical_url) ?? youtubeId(r.snippet ?? "");
    if (yt) {
      const first = byYoutube.get(yt);
      if (first && first !== r.id) union(first, r.id, "same YouTube video referenced");
      else byYoutube.set(yt, r.id);
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const a = tokens[i]!;
      const b = tokens[j]!;
      if (a.t.length < 5 || b.t.length < 5) continue;
      if (jaccard(a.t, b.t) >= 0.8) union(a.id, b.id, "near-identical title");
    }
  }

  const groups = new Map<string, DiscoveryRow[]>();
  for (const r of eligible) {
    if (!parent.has(r.id) && !reasons.has(r.id)) continue;
    const root = find(r.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(r);
  }

  const clusters: PropagationCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const withPublished = members.filter(
      (m) => m.published_at && !Number.isNaN(Date.parse(m.published_at)),
    );
    const basis: PropagationCluster["earliestBasis"] =
      withPublished.length === members.length ? "published_at" : "retrieved_at";
    const sorted = [...members].sort((a, b) => {
      const ta = Date.parse((basis === "published_at" ? a.published_at : a.retrieved_at) ?? "");
      const tb = Date.parse((basis === "published_at" ? b.published_at : b.retrieved_at) ?? "");
      return (ta || 0) - (tb || 0) || a.canonical_url.localeCompare(b.canonical_url);
    });
    const ids = sorted.map((m) => m.id);
    clusters.push({
      key: [...ids].sort().join("|").slice(0, 400),
      memberIds: ids,
      earliestId: ids[0]!,
      earliestBasis: basis,
      links: ids.map((id) => ({ discoveryId: id, reasons: Array.from(reasons.get(id) ?? []) })),
    });
  }
  return clusters;
}

/* ── Snapshot (the single source of every number on screen) ──────────────── */

export const CATEGORY_STAGES = [
  "ai_manipulation",
  "harmful_content",
  "impersonation",
  "privacy_exposure",
  "search_reputation",
  "propagation",
] as const;

export type CategoryStage = (typeof CATEGORY_STAGES)[number];

export interface StageTotals {
  stage: CategoryStage;
  /** Distinct content items with an identity-MATCHED, non-rejected finding. */
  relevant: number;
  /** Findings on POSSIBLE_MATCH / NEEDS_IDENTITY_REVIEW items — not in totals. */
  pendingIdentity: number;
  awaitingVerification: number;
  verified: number;
  verifiedHighPriority: number;
  highPriorityPreliminary: number;
  capability: CapabilityRow | null;
}

export interface SearchReputationStats {
  analysed: number;
  positive: number;
  neutral: number;
  potentialRisk: number;
  pct: { positive: number; neutral: number; potentialRisk: number };
}

export interface ScanSnapshotCounts {
  sourcesDiscovered: number;
  candidates: number;
  relevantItems: number;
  identityReviewQueue: number;
  unrelated: number;
  needsVerification: number;
  highPriorityPreliminary: number;
  verifiedHighPriority: number;
  mediaCandidates: number;
  totalRelevantSignals: number;
}

export interface ScanAnalysis {
  counts: ScanSnapshotCounts;
  stages: Record<CategoryStage, StageTotals>;
  search: SearchReputationStats;
  coverage: CoverageReport;
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

export function searchReputationStats(
  findings: FindingRow[],
  discoveries: Map<string, DiscoveryRow>,
): SearchReputationStats {
  const rows = findings.filter(
    (f) =>
      f.stage_key === "search_reputation" &&
      f.state !== "REJECTED" &&
      discoveries.get(f.discovery_id)?.identity_bucket === "MATCHED",
  );
  const positive = rows.filter((f) => f.category === "Positive result").length;
  const potentialRisk = rows.filter((f) => f.category === "Potential risk result").length;
  const neutral = rows.length - positive - potentialRisk;
  return {
    analysed: rows.length,
    positive,
    neutral,
    potentialRisk,
    pct: {
      positive: pct(positive, rows.length),
      neutral: pct(neutral, rows.length),
      potentialRisk: pct(potentialRisk, rows.length),
    },
  };
}

const AWAITING: FindingState[] = ["DISCOVERED", "CLASSIFIED", "NEEDS_HUMAN_REVIEW"];

export function analyseScan(input: {
  sources: SourceRow[];
  discoveries: DiscoveryRow[];
  findings: FindingRow[];
  capabilities: CapabilityRow[];
}): ScanAnalysis {
  const byId = new Map(input.discoveries.map((d) => [d.id, d]));
  const capByKey = new Map(input.capabilities.map((c) => [c.analysis_key, c]));
  const matchedIds = new Set(
    input.discoveries.filter((d) => d.identity_bucket === "MATCHED").map((d) => d.id),
  );

  const stages = {} as Record<CategoryStage, StageTotals>;
  const signalItems = new Set<string>();
  const needsVerificationIds = new Set<string>();
  let highPrelim = 0;
  let verifiedHigh = 0;

  for (const stage of CATEGORY_STAGES) {
    const inStage = input.findings.filter((f) => f.stage_key === stage && f.state !== "REJECTED");
    // Search-reputation "results" are not risk signals unless classified as potential risk.
    const riskBearing = inStage.filter(
      (f) => stage !== "search_reputation" || f.category === "Potential risk result",
    );
    const matched = riskBearing.filter((f) => matchedIds.has(f.discovery_id));
    const pendingIdentity = riskBearing.filter((f) => {
      const b = byId.get(f.discovery_id)?.identity_bucket;
      return b === "POSSIBLE_MATCH" || b === "NEEDS_IDENTITY_REVIEW";
    });
    const items = new Set(
      matched.map((f) => {
        const d = byId.get(f.discovery_id);
        return d ? contentItemKey(d) : f.discovery_id;
      }),
    );
    for (const key of items) signalItems.add(`${stage}:${key}`);
    const awaiting = matched.filter((f) => AWAITING.includes(f.state));
    for (const f of awaiting) needsVerificationIds.add(f.id);
    const verified = matched.filter((f) => f.state === "VERIFIED" || f.state === "ESCALATED");
    const vHigh = verified.filter(
      (f) => severityNumber(f.severity) >= HIGH_PRIORITY_SEVERITY,
    ).length;
    const pHigh = awaiting.filter(
      (f) => severityNumber(f.severity) >= HIGH_PRIORITY_SEVERITY,
    ).length;
    highPrelim += pHigh;
    verifiedHigh += vHigh;
    stages[stage] = {
      stage,
      relevant: items.size,
      pendingIdentity: pendingIdentity.length,
      awaitingVerification: awaiting.length,
      verified: verified.length,
      verifiedHighPriority: vHigh,
      highPriorityPreliminary: pHigh,
      capability: capByKey.get(stage) ?? null,
    };
  }

  const relevantContent = new Set(
    input.discoveries.filter((d) => d.identity_bucket === "MATCHED").map((d) => contentItemKey(d)),
  );

  return {
    counts: {
      sourcesDiscovered: input.discoveries.length,
      candidates: input.discoveries.length,
      relevantItems: relevantContent.size,
      identityReviewQueue: input.discoveries.filter(
        (d) =>
          d.identity_bucket === "POSSIBLE_MATCH" || d.identity_bucket === "NEEDS_IDENTITY_REVIEW",
      ).length,
      unrelated: input.discoveries.filter((d) => d.identity_bucket === "UNRELATED").length,
      needsVerification: needsVerificationIds.size,
      highPriorityPreliminary: highPrelim,
      verifiedHighPriority: verifiedHigh,
      mediaCandidates: input.discoveries.filter(
        (d) => d.media_kind && d.identity_bucket === "MATCHED",
      ).length,
      totalRelevantSignals: signalItems.size,
    },
    stages,
    search: searchReputationStats(input.findings, byId),
    coverage: computeCoverage(input.sources),
  };
}

/* ── Risk-model inputs from stored rows ───────────────────────────────────── */

export function riskInputsFromRows(input: {
  discoveries: DiscoveryRow[];
  findings: FindingRow[];
  observations: ObservationRow[];
  clusters: PropagationCluster[];
}): RiskFindingInput[] {
  const byId = new Map(input.discoveries.map((d) => [d.id, d]));
  const ranks = bestSearchRanks(input.observations);
  const reuploads = new Map<string, number>();
  for (const c of input.clusters) {
    for (const id of c.memberIds) reuploads.set(id, c.memberIds.length - 1);
  }
  return input.findings
    .filter((f) => f.stage_key !== "search_reputation" || f.category === "Potential risk result")
    .map((f) => {
      const d = byId.get(f.discovery_id);
      return {
        id: f.id,
        state: f.state,
        identityBucket: (d?.identity_bucket ?? "NEEDS_IDENTITY_REVIEW") as IdentityBucket,
        severity: severityNumber(f.severity),
        sourceAuthority: d ? sourceAuthority(d.canonical_url) : 0,
        searchRank: ranks.get(f.discovery_id) ?? null,
        platform: d?.platform ?? null,
        reuploadCount: f.stage_key === "propagation" ? 0 : (reuploads.get(f.discovery_id) ?? 0),
        publishedAt: d?.published_at ?? null,
        aiManipulationConfidence: f.stage_key === "ai_manipulation" ? (f.confidence ?? null) : null,
        identityConfidence: d?.identity_confidence ?? 0,
      };
    });
}
