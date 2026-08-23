/**
 * Central recurring-scan orchestrator. Cron hits this on a fixed interval;
 * it claims due scan_module_enrollments rows and, per module, either runs
 * the scan itself ("orchestrator" driver — Reputation, Deepfake, Copyright,
 * YouTube Removal, Narrative Intelligence), mirrors status from a module
 * that already has its own dedicated recurring hook or byproduct data
 * ("self-cron" — Channel Watch, Distribution Monitor, Release Protection
 * Sweep, Face Protection), mirrors evidence/case counts produced by other
 * modules' qualifying findings ("reactive" — Evidence Prep), or honestly
 * marks the module as not yet automated. No module is ever reported as
 * running/monitoring unless real work actually happened.
 */
import { createFileRoute } from "@tanstack/react-router";
import { moduleConfig } from "@/lib/protection/module-registry";
import { STALE_CLAIM_MINUTES, buildDueRowFilter } from "@/lib/protection/claim";
import {
  authorizeCronRequest,
  cronAuthResponse,
  requireTrustedRuntime,
} from "@/lib/protection/cron-auth.server";

const BATCH_SIZE = 20;

async function runReputationWebScan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
): Promise<{
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}> {
  const [{ data: profile }, { data: assets }] = await Promise.all([
    supabaseAdmin.from("protection_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("digital_assets").select("*").eq("user_id", userId),
  ]);
  if (!profile) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_PROTECTION_PROFILE",
    };
  }

  const { data: aliasRows } = await supabaseAdmin
    .from("protection_profile_aliases")
    .select("alias")
    .eq("profile_id", profile.id)
    .eq("active", true);

  const query = (profile.display_name || profile.verified_name || "").trim();
  if (!query) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_SUBJECT_NAME",
    };
  }

  const aliasNames = (aliasRows ?? [])
    .map((a: { alias: string }) => a.alias)
    .filter((a: string) => a && a.toLowerCase() !== query.toLowerCase());

  const handles: string[] = [];
  for (const a of assets ?? []) {
    if (a.handle) handles.push(String(a.handle).replace(/^@/, ""));
  }
  for (const s of Array.isArray(profile.official_socials) ? profile.official_socials : []) {
    const handle = (s as Record<string, unknown>)?.handle;
    if (typeof handle === "string" && handle.trim()) handles.push(handle.replace(/^@/, ""));
  }

  const publicBase = process.env.PUBLIC_APP_URL ?? "https://eternally-defend.lovable.app";

  let report: import("@/routes/api/scan").ReputationReport;
  try {
    const res = await fetch(`${publicBase}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        aliases: aliasNames.slice(0, 20),
        handles: Array.from(new Set(handles)).slice(0, 20),
        monthFilter: "30d",
      }),
    });
    if (!res.ok) {
      return {
        status: "PROVIDER_LIMITED",
        candidates_found: 0,
        verified_findings: 0,
        blocked_reason: `scan_http_${res.status}`,
      };
    }
    report = await res.json();
  } catch (err) {
    return {
      status: "PROVIDER_LIMITED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: (err as Error).message.slice(0, 200),
    };
  }

  if (!report?.ok) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: report?.error?.slice(0, 200) ?? "SCAN_FAILED",
    };
  }

  try {
    const { persistScanCore } = await import("@/lib/scans.functions");
    const { mapReputationReportToPersistInput } = await import("@/lib/scan/persist-mapping");
    await persistScanCore(supabaseAdmin, userId, mapReputationReportToPersistInput(report));
  } catch (err) {
    console.error("[scan-orchestrator] persist failed", userId, err);
    return {
      status: "PARTIAL",
      candidates_found: report.totals?.total ?? 0,
      verified_findings: 0,
      blocked_reason: "PERSIST_FAILED",
    };
  }

  return {
    status: "COMPLETED",
    candidates_found: report.totals?.total ?? 0,
    verified_findings: (report.totals?.critical ?? 0) + (report.totals?.high ?? 0),
    blocked_reason: null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncChannelWatch(supabaseAdmin: any, userId: string) {
  const { data: watches } = await supabaseAdmin
    .from("channel_watches")
    .select("status, last_checked_at, next_check_at")
    .eq("user_id", userId);
  const rows = watches ?? [];
  if (rows.length === 0) {
    return { status: "WAITING_FOR_NEXT_SCAN", candidates_found: 0, verified_findings: 0 };
  }
  const lastChecked = rows
    .map((r: { last_checked_at: string | null }) => r.last_checked_at)
    .filter(Boolean)
    .sort()
    .pop();
  return {
    status: lastChecked ? "COMPLETED" : "QUEUED",
    candidates_found: rows.length,
    verified_findings: 0,
    last_scan_at: lastChecked ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncDistributionMonitor(supabaseAdmin: any, userId: string) {
  const { data: sources } = await supabaseAdmin
    .from("distribution_sources")
    .select("incident_count, last_checked_at")
    .eq("user_id", userId);
  const rows = sources ?? [];
  const lastChecked = rows
    .map((r: { last_checked_at: string | null }) => r.last_checked_at)
    .filter(Boolean)
    .sort()
    .pop();
  return {
    status: rows.length ? "COMPLETED" : "WAITING_FOR_NEXT_SCAN",
    candidates_found: rows.length,
    verified_findings: rows.reduce(
      (sum: number, r: { incident_count: number }) => sum + (r.incident_count ?? 0),
      0,
    ),
    last_scan_at: lastChecked ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncFaceProtection(supabaseAdmin: any, userId: string) {
  const { syncFaceProtectionForUser } =
    await import("@/lib/protection/dispatch/face-protection.server");
  const outcome = await syncFaceProtectionForUser(supabaseAdmin, userId);
  return {
    status: outcome.status,
    candidates_found: outcome.candidates_found,
    verified_findings: outcome.verified_findings,
    blocked_reason: outcome.blocked_reason,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncEvidencePrep(supabaseAdmin: any, userId: string) {
  const [{ count: evidenceCount }, { count: caseCount }] = await Promise.all([
    supabaseAdmin
      .from("automated_finding_evidence")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabaseAdmin
      .from("enforcement_cases")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);
  return {
    status: "COMPLETED",
    candidates_found: evidenceCount ?? 0,
    verified_findings: caseCount ?? 0,
    blocked_reason: null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncReleaseProtectionSweep(supabaseAdmin: any, userId: string) {
  const { data: runs } = await supabaseAdmin
    .from("release_monitor_runs")
    .select("candidates_found, incidents_created, completed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = runs ?? [];
  if (rows.length === 0) {
    return { status: "WAITING_FOR_NEXT_SCAN", candidates_found: 0, verified_findings: 0 };
  }
  return {
    status: rows[0].completed_at ? "COMPLETED" : "RUNNING",
    candidates_found: rows.reduce(
      (sum: number, r: { candidates_found: number }) => sum + (r.candidates_found ?? 0),
      0,
    ),
    verified_findings: rows.reduce(
      (sum: number, r: { incidents_created: number }) => sum + (r.incidents_created ?? 0),
      0,
    ),
    last_scan_at: rows[0].completed_at ?? null,
  };
}

export const Route = createFileRoute("/api/public/hooks/scan-orchestrator")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Privileged job: needs the managed backend admin credential, which
        // exists only in the Lovable-managed server runtime. Fail loudly
        // (503) rather than throwing an opaque 500 elsewhere.
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;

        // Accepts a dedicated env secret, Vercel Cron's CRON_SECRET, or the
        // managed scheduler token in internal_cron_secrets (pg_cron path).
        const auth = await authorizeCronRequest(request, {
          jobName: "scan_orchestrator",
          envSecrets: [process.env.SCAN_ORCHESTRATOR_SECRET, process.env.CRON_SECRET],
        });
        if (!auth.ok) return cronAuthResponse(auth);

        // scan_module_enrollments/protection_profiles are new tables not yet
        // reflected in the generated Database type until the migration is
        // applied and types are regenerated — cast, matching this codebase's
        // existing convention for tables ahead of codegen (see
        // src/lib/enforcement/worker.ts).
        const mod = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const supabaseAdmin = mod.supabaseAdmin as any;

        // Idempotent enrollment reconciliation: every customer with an ACTIVE
        // authorization and a protection profile must have module enrollment
        // rows for the orchestrator to claim. enrollEligibleModules never
        // resets a running enrollment and never duplicates rows.
        let enrolled_users = 0;
        try {
          const { data: activeProfiles } = await supabaseAdmin
            .from("protection_profiles")
            .select("id, user_id")
            .limit(200);
          const { enrollEligibleModules } = await import("@/lib/protection/enrollment.server");
          for (const p of activeProfiles ?? []) {
            const { count } = await supabaseAdmin
              .from("scan_module_enrollments")
              .select("id", { count: "exact", head: true })
              .eq("user_id", p.user_id);
            if ((count ?? 0) > 0) continue;
            await enrollEligibleModules(p.user_id, p.id);
            // enrollEligibleModules is a no-op when the customer has no
            // authorization record — count only real enrollments, never a
            // hopeful one (no fabricated activation states).
            const { count: after } = await supabaseAdmin
              .from("scan_module_enrollments")
              .select("id", { count: "exact", head: true })
              .eq("user_id", p.user_id);
            if ((after ?? 0) > 0) enrolled_users += 1;
          }
        } catch (err) {
          console.error("[scan-orchestrator] enrollment reconciliation failed", err);
        }

        const nowIso = new Date().toISOString();

        // Rows stuck at RUNNING/QUEUED because a prior worker crashed or
        // timed out mid-dispatch (after claiming, before the final status
        // write) are reclaimable once stale — otherwise one crash would
        // permanently disable automatic scanning for that customer+module
        // (duplicate-safety audit finding; see claim.ts).
        const staleCutoffIso = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
        const { data: due } = await supabaseAdmin
          .from("scan_module_enrollments")
          .select("*")
          .eq("enabled", true)
          .eq("eligible", true)
          .lte("next_scan_at", nowIso)
          .or(buildDueRowFilter(staleCutoffIso))
          .limit(BATCH_SIZE);

        const results: Array<{ id: string; module_key: string; ok: boolean; status?: string }> = [];

        for (const row of due ?? []) {
          // Optimistic claim — skip if another tick already grabbed it.
          // Also pins updated_at to the exact value just read: a stale
          // RUNNING/QUEUED row being reclaimed has the same current_status
          // before and after a successful claim (RUNNING -> RUNNING), so
          // current_status alone can't detect a second concurrent claimant —
          // updated_at changes on every successful write (existing
          // trg_scan_module_enrollments_updated trigger), so pinning it
          // restores real mutual exclusion for the reclaim path too
          // (duplicate-safety audit finding).
          const { data: claimed } = await supabaseAdmin
            .from("scan_module_enrollments")
            .update({ current_status: "RUNNING" })
            .eq("id", row.id)
            .eq("current_status", row.current_status)
            .eq("updated_at", row.updated_at)
            .select()
            .maybeSingle();
          if (!claimed) continue;

          const cfg = moduleConfig(row.module_key);
          const cadence = cfg?.cadenceMinutes ?? row.cadence_minutes ?? 1440;
          const nextScanAt = new Date(Date.now() + cadence * 60_000).toISOString();

          const tickStartedAt = new Date(Date.now() - 60_000).toISOString();

          try {
            if (cfg?.driver === "orchestrator") {

              let outcome: {
                status: string;
                candidates_found: number;
                verified_findings: number;
                blocked_reason: string | null;
              };

              if (row.module_key === "reputation_web_scan") {
                outcome = await runReputationWebScan(supabaseAdmin, row.user_id);
              } else {
                // Deepfake/Copyright/YouTube Removal/Narrative all need the
                // customer's canonical protection profile as input.
                const { data: profile } = await supabaseAdmin
                  .from("protection_profiles")
                  .select("*")
                  .eq("user_id", row.user_id)
                  .maybeSingle();
                if (!profile) {
                  outcome = {
                    status: "FAILED",
                    candidates_found: 0,
                    verified_findings: 0,
                    blocked_reason: "NO_PROTECTION_PROFILE",
                  };
                } else if (row.module_key === "deepfake_intel") {
                  const { runDeepfakeIntelForUser } =
                    await import("@/lib/protection/dispatch/deepfake.server");
                  outcome = await runDeepfakeIntelForUser(supabaseAdmin, row.user_id, profile);
                } else if (row.module_key === "copyright_intel") {
                  const { runCopyrightIntelForUser } =
                    await import("@/lib/protection/dispatch/copyright.server");
                  outcome = await runCopyrightIntelForUser(supabaseAdmin, row.user_id, cadence);
                } else if (row.module_key === "youtube_removal") {
                  const { runYoutubeRemovalForUser } =
                    await import("@/lib/protection/dispatch/youtube-removal.server");
                  outcome = await runYoutubeRemovalForUser(supabaseAdmin, row.user_id, profile);
                } else if (row.module_key === "narrative_intelligence") {
                  const { runNarrativeIntelForUser } =
                    await import("@/lib/protection/dispatch/narrative.server");
                  outcome = await runNarrativeIntelForUser(supabaseAdmin, row.user_id);
                } else {
                  outcome = {
                    status: "WAITING_FOR_NEXT_SCAN",
                    candidates_found: 0,
                    verified_findings: 0,
                    blocked_reason: "NOT_AUTOMATED_YET",
                  };
                }
              }

              // Persistent, per-run scan report. Best effort and read-only
              // with respect to enforcement — a reporting failure can never
              // fail or retry the scan itself.
              try {
                const { buildScanReportsForModuleTick, isReportableModule } =
                  await import("@/lib/protection/report/build.server");
                if (isReportableModule(row.module_key)) {
                  await buildScanReportsForModuleTick(supabaseAdmin, {
                    userId: row.user_id,
                    moduleKey: row.module_key,
                    sinceIso: tickStartedAt,
                  });
                }
              } catch (reportErr) {
                console.error("[scan-orchestrator] report build failed", row.id, reportErr);
              }

              await supabaseAdmin
                .from("scan_module_enrollments")
                .update({

                  current_status: outcome.status,
                  candidates_found: outcome.candidates_found,
                  verified_findings: outcome.verified_findings,
                  blocked_reason: outcome.blocked_reason,
                  last_scan_at: nowIso,
                  last_success_at: outcome.status === "COMPLETED" ? nowIso : row.last_success_at,
                  next_scan_at: nextScanAt,
                  retry_count: outcome.status === "COMPLETED" ? 0 : row.retry_count + 1,
                  provider_failures:
                    outcome.status === "PROVIDER_LIMITED"
                      ? row.provider_failures + 1
                      : row.provider_failures,
                })
                .eq("id", row.id);
              results.push({
                id: row.id,
                module_key: row.module_key,
                ok: true,
                status: outcome.status,
              });
            } else if (cfg?.driver === "self-cron") {
              const sync =
                row.module_key === "channel_watch"
                  ? await syncChannelWatch(supabaseAdmin, row.user_id)
                  : row.module_key === "copyright_distribution_monitor"
                    ? await syncDistributionMonitor(supabaseAdmin, row.user_id)
                    : row.module_key === "face_protection"
                      ? await syncFaceProtection(supabaseAdmin, row.user_id)
                      : await syncReleaseProtectionSweep(supabaseAdmin, row.user_id);
              await supabaseAdmin
                .from("scan_module_enrollments")
                .update({
                  current_status: sync.status,
                  candidates_found: sync.candidates_found,
                  verified_findings: sync.verified_findings,
                  blocked_reason:
                    (sync as { blocked_reason?: string | null }).blocked_reason ?? null,
                  last_scan_at:
                    (sync as { last_scan_at?: string | null }).last_scan_at ?? row.last_scan_at,
                  last_success_at: sync.status === "COMPLETED" ? nowIso : row.last_success_at,
                  next_scan_at: nextScanAt,
                })
                .eq("id", row.id);
              results.push({
                id: row.id,
                module_key: row.module_key,
                ok: true,
                status: sync.status,
              });
            } else if (cfg?.driver === "reactive") {
              const sync = await syncEvidencePrep(supabaseAdmin, row.user_id);
              await supabaseAdmin
                .from("scan_module_enrollments")
                .update({
                  current_status: sync.status,
                  candidates_found: sync.candidates_found,
                  verified_findings: sync.verified_findings,
                  next_scan_at: nextScanAt,
                  last_scan_at: nowIso,
                  last_success_at: nowIso,
                })
                .eq("id", row.id);
              results.push({
                id: row.id,
                module_key: row.module_key,
                ok: true,
                status: sync.status,
              });
            } else {
              // not-yet-automated: honest placeholder, never fake progress.
              await supabaseAdmin
                .from("scan_module_enrollments")
                .update({
                  current_status: "WAITING_FOR_NEXT_SCAN",
                  blocked_reason: "NOT_AUTOMATED_YET",
                  next_scan_at: nextScanAt,
                })
                .eq("id", row.id);
              results.push({
                id: row.id,
                module_key: row.module_key,
                ok: true,
                status: "WAITING_FOR_NEXT_SCAN",
              });
            }
          } catch (err) {
            console.error("[scan-orchestrator] row failed", row.id, row.module_key, err);
            await supabaseAdmin
              .from("scan_module_enrollments")
              .update({
                current_status: "FAILED",
                blocked_reason: (err as Error).message?.slice(0, 200) ?? "UNKNOWN_ERROR",
                retry_count: row.retry_count + 1,
                next_scan_at: new Date(Date.now() + 15 * 60_000).toISOString(),
              })
              .eq("id", row.id);
            results.push({ id: row.id, module_key: row.module_key, ok: false });
          }
        }

        return Response.json({ processed: results.length, enrolled_users, results });
      },
    },
  },
});
