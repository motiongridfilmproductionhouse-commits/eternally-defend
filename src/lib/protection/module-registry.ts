/**
 * Static registry of scan modules eligible for automatic enrollment.
 *
 * `scopeKey` maps a module to the SCOPE_KEYS entry (see
 * src/lib/onboarding/authorization.functions.ts) whose grant makes the
 * customer eligible for that module. `driver` records how the module's
 * recurring execution is actually wired today:
 *  - "orchestrator": the generic scan-orchestrator hook runs the scan itself.
 *  - "self-cron": the module already has its own dedicated recurring hook;
 *    the orchestrator only mirrors its latest state for the dashboard.
 *  - "not-yet-automated": no headless execution path exists yet — the
 *    orchestrator marks it WAITING_FOR_NEXT_SCAN / NOT_AUTOMATED_YET and
 *    never fabricates progress.
 *  - "reactive": not scheduled on its own — it's a byproduct of other
 *    modules' qualifying findings (evidence capture). The orchestrator only
 *    mirrors counts already produced elsewhere; there is no separate scan.
 */
export type ModuleDriver = "orchestrator" | "self-cron" | "not-yet-automated" | "reactive";

export interface ModuleConfig {
  key: string;
  label: string;
  scopeKey: string;
  driver: ModuleDriver;
  cadenceMinutes: number;
}

export const MODULE_REGISTRY: ModuleConfig[] = [
  {
    key: "reputation_web_scan",
    label: "Reputation Intelligence / Web Scan",
    scopeKey: "monitor_public",
    driver: "orchestrator",
    cadenceMinutes: 24 * 60,
  },
  {
    key: "channel_watch",
    label: "Channel Watch",
    scopeKey: "monitor_verified_assets",
    driver: "self-cron",
    cadenceMinutes: 15,
  },
  {
    key: "copyright_distribution_monitor",
    label: "Copyright Distribution Monitor",
    scopeKey: "prepare_copyright",
    driver: "self-cron",
    cadenceMinutes: 6 * 60,
  },
  {
    key: "release_protection_sweep",
    label: "Release Protection Sweep",
    scopeKey: "prepare_copyright",
    driver: "self-cron",
    cadenceMinutes: 24 * 60,
  },
  {
    key: "deepfake_intel",
    label: "Deepfake Intelligence",
    scopeKey: "detect_face_misuse",
    driver: "orchestrator",
    cadenceMinutes: 24 * 60,
  },
  {
    key: "face_protection",
    label: "Face Protection",
    scopeKey: "detect_face_misuse",
    driver: "self-cron",
    cadenceMinutes: 24 * 60,
  },
  {
    key: "face_reference_extraction",
    label: "Face Reference Extraction",
    scopeKey: "detect_face_misuse",
    driver: "orchestrator",
    cadenceMinutes: 24 * 60,
  },
  {
    key: "copyright_intel",
    label: "Copyright / Protected-Asset Intelligence",
    scopeKey: "prepare_copyright",
    driver: "orchestrator",
    cadenceMinutes: 24 * 60,
  },
  {
    key: "youtube_removal",
    label: "YouTube Removal Discovery",
    scopeKey: "monitor_verified_assets",
    driver: "orchestrator",
    cadenceMinutes: 24 * 60,
  },
  {
    key: "narrative_intelligence",
    label: "Narrative Intelligence",
    scopeKey: "monitoring_reports",
    driver: "orchestrator",
    cadenceMinutes: 60,
  },
  {
    key: "evidence_prep",
    label: "Evidence Preparation",
    scopeKey: "collect_evidence",
    driver: "reactive",
    cadenceMinutes: 60,
  },
];

export function moduleConfig(key: string): ModuleConfig | undefined {
  return MODULE_REGISTRY.find((m) => m.key === key);
}

export interface ExistingEnrollmentRow {
  module_key: string;
  eligible: boolean;
}

/**
 * Pure per-module eligibility/scheduling decision, extracted from
 * enrollment.server.ts's upsert loop so it's directly unit-testable without
 * a live Supabase client. Behavior-preserving — enrollment.server.ts calls
 * this for the exact same patch it always computed inline. Only pushes
 * next_scan_at/current_status forward the first time a module becomes
 * eligible, so re-running enrollment never disturbs an in-flight scan or
 * queues a second initial run for the same module.
 */
export function computeEnrollmentPatch(
  mod: ModuleConfig,
  authActive: boolean,
  grantedScopeKeys: Set<string>,
  existing: ExistingEnrollmentRow | undefined,
  now: string = new Date().toISOString(),
): Record<string, unknown> {
  const eligible = authActive && grantedScopeKeys.has(mod.scopeKey);
  const becameNewlyEligible = eligible && !existing?.eligible;

  const patch: Record<string, unknown> = {
    module_key: mod.key,
    eligible,
    cadence_minutes: mod.cadenceMinutes,
  };
  if (becameNewlyEligible) {
    patch.next_scan_at = now;
    patch.current_status = "QUEUED";
    patch.blocked_reason = null;
  } else if (!existing) {
    patch.next_scan_at = eligible ? now : null;
    patch.current_status = eligible ? "QUEUED" : "WAITING_FOR_NEXT_SCAN";
  }
  return patch;
}

/** Shape of a scan_module_enrollments row (see the protection_orchestration migration). */
export interface ScanModuleEnrollment {
  id: string;
  user_id: string;
  profile_id: string;
  module_key: string;
  eligible: boolean;
  enabled: boolean;
  cadence_minutes: number;
  last_scan_at: string | null;
  next_scan_at: string | null;
  current_status: string;
  current_run_id: string | null;
  candidates_found: number;
  verified_findings: number;
  provider_failures: number;
  retry_count: number;
  blocked_reason: string | null;
  last_success_at: string | null;
}
