/**
 * Unified scan-report builder.
 *
 * Reads a completed module run plus its own finding rows, normalizes them,
 * classifies removal eligibility from data that already exists, and stores a
 * single snapshot row in generated_reports. Strictly read-only with respect
 * to enforcement: it never writes enforcement_cases, enforcement_jobs,
 * enforcement_requests, or contacts any external platform.
 */
import { moduleConfig } from "@/lib/protection/module-registry";
import {
  classifyDiscoveries,
  countByEligibility,
  domainOf,
  normalizeUrlKey,
  type EligibilityContext,
} from "./eligibility";
import {
  normalizeCopyrightMatch,
  normalizeDeepfakeFinding,
  normalizeScanHit,
  normalizeYoutubeRemovalFinding,
  type CopyrightMatchRow,
  type DeepfakeFindingRow,
  type ScanHitRow,
  type YoutubeRemovalFindingRow,
} from "./normalize";
import type { ReportDiscovery, ScanReportPayload } from "./types";

interface ModuleSource {
  runTable: string;
  runSelect: string;
  findingTable: string;
  findingSelect: string;
  startedAt: (run: Record<string, unknown>) => string | null;
  completedAt: (run: Record<string, unknown>) => string | null;
  normalize: (row: Record<string, unknown>) => ReportDiscovery;
}

const SOURCES: Record<string, ModuleSource> = {
  reputation_web_scan: {
    runTable: "scans",
    runSelect: "id, status, started_at, completed_at, created_at",
    findingTable: "scan_hits",
    findingSelect:
      "id, canonical_url, permalink, title, description, source, author, severity, risk_type, threat_score, risk_score, detected_at, created_at",
    startedAt: (r) => (r.started_at as string) ?? (r.created_at as string) ?? null,
    completedAt: (r) => (r.completed_at as string) ?? null,
    normalize: (row) => normalizeScanHit(row as unknown as ScanHitRow),
  },
  deepfake_intel: {
    runTable: "deepfake_scans",
    runSelect: "id, status, started_at, finished_at, created_at",
    findingTable: "deepfake_findings",
    findingSelect:
      "id, url, canonical_url, page_title, snippet, source_host, content_category, risk_level, confidence, is_synthetic, face_referenced, takedown_recommended, ai_reasoning, review_status, created_at",
    startedAt: (r) => (r.started_at as string) ?? (r.created_at as string) ?? null,
    completedAt: (r) => (r.finished_at as string) ?? null,
    normalize: (row) => normalizeDeepfakeFinding(row as unknown as DeepfakeFindingRow),
  },
  copyright_intel: {
    runTable: "copyright_scans",
    runSelect: "id, status, created_at, updated_at",
    findingTable: "copyright_matches",
    findingSelect:
      "id, source_url, page_title, platform, confidence, confidence_band, detection_type, ocr_text, reason, review_status, created_at",
    startedAt: (r) => (r.created_at as string) ?? null,
    completedAt: (r) =>
      r.status === "completed" || r.status === "failed" ? ((r.updated_at as string) ?? null) : null,
    normalize: (row) => normalizeCopyrightMatch(row as unknown as CopyrightMatchRow),
  },
  youtube_removal: {
    runTable: "youtube_removal_scans",
    runSelect: "id, status, created_at, updated_at",
    findingTable: "youtube_removal_findings",
    findingSelect:
      "id, video_url, title, channel_title, subject_status, channel_class, risk_level, recommended_action, assessment_reason, created_at",
    startedAt: (r) => (r.created_at as string) ?? null,
    completedAt: (r) =>
      r.status === "completed" || r.status === "failed" ? ((r.updated_at as string) ?? null) : null,
    normalize: (row) => normalizeYoutubeRemovalFinding(row as unknown as YoutubeRemovalFindingRow),
  },
};

export function isReportableModule(moduleKey: string): boolean {
  return moduleKey in SOURCES;
}

async function loadEligibilityContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  discoveries: ReportDiscovery[],
): Promise<EligibilityContext> {
  const caseByUrl = new Map<string, { status: string | null; details: string | null }>();
  const { data: cases } = await supabaseAdmin
    .from("enforcement_cases")
    .select("target_url, eligibility_status, eligibility_reason")
    .eq("user_id", userId);
  for (const row of cases ?? []) {
    const reason = (row.eligibility_reason ?? {}) as Record<string, unknown>;
    caseByUrl.set(normalizeUrlKey(row.target_url as string), {
      status: (row.eligibility_status as string) ?? null,
      details: typeof reason.details === "string" ? reason.details : null,
    });
  }

  const domains = Array.from(
    new Set(discoveries.map((d) => domainOf(d.sourceUrl)).filter((d) => d.length > 0)),
  );
  const verifiedRouteDomains = new Set<string>();
  if (domains.length > 0) {
    const { data: routes } = await supabaseAdmin
      .from("domain_enforcement_routes")
      .select("domain, verification_status")
      .in("domain", domains);
    for (const route of routes ?? []) {
      if (route.verification_status === "VERIFIED") {
        verifiedRouteDomains.add(String(route.domain).toLowerCase());
      }
    }
  }

  const { data: auth } = await supabaseAdmin
    .from("client_authorizations")
    .select("status, enforcement_enabled")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const authorizationActive = auth?.status === "ACTIVE" && auth?.enforcement_enabled !== false;

  const { count: verifiedAssets } = await supabaseAdmin
    .from("digital_assets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("verification_status", "VERIFIED");

  return {
    caseByUrl,
    verifiedRouteDomains,
    authorizationActive,
    assetOwnershipVerified: (verifiedAssets ?? 0) > 0,
  };
}

function runStatusLabel(raw: unknown, completedAt: string | null): string {
  const status = String(raw ?? "").toLowerCase();
  if (["completed", "complete", "done", "succeeded"].includes(status)) return "Completed";
  if (["failed", "error"].includes(status)) return "Failed";
  if (["running", "in_progress", "processing"].includes(status)) return "Running";
  if (["queued", "pending"].includes(status)) return "Started";
  return completedAt ? "Completed" : "Running";
}

/** Build (and upsert) the report for one specific module run. */
export async function buildScanReport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: { userId: string; moduleKey: string; scanId: string },
): Promise<ScanReportPayload | null> {
  const source = SOURCES[input.moduleKey];
  if (!source) return null;

  const { data: run } = await supabaseAdmin
    .from(source.runTable)
    .select(source.runSelect)
    .eq("id", input.scanId)
    .maybeSingle();
  if (!run) return null;

  const { data: findings } = await supabaseAdmin
    .from(source.findingTable)
    .select(source.findingSelect)
    .eq("scan_id", input.scanId);

  const discoveries = (findings ?? []).map((row: Record<string, unknown>) =>
    source.normalize(row),
  ) as ReportDiscovery[];
  const ctx = await loadEligibilityContext(supabaseAdmin, input.userId, discoveries);
  const classified = classifyDiscoveries(discoveries, ctx);
  const counts = countByEligibility(classified);

  const startedAt = source.startedAt(run as Record<string, unknown>);
  const completedAt = source.completedAt(run as Record<string, unknown>);
  const runStatus = runStatusLabel((run as Record<string, unknown>).status, completedAt);
  const label = moduleConfig(input.moduleKey)?.label ?? input.moduleKey;

  const payload: ScanReportPayload = {
    moduleKey: input.moduleKey,
    moduleLabel: label,
    scanId: input.scanId,
    runStatus,
    runStartedAt: startedAt,
    runCompletedAt: completedAt,
    discoveries: classified,
    counts,
  };

  const { data: existing } = await supabaseAdmin
    .from("generated_reports")
    .select("id")
    .eq("user_id", input.userId)
    .eq("module_key", input.moduleKey)
    .eq("scan_id", input.scanId)
    .maybeSingle();

  const row = {
    user_id: input.userId,
    name: `${label} — ${new Date(startedAt ?? Date.now()).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    kind: "Scan Report",
    status: runStatus === "Failed" ? "Failed" : runStatus === "Completed" ? "Ready" : "Generating",
    module_key: input.moduleKey,
    scan_id: input.scanId,
    run_started_at: startedAt,
    run_completed_at: completedAt,
    findings_count: counts.discovered,
    discovered_count: counts.discovered,
    eligible_count: counts.eligible,
    review_count: counts.review,
    not_eligible_count: counts.notEligible,
    payload,
  };

  if (existing?.id) {
    await supabaseAdmin.from("generated_reports").update(row).eq("id", existing.id);
  } else {
    await supabaseAdmin.from("generated_reports").insert(row);
  }
  return payload;
}

/**
 * Best-effort: after a module tick, build reports for every run of that
 * module created for this customer since the tick started. Never throws —
 * a reporting failure must not fail or retry a scan.
 */
export async function buildScanReportsForModuleTick(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: { userId: string; moduleKey: string; sinceIso: string },
): Promise<number> {
  const source = SOURCES[input.moduleKey];
  if (!source) return 0;
  try {
    const { data: runs } = await supabaseAdmin
      .from(source.runTable)
      .select("id")
      .eq("user_id", input.userId)
      .gte("created_at", input.sinceIso)
      .order("created_at", { ascending: false })
      .limit(10);
    let built = 0;
    for (const run of runs ?? []) {
      const result = await buildScanReport(supabaseAdmin, {
        userId: input.userId,
        moduleKey: input.moduleKey,
        scanId: run.id as string,
      });
      if (result) built += 1;
    }
    return built;
  } catch (err) {
    console.error("[protection:report] build failed", input.moduleKey, input.userId, err);
    return 0;
  }
}

/**
 * Backfill/refresh: build reports for this customer's most recent runs across
 * every reportable module. Bounded per module so it stays cheap enough to run
 * when the operator opens the reports screen. Read-only w.r.t. enforcement.
 */
export async function buildRecentScanReportsForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  runsPerModule = 5,
): Promise<number> {
  let built = 0;
  for (const [moduleKey, source] of Object.entries(SOURCES)) {
    try {
      const { data: runs } = await supabaseAdmin
        .from(source.runTable)
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(runsPerModule);
      for (const run of runs ?? []) {
        const result = await buildScanReport(supabaseAdmin, {
          userId,
          moduleKey,
          scanId: run.id as string,
        });
        if (result) built += 1;
      }
    } catch (err) {
      console.error("[protection:report] backfill failed", moduleKey, userId, err);
    }
  }
  return built;
}
