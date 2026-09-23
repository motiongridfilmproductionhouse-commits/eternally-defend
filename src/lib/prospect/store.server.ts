/**
 * Pre-Enrollment Intelligence — Supabase implementation of the runner store.
 *
 * Bound to one scan. Uses the service-role client only inside the background
 * runner, which is started exclusively by a server function that has already
 * verified the caller is staff (see scan.functions.ts). Every write targets the
 * prospect_* namespace; nothing here touches client-monitoring or enforcement
 * tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProspectStore } from "./runner";
import type { CapabilityRow, DiscoveryRow, FindingRow, ObservationRow } from "./analysis";
import type { SourceState } from "./coverage";

// The generated Database types lag new prospect columns; the prospect store is
// deliberately loosely typed and validated by its own row interfaces.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, "public", any>;

const DISCOVERY_COLUMNS =
  "id, family_key, platform, discovery_method, original_url, canonical_url, content_fingerprint, title, snippet, published_at, retrieved_at, identity_bucket, identity_confidence, identity_explanation, thumbnail_url, media_kind, extraction_status";

function fail(context: string, error: { message?: string } | null): never {
  throw new Error(`[prospect-store] ${context}: ${error?.message ?? "unknown error"}`);
}

export function createProspectStore(
  db: AnyClient,
  scanId: string,
  prospectId: string,
): ProspectStore {
  return {
    async updateScan(patch) {
      const { error } = await db.from("prospect_scans").update(patch).eq("id", scanId);
      if (error) fail("updateScan", error);
    },

    async initSources(rows) {
      const { error } = await db.from("prospect_scan_sources").upsert(
        rows.map((r) => ({ ...r, scan_id: scanId })),
        { onConflict: "scan_id,family_key" },
      );
      if (error) fail("initSources", error);
    },

    async updateSource(familyKey, patch) {
      const { error } = await db
        .from("prospect_scan_sources")
        .update(patch)
        .eq("scan_id", scanId)
        .eq("family_key", familyKey);
      if (error) fail("updateSource", error);
    },

    async appendEvent(event) {
      const { error } = await db.from("prospect_scan_events").insert({
        scan_id: scanId,
        stage: event.stage ?? null,
        family_key: event.familyKey ?? null,
        level: event.level ?? "info",
        message: event.message.slice(0, 500),
        detail: { type: event.type, ...(event.detail ?? {}) },
      });
      if (error) fail("appendEvent", error);
    },

    async insertDiscovery(row) {
      const { data, error } = await db
        .from("prospect_discoveries")
        .insert({ ...row, scan_id: scanId, prospect_id: prospectId })
        .select("id")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") return null; // same canonical URL already stored
        fail("insertDiscovery", error);
      }
      return (data?.id as string | undefined) ?? null;
    },

    async findDiscoveryId(canonicalUrl) {
      const { data, error } = await db
        .from("prospect_discoveries")
        .select("id")
        .eq("scan_id", scanId)
        .eq("canonical_url", canonicalUrl)
        .maybeSingle();
      if (error) fail("findDiscoveryId", error);
      return (data?.id as string | undefined) ?? null;
    },

    async insertObservation(row) {
      const { error } = await db
        .from("prospect_discovery_observations")
        .insert({ ...row, scan_id: scanId });
      if (error) fail("insertObservation", error);
    },

    async insertFinding(row) {
      const { data, error } = await db
        .from("prospect_findings")
        .insert({ ...row, scan_id: scanId, prospect_id: prospectId })
        .select("id")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") return null;
        fail("insertFinding", error);
      }
      return (data?.id as string | undefined) ?? null;
    },

    async insertEvidence(row) {
      const { error } = await db
        .from("prospect_finding_evidence")
        .insert({ ...row, scan_id: scanId });
      if (error) fail("insertEvidence", error);
    },

    async upsertCapability(row) {
      const { error } = await db
        .from("prospect_scan_capabilities")
        .upsert({ ...row, scan_id: scanId }, { onConflict: "scan_id,analysis_key" });
      if (error) fail("upsertCapability", error);
    },

    async insertCluster(row) {
      const { data, error } = await db
        .from("prospect_propagation_clusters")
        .insert({
          scan_id: scanId,
          cluster_key: row.cluster_key,
          member_count: row.member_count,
          earliest_discovery_id: row.earliest_discovery_id,
          origin_established: false,
        })
        .select("id")
        .maybeSingle();
      if (error) fail("insertCluster", error);
      const clusterId = data?.id as string | undefined;
      if (!clusterId) return;
      const { error: memberError } = await db
        .from("prospect_cluster_members")
        .insert(row.members.map((m) => ({ ...m, cluster_id: clusterId })));
      if (memberError) fail("insertClusterMembers", memberError);
    },

    async insertRiskScore(result) {
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
      });
      if (error) fail("insertRiskScore", error);
    },

    async listSources() {
      const { data, error } = await db
        .from("prospect_scan_sources")
        .select("family_key, state, weight_class, direct_access")
        .eq("scan_id", scanId);
      if (error) fail("listSources", error);
      return (data ?? []) as Array<{
        family_key: string;
        state: SourceState;
        weight_class: string;
        direct_access: boolean;
      }>;
    },

    async listDiscoveries() {
      return selectAll<DiscoveryRow>(db, "prospect_discoveries", DISCOVERY_COLUMNS, scanId);
    },

    async listFindings() {
      return selectAll<FindingRow>(
        db,
        "prospect_findings",
        "id, discovery_id, stage_key, category, severity, detection_reason, confidence, state, verified_by",
        scanId,
      );
    },

    async listObservations() {
      return selectAll<ObservationRow>(
        db,
        "prospect_discovery_observations",
        "discovery_id, provider, family_key, query_used, query_purpose, result_rank",
        scanId,
      );
    },

    async listCapabilities() {
      const { data, error } = await db
        .from("prospect_scan_capabilities")
        .select("analysis_key, status, reason, candidates_considered")
        .eq("scan_id", scanId);
      if (error) fail("listCapabilities", error);
      return (data ?? []) as CapabilityRow[];
    },
  };
}

/** Paginated read so large scans are never silently truncated at 1000 rows. */
export async function selectAll<T>(
  db: AnyClient,
  table: string,
  columns: string,
  scanId: string,
): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq("scan_id", scanId)
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) fail(`select ${table}`, error);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return out;
}
