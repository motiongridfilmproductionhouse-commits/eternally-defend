/**
 * Pre-Enrollment Intelligence — read model for the staff screens.
 *
 * Always executed with the CALLER'S RLS-scoped client, so a non-staff session
 * reads nothing. Every number returned is computed from the rows read here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analyseScan,
  clusterPropagation,
  riskInputsFromRows,
  type CapabilityRow,
  type DiscoveryRow,
  type FindingRow,
  type ObservationRow,
} from "./analysis";
import { computeCoverage, type SourceRow } from "./coverage";
import {
  computePreliminaryExposure,
  computeVerifiedRisk,
  type RiskScoreResult,
} from "./risk-model";
import { selectAll } from "./store.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, "public", any>;

export async function assertStaff(db: AnyClient, userId: string): Promise<void> {
  const { data, error } = await db.rpc("is_prospect_staff", { _user_id: userId });
  if (error || data !== true) throw new Error("Staff access required");
}

export interface StoredScore {
  score_kind: "PRELIMINARY_EXPOSURE" | "VERIFIED_RISK";
  band: string;
  total_points: number;
  model_version: string;
  factors: { factors?: RiskScoreResult["factors"]; qualifier?: string };
  coverage_state: string | null;
  findings_considered: number;
  findings_awaiting_verification: number;
  created_at: string;
}

export async function loadScanSnapshot(
  db: AnyClient,
  scanId: string,
  opts: { eventsAfter?: number } = {},
) {
  const { data: scan, error } = await db
    .from("prospect_scans")
    .select("*")
    .eq("id", scanId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scan) throw new Error("Scan not found");

  const [identityRes, sourcesRes, capabilitiesRes, scoresRes, eventsRes, clustersRes] =
    await Promise.all([
      db.from("prospect_identities").select("*").eq("id", scan.prospect_id).maybeSingle(),
      db.from("prospect_scan_sources").select("*").eq("scan_id", scanId).order("created_at"),
      db
        .from("prospect_scan_capabilities")
        .select("analysis_key, status, reason, candidates_considered")
        .eq("scan_id", scanId),
      db
        .from("prospect_risk_scores")
        .select("*")
        .eq("scan_id", scanId)
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("prospect_scan_events")
        .select("id, stage, family_key, level, message, detail, created_at")
        .eq("scan_id", scanId)
        .gt("id", opts.eventsAfter ?? 0)
        .order("id", { ascending: false })
        .limit(150),
      db
        .from("prospect_propagation_clusters")
        .select(
          "id, cluster_key, member_count, earliest_discovery_id, origin_established, prospect_cluster_members(discovery_id, is_earliest_discovered, link_evidence)",
        )
        .eq("scan_id", scanId),
    ]);

  const discoveries = await selectAll<DiscoveryRow>(
    db,
    "prospect_discoveries",
    "id, family_key, platform, discovery_method, original_url, canonical_url, content_fingerprint, title, snippet, published_at, retrieved_at, identity_bucket, identity_confidence, identity_explanation, identity_factors, thumbnail_url, media_kind, extraction_status",
    scanId,
  );
  const findings = await selectAll<FindingRow & { created_at: string }>(
    db,
    "prospect_findings",
    "id, discovery_id, stage_key, category, severity, detection_reason, confidence, state, verified_by, verified_at, created_at",
    scanId,
  );
  const observations = await selectAll<ObservationRow & { discovery_method: string | null }>(
    db,
    "prospect_discovery_observations",
    "discovery_id, provider, family_key, query_used, query_purpose, result_rank, discovery_method",
    scanId,
  );

  const sources = (sourcesRes.data ?? []) as Array<SourceRow & Record<string, unknown>>;
  const capabilities = (capabilitiesRes.data ?? []) as CapabilityRow[];
  const analysis = analyseScan({ sources, discoveries, findings, capabilities });

  const scores = (scoresRes.data ?? []) as StoredScore[];
  const latest = (kind: StoredScore["score_kind"]) =>
    scores.find((s) => s.score_kind === kind) ?? null;

  return {
    scan,
    identity: identityRes.data,
    sources,
    capabilities,
    discoveries,
    findings,
    observations,
    clusters: clustersRes.data ?? [],
    events: ((eventsRes.data ?? []) as Array<{ id: number }>).reverse(),
    analysis,
    scores: { preliminary: latest("PRELIMINARY_EXPOSURE"), verified: latest("VERIFIED_RISK") },
  };
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };
export type JsonRow = { [key: string]: Json | undefined };

export interface SourceView {
  family_key: string;
  family_label: string;
  direct_access: boolean;
  weight_class: string;
  state: SourceRow["state"];
  providers: string[];
  queries_issued: number;
  raw_results: number;
  unique_items: number;
  failure_reason: string | null;
}

export interface EventView {
  id: number;
  stage: string | null;
  family_key: string | null;
  level: string;
  message: string;
  detail: JsonRow | null;
  created_at: string;
}

/** Serializable view returned to the staff screens. */
export interface ScanSnapshotView {
  scan: JsonRow;
  identity: JsonRow | null;
  sources: SourceView[];
  capabilities: CapabilityRow[];
  discoveries: Array<DiscoveryRow & { identity_factors?: Json }>;
  findings: Array<FindingRow & { created_at: string; verified_at?: string | null }>;
  observations: Array<ObservationRow & { discovery_method: string | null }>;
  clusters: JsonRow[];
  events: EventView[];
  analysis: import("./analysis").ScanAnalysis;
  scores: { preliminary: StoredScore | null; verified: StoredScore | null };
}

export function toView(snapshot: Awaited<ReturnType<typeof loadScanSnapshot>>): ScanSnapshotView {
  return JSON.parse(JSON.stringify(snapshot)) as ScanSnapshotView;
}

/**
 * Recompute and append both assessments (history is append-only). Called after
 * every staff decision so the Verified Risk Assessment always reflects the
 * current human-verified set.
 */
export async function recomputeScores(
  db: AnyClient,
  scanId: string,
  actorId: string,
): Promise<void> {
  const [sourcesRes, discoveries, findings, observations] = await Promise.all([
    db
      .from("prospect_scan_sources")
      .select("family_key, state, weight_class, direct_access")
      .eq("scan_id", scanId),
    selectAll<DiscoveryRow>(
      db,
      "prospect_discoveries",
      "id, family_key, platform, discovery_method, original_url, canonical_url, content_fingerprint, title, snippet, published_at, retrieved_at, identity_bucket, identity_confidence, identity_explanation",
      scanId,
    ),
    selectAll<FindingRow>(
      db,
      "prospect_findings",
      "id, discovery_id, stage_key, category, severity, detection_reason, confidence, state",
      scanId,
    ),
    selectAll<ObservationRow>(
      db,
      "prospect_discovery_observations",
      "discovery_id, provider, family_key, query_used, query_purpose, result_rank",
      scanId,
    ),
  ]);
  const coverage = computeCoverage((sourcesRes.data ?? []) as SourceRow[]);
  const inputs = riskInputsFromRows({
    discoveries,
    findings,
    observations,
    clusters: clusterPropagation(discoveries),
  });
  for (const result of [
    computePreliminaryExposure(inputs, coverage.state),
    computeVerifiedRisk(inputs, coverage.state),
  ]) {
    const { error } = await db.from("prospect_risk_scores").insert({
      scan_id: scanId,
      score_kind: result.kind === "PRELIMINARY" ? "PRELIMINARY_EXPOSURE" : "VERIFIED_RISK",
      model_version: result.modelVersion,
      band: result.band,
      total_points: result.score,
      factors: { factors: result.factors, qualifier: result.qualifier },
      coverage_state: result.coverageState,
      findings_considered: result.findingsConsidered,
      findings_awaiting_verification: result.findingsAwaitingVerification,
      computed_by: actorId,
    });
    if (error) throw new Error(error.message);
  }
}
