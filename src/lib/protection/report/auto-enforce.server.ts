/**
 * Automatic enforcement bridge for removal-eligible discoveries.
 *
 * Runs only inside the scan pipeline, only for discoveries the existing
 * eligibility classifier already labelled REMOVAL_ELIGIBLE, and delegates
 * every authorization / route / idempotency decision to
 * AutoEnforcementOrchestrator. It cannot grant eligibility, cannot bypass the
 * pre-send gate, and never contacts a platform itself — sending stays gated by
 * ENFORCEMENT_LIVE_ENABLED / ENFORCEMENT_TEST_MODE in the worker + transport.
 */
import { AutoEnforcementOrchestrator, type FindingShape } from "@/lib/enforcement/orchestrator";
import type { ClassifiedDiscovery } from "./types";

export interface AutoEnforceSummary {
  considered: number;
  queued: number;
  deduplicated: number;
  review: number;
  blocked: number;
  skipped: number;
}

function isAutoEnforcementEnabled(): boolean {
  // Explicit opt-out only. Live *sending* remains separately gated.
  return process.env.AUTO_ENFORCEMENT_ENABLED !== "false";
}

function toFinding(discovery: ClassifiedDiscovery): FindingShape {
  return {
    id: discovery.id,
    source: discovery.platform || discovery.module,
    source_type: discovery.platform ?? null,
    canonical_url: discovery.sourceUrl,
    permalink: discovery.sourceUrl,
    title: discovery.title,
    risk_type: discovery.riskType ?? null,
    threat_score: discovery.confidence,
    source_metadata: { module: discovery.module, evidence: discovery.evidence },
  };
}

/**
 * Queue automatic enforcement for every removal-eligible discovery in one
 * scan report. Best effort per discovery: a failure never fails the scan.
 */
export async function autoEnforceEligibleDiscoveries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: {
    userId: string;
    moduleKey: string;
    scanId: string;
    discoveries: ClassifiedDiscovery[];
  },
): Promise<AutoEnforceSummary> {
  const summary: AutoEnforceSummary = {
    considered: 0,
    queued: 0,
    deduplicated: 0,
    review: 0,
    blocked: 0,
    skipped: 0,
  };
  if (!isAutoEnforcementEnabled()) return summary;

  const eligible = input.discoveries.filter(
    (d) => d.eligibility === "REMOVAL_ELIGIBLE" && d.moduleVerified && d.sourceUrl,
  );
  summary.considered = eligible.length;

  for (const discovery of eligible) {
    // Evidence precondition: never prepare a removal request for a discovery
    // with no recorded evidence of what was found.
    if (discovery.evidence.length === 0) {
      summary.skipped += 1;
      continue;
    }

    try {
      const result = await AutoEnforcementOrchestrator.onVerifiedFinding(
        supabaseAdmin,
        input.userId,
        toFinding(discovery),
      );

      if (result.idempotencyDeduplicated) {
        summary.deduplicated += 1;
      } else if (result.status === "QUEUED") {
        summary.queued += 1;
      } else if (result.status === "UNDER_REVIEW") {
        summary.review += 1;
      } else {
        summary.blocked += 1;
      }

      if (result.caseId && !result.idempotencyDeduplicated) {
        // Audit trail linking the scan report to the enforcement case.
        await supabaseAdmin.from("enforcement_events").insert({
          case_id: result.caseId,
          user_id: input.userId,
          event_type: "AUTO_ENFORCEMENT_FROM_SCAN_REPORT",
          actor_type: "SYSTEM",
          new_state: result.status,
          target_url: discovery.sourceUrl,
          metadata: {
            module_key: input.moduleKey,
            scan_id: input.scanId,
            discovery_id: discovery.id,
            eligibility: discovery.eligibility,
            eligibility_reasons: discovery.eligibilityReasons,
            evidence_items: discovery.evidence.length,
          },
        });
      }
    } catch (err) {
      summary.skipped += 1;
      console.error(
        "[protection:auto-enforce] failed",
        input.moduleKey,
        discovery.id,
        (err as Error)?.message,
      );
    }
  }

  return summary;
}
