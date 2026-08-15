/**
 * Protection Autopilot — server side.
 *
 * Flow: onboarding complete -> protection profile ACTIVE -> initial scan queued
 * -> recurring scans -> candidate discovery -> identity/media verification ->
 * evidence preservation -> case creation -> enforcement eligibility -> routing.
 *
 * Enforcement itself is delegated to the existing production pipeline
 * (AutoEnforcementOrchestrator + EnforcementWorkerRunner), so every existing
 * gate (authorization, ownership, production approval, route verification,
 * allowlist, suppression, rate limits, emergency pause, live kill switch,
 * pre-send snapshot) still applies. This module never sends anything itself.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AutoEnforcementOrchestrator } from "@/lib/enforcement/orchestrator";
import { buildAuthorizedIdentity } from "@/lib/security/subject-authorization";
import {
  DEFAULT_CADENCE_MINUTES,
  buildDedupeKey,
  canonicalizeUrlForDedupe,
  classifyFindingForEnforcement,
  computeNextRunAt,
  describeEnforcementOutcome,
  enforcementSwitches,
  type ProtectionProfileStatus,
  type ProtectionTargetKind,
} from "./autopilot";

type Client = any;

export interface ActivationSummary {
  status: ProtectionProfileStatus;
  activated: boolean;
  authorization_active: boolean;
  targets: Array<{ id: string; kind: ProtectionTargetKind; label: string; cadence_minutes: number }>;
  initial_scans_queued: number;
  reason: string | null;
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */
export async function activateProtectionAutopilot(
  supabase: Client,
  userId: string,
  options: { email?: string | null } = {},
): Promise<ActivationSummary> {
  const [{ data: auth }, { data: profile }, { data: assets }] = await Promise.all([
    supabase
      .from("client_authorizations")
      .select("id,status,enforcement_enabled,expiry_date")
      .eq("user_id", userId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("client_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("protected_assets")
      .select("id,name,active,phash,dhash,ahash,source_url,kind")
      .eq("user_id", userId)
      .eq("active", true),
  ]);

  const authorizationActive = auth?.status === "ACTIVE" && auth?.enforcement_enabled !== false;
  const identity = buildAuthorizedIdentity(profile ?? null, (assets ?? []) as any[], {
    email: options.email ?? null,
  });

  const status: ProtectionProfileStatus = authorizationActive ? "ACTIVE" : "PENDING_AUTHORIZATION";
  const nowIso = new Date().toISOString();

  await supabase.from("protection_profiles").upsert(
    {
      user_id: userId,
      status,
      auto_scan_enabled: true,
      paused: false,
      activated_at: authorizationActive ? nowIso : null,
      updated_at: nowIso,
    },
    { onConflict: "user_id" },
  );

  const desired: Array<{
    kind: ProtectionTargetKind;
    label: string;
    ref: string | null;
  }> = [];

  if (identity.primaryName) {
    desired.push({ kind: "identity", label: identity.primaryName, ref: null });
  }
  for (const asset of (assets ?? []) as any[]) {
    const fingerprinted = Boolean(asset.phash || asset.dhash || asset.ahash);
    if (!fingerprinted) continue; // similarity needs a fingerprint; unfingerprinted assets stay manual
    desired.push({ kind: "asset", label: asset.name ?? "Protected asset", ref: asset.id });
  }

  const targets: ActivationSummary["targets"] = [];
  for (const item of desired) {
    const cadence = DEFAULT_CADENCE_MINUTES[item.kind];
    const { data: row } = await supabase
      .from("protection_targets")
      .upsert(
        {
          user_id: userId,
          target_kind: item.kind,
          target_ref: item.ref,
          label: item.label,
          cadence_minutes: cadence,
          active: true,
          // Initial scan: due immediately, no manual "Scan" click required.
          next_run_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "user_id,target_kind,label" },
      )
      .select("id,target_kind,label,cadence_minutes")
      .maybeSingle();
    if (row) {
      targets.push({
        id: row.id,
        kind: row.target_kind,
        label: row.label,
        cadence_minutes: row.cadence_minutes,
      });
    }
  }

  return {
    status,
    activated: authorizationActive && targets.length > 0,
    authorization_active: authorizationActive,
    targets,
    initial_scans_queued: authorizationActive ? targets.length : 0,
    reason: authorizationActive
      ? targets.length === 0
        ? "No fingerprinted assets or registered subject to enroll yet."
        : null
      : "Rights-holder authorization is not ACTIVE yet — scanning stays paused.",
  };
}

/* ------------------------------------------------------------------ */
/* Sweep                                                               */
/* ------------------------------------------------------------------ */
export interface RunStats {
  target_id: string;
  kind: ProtectionTargetKind;
  label: string;
  scan_ref: string | null;
  discovered: number;
  duplicates: number;
  verified: number;
  held_for_review: number;
  evidence_preserved: number;
  cases_created: number;
  external_sends: number;
  blocking_reasons: string[];
  status: "completed" | "failed";
  error?: string;
}

export async function runProtectionSweep(
  supabase: Client,
  options: { limit?: number; userId?: string; force?: boolean } = {},
): Promise<{ processed: number; runs: RunStats[] }> {
  const limit = options.limit ?? 5;
  let query = supabase
    .from("protection_targets")
    .select("*")
    .eq("active", true)
    .order("next_run_at", { ascending: true })
    .limit(limit);
  if (!options.force) query = query.lte("next_run_at", new Date().toISOString());
  if (options.userId) query = query.eq("user_id", options.userId);

  const { data: due, error } = await query;
  if (error) throw new Error(error.message);

  const runs: RunStats[] = [];
  for (const target of (due ?? []) as any[]) {
    const { data: profile } = await supabase
      .from("protection_profiles")
      .select("status,paused,auto_scan_enabled")
      .eq("user_id", target.user_id)
      .maybeSingle();
    if (!profile || profile.status !== "ACTIVE" || profile.paused || !profile.auto_scan_enabled) {
      continue;
    }
    runs.push(await runProtectionTarget(supabase, target, options.force ? "manual" : "scheduled"));
  }
  return { processed: runs.length, runs };
}

export async function runProtectionTarget(
  supabase: Client,
  target: any,
  trigger: "onboarding_initial" | "scheduled" | "manual" = "scheduled",
): Promise<RunStats> {
  const stats: RunStats = {
    target_id: target.id,
    kind: target.target_kind,
    label: target.label,
    scan_ref: null,
    discovered: 0,
    duplicates: 0,
    verified: 0,
    held_for_review: 0,
    evidence_preserved: 0,
    cases_created: 0,
    external_sends: 0,
    blocking_reasons: [],
    status: "completed",
  };

  const { data: run } = await supabase
    .from("protection_runs")
    .insert({ user_id: target.user_id, target_id: target.id, trigger, status: "running" })
    .select("id")
    .maybeSingle();

  try {
    const candidates =
      target.target_kind === "asset"
        ? await discoverForAsset(supabase, target, stats)
        : await discoverForIdentity(supabase, target, stats);

    stats.discovered = candidates.length;

    for (const candidate of candidates) {
      await ingestCandidate(supabase, target, candidate, stats);
    }

    await supabase
      .from("protection_targets")
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: "completed",
        last_run_error: null,
        consecutive_failures: 0,
        next_run_at: computeNextRunAt(new Date(), target.cadence_minutes ?? 1440, 0),
      })
      .eq("id", target.id);
  } catch (err) {
    stats.status = "failed";
    stats.error = err instanceof Error ? err.message : String(err);
    const failures = (target.consecutive_failures ?? 0) + 1;
    await supabase
      .from("protection_targets")
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: "failed",
        last_run_error: stats.error.slice(0, 500),
        consecutive_failures: failures,
        next_run_at: computeNextRunAt(new Date(), target.cadence_minutes ?? 1440, failures),
      })
      .eq("id", target.id);
  }

  if (run?.id) {
    await supabase
      .from("protection_runs")
      .update({
        status: stats.status,
        stats: JSON.parse(JSON.stringify(stats)),
        error: stats.error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
  }
  await supabase
    .from("protection_profiles")
    .update({ last_sweep_at: new Date().toISOString() })
    .eq("user_id", target.user_id);

  return stats;
}

/* ------------------------------------------------------------------ */
/* Discovery adapters                                                  */
/* ------------------------------------------------------------------ */
export interface AutopilotCandidate {
  url: string;
  source: string;
  source_type: string | null;
  title: string | null;
  risk_type: string;
  severity: string | null;
  confidence: number;
  identityVerified: boolean;
  mediaEvidenceConfirmed: boolean;
  ownershipVerified: boolean;
  protected_asset_id: string | null;
  finding_id: string | null;
  lead_id: string | null;
  evidence: Record<string, unknown>;
}

async function discoverForAsset(
  supabase: Client,
  target: any,
  stats: RunStats,
): Promise<AutopilotCandidate[]> {
  const { data: job, error } = await supabase
    .from("asset_discovery_jobs")
    .insert({
      user_id: target.user_id,
      protected_asset_id: target.target_ref,
      status: "pending",
      stage: "queued",
    })
    .select("id")
    .single();
  if (error || !job) throw new Error(error?.message ?? "Failed to queue discovery job");
  stats.scan_ref = job.id;

  const { runAssetDiscoveryJob } = await import("@/lib/discovery/asset-discovery.server");
  await runAssetDiscoveryJob(supabase, job.id);

  const { data: rows } = await supabase
    .from("discovery_candidates")
    .select("*")
    .eq("user_id", target.user_id)
    .eq("protected_asset_id", target.target_ref)
    .eq("job_id", job.id)
    .limit(200);

  const matchIds = ((rows ?? []) as any[])
    .map((r) => r.copyright_match_id)
    .filter((v): v is string => Boolean(v));
  const matchMap = new Map<string, any>();
  if (matchIds.length) {
    const { data: matches } = await supabase
      .from("copyright_matches")
      .select("id,confidence,confidence_band,detection_type,review_status,platform,source_url")
      .eq("user_id", target.user_id)
      .in("id", matchIds);
    for (const m of (matches ?? []) as any[]) matchMap.set(m.id, m);
  }

  return ((rows ?? []) as any[]).map((row) => {
    const match = row.copyright_match_id ? matchMap.get(row.copyright_match_id) : null;
    const similarity = typeof row.similarity === "number" ? row.similarity : 0;
    const confidence = match?.confidence ?? Math.round(similarity * 100);
    return {
      url: row.page_url ?? row.canonical_page_url,
      source: row.provider ?? "asset_discovery",
      source_type: row.platform ?? null,
      title: row.page_title ?? null,
      risk_type: "COPYRIGHT",
      severity: confidence >= 92 ? "HIGH" : "MEDIUM",
      confidence,
      // Fingerprint match on the owner's registered work = ownership verified.
      ownershipVerified: true,
      identityVerified: row.verification_status === "VERIFIED_MATCH",
      mediaEvidenceConfirmed:
        row.verification_status === "VERIFIED_MATCH" && Boolean(row.copyright_match_id),
      protected_asset_id: row.protected_asset_id,
      finding_id: null,
      lead_id: null,
      evidence: {
        media_url: row.media_url,
        screenshot_url: row.screenshot_url,
        hashes: row.hashes,
        similarity: row.similarity,
        match_type: row.match_type,
        detection_type: match?.detection_type ?? null,
        confidence_band: match?.confidence_band ?? null,
        copyright_match_id: row.copyright_match_id ?? null,
      },
    } satisfies AutopilotCandidate;
  });
}

async function discoverForIdentity(
  supabase: Client,
  target: any,
  stats: RunStats,
): Promise<AutopilotCandidate[]> {
  const { data: scan, error } = await supabase
    .from("deepfake_scans")
    .insert({
      user_id: target.user_id,
      target_name: target.label,
      aliases: [],
      handles: [],
      status: "running",
      scan_run_token: crypto.randomUUID(),
      heartbeat_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    })
    .select("id")
    .maybeSingle();

  let scanId = scan?.id ?? null;
  if (!scanId) {
    // One active scan per target already running — reuse it instead of failing.
    const { data: active } = await supabase
      .from("deepfake_scans")
      .select("id")
      .eq("user_id", target.user_id)
      .eq("status", "running")
      .ilike("target_name", target.label)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    scanId = active?.id ?? null;
    if (!scanId) throw new Error(error?.message ?? "Failed to queue identity scan");
  }
  stats.scan_ref = scanId;

  const { executeDeepfakeScanById } = await import("@/lib/deepfake/scan-executor.server");
  await executeDeepfakeScanById({
    supabase,
    scanId,
    userId: target.user_id,
    source: "worker",
  });

  const { data: findings } = await supabase
    .from("deepfake_findings")
    .select("*")
    .eq("user_id", target.user_id)
    .eq("scan_id", scanId)
    .limit(200);

  return ((findings ?? []) as any[]).map((f) => ({
    url: f.canonical_url ?? f.final_url ?? f.url,
    source: "deepfake_intel",
    source_type: f.source_host ?? null,
    title: f.page_title ?? null,
    risk_type: "DEEPFAKE",
    severity: f.risk_level ?? null,
    confidence: Math.round(
      typeof f.synthetic_media_confidence === "number"
        ? f.synthetic_media_confidence
        : (f.confidence ?? 0),
    ),
    identityVerified: Boolean(f.target_face_match) && Boolean(f.face_referenced),
    mediaEvidenceConfirmed: Boolean(f.is_synthetic) && (f.matched_evidence ?? []).length > 0,
    ownershipVerified: true, // the subject is the account's registered identity
    protected_asset_id: null,
    finding_id: f.id,
    lead_id: null,
    evidence: {
      review_status: f.review_status,
      face_similarity: f.face_similarity,
      identity_confidence: f.identity_confidence,
      matched_evidence: f.matched_evidence,
      classification: f.finding_classification,
    },
  }));
}

/* ------------------------------------------------------------------ */
/* Ingest: dedupe -> preserve evidence -> case -> enforcement gates     */
/* ------------------------------------------------------------------ */
export async function ingestCandidate(
  supabase: Client,
  target: any,
  candidate: AutopilotCandidate,
  stats: RunStats,
): Promise<void> {
  if (!candidate.url) return;
  const canonical = canonicalizeUrlForDedupe(candidate.url);
  const dedupeKey = buildDedupeKey({
    userId: target.user_id,
    url: canonical,
    targetKind: target.target_kind,
    targetRef: target.target_ref,
  });

  const { data: existing } = await supabase
    .from("protection_findings_seen")
    .select("id,times_seen,case_id")
    .eq("user_id", target.user_id)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();

  if (existing) {
    stats.duplicates += 1;
    await supabase
      .from("protection_findings_seen")
      .update({ times_seen: (existing.times_seen ?? 1) + 1, last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    return;
  }

  const gate = classifyFindingForEnforcement({
    identityVerified: candidate.identityVerified,
    mediaEvidenceConfirmed: candidate.mediaEvidenceConfirmed,
    ownershipVerified: candidate.ownershipVerified,
    actionableUrl: /^https?:\/\/.+\/?/i.test(candidate.url),
    confidence: candidate.confidence,
  });

  // Evidence preservation ALWAYS happens before any enforcement decision.
  let preservedCount = 0;
  if (candidate.finding_id || candidate.lead_id) {
    try {
      const { preserveEvidenceForTarget } = await import(
        "@/lib/deepfake/evidence-preservation.server"
      );
      const summary = await preserveEvidenceForTarget({
        supabase,
        userId: target.user_id,
        findingId: candidate.finding_id,
        leadId: candidate.lead_id,
      });
      preservedCount = summary.preserved + summary.already_present;
    } catch (err) {
      console.warn("[protection-autopilot] evidence preservation failed", err);
    }
  } else if (candidate.evidence.media_url || candidate.evidence.screenshot_url) {
    preservedCount = 1; // discovery pipeline already stored the captured artifact
  }
  stats.evidence_preserved += preservedCount > 0 ? 1 : 0;

  let caseId: string | null = null;
  let caseStatus: string | null = null;
  let blockingReason = gate.blockingReason;

  if (gate.decision === "VERIFIED" && preservedCount > 0) {
    stats.verified += 1;
    const result = await AutoEnforcementOrchestrator.onVerifiedFinding(
      supabase,
      target.user_id,
      {
        id: candidate.finding_id ?? `${target.id}:${dedupeKey.slice(0, 12)}`,
        user_id: target.user_id,
        source: candidate.source,
        source_type: candidate.source_type,
        canonical_url: canonical,
        permalink: candidate.url,
        title: candidate.title,
        risk_type: candidate.risk_type,
        severity: candidate.severity,
        threat_score: candidate.confidence,
        protected_asset_id: candidate.protected_asset_id,
        source_metadata: candidate.evidence as Record<string, unknown>,
      },
    );
    caseId = result.caseId;
    caseStatus = result.status;
    if (!result.idempotencyDeduplicated && result.caseId) stats.cases_created += 1;

    const { data: caseRow } = caseId
      ? await supabase
          .from("enforcement_cases")
          .select("status,eligibility_status,selected_route")
          .eq("id", caseId)
          .maybeSingle()
      : { data: null };

    const outcome = describeEnforcementOutcome({
      caseStatus: caseRow?.status ?? caseStatus,
      eligibility: caseRow?.eligibility_status ?? null,
      routeName: caseRow?.selected_route ?? null,
    });
    blockingReason = outcome.blockingReason;
    if (outcome.externalSendAllowed) stats.external_sends += 1;
  } else {
    stats.held_for_review += 1;
    if (gate.decision === "VERIFIED" && preservedCount === 0) {
      blockingReason = "Mandatory evidence snapshot missing — enforcement withheld.";
    }
  }

  if (blockingReason && !stats.blocking_reasons.includes(blockingReason)) {
    stats.blocking_reasons.push(blockingReason);
  }

  // Removal-route contact discovery: inspect the independent host's OWN
  // published legal/contact/copyright pages and propose a candidate recipient
  // for operator review. Always DISCOVERED_UNVERIFIED, never sendable.
  try {
    const { discoverAndRecordRouteCandidate } = await import(
      "@/lib/enforcement/contact-discovery.server"
    );
    await discoverAndRecordRouteCandidate({
      supabase,
      targetUrl: candidate.url,
      findingId: candidate.finding_id ?? null,
      caseId,
      sourceType: candidate.source_type ?? null,
    });
  } catch (err) {
    console.warn("[protection-autopilot] route contact discovery failed", err);
  }


  await supabase.from("protection_findings_seen").insert({
    user_id: target.user_id,
    dedupe_key: dedupeKey,
    canonical_url: canonical,
    target_id: target.id,
    case_id: caseId,
    enforcement_status: caseStatus ?? gate.decision,
    blocking_reason: blockingReason,
    evidence_json: JSON.parse(
      JSON.stringify({ ...candidate.evidence, preserved_items: preservedCount }),
    ),
  });
}

export function autopilotSwitchState() {
  return enforcementSwitches();
}

/**
 * Best-effort activation used by onboarding completion. Onboarding must never
 * fail because autopilot enrollment failed.
 */
export async function activateProtectionAfterOnboarding(
  supabase: Client,
  userId: string,
): Promise<ActivationSummary | null> {
  try {
    return await activateProtectionAutopilot(supabase, userId);
  } catch (err) {
    console.error("[protection-autopilot] activation after onboarding failed", err);
    return null;
  }
}
