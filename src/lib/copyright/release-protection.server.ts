/**
 * Release protection persistence and scheduled scan orchestration.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeMonitoringWindow,
  computeNextScanAt,
  formatCadenceLabel,
  meetsAutomaticMonitoringReferenceMinimum,
  monitoringCadenceMinutes,
  type ReferencePackage,
  type ReleaseProtectionSettings,
  validateReleaseProtectionSettings,
  calculateProtectionReadiness,
} from "@/lib/copyright/release-protection";

type ReleaseProtectionRow = {
  id: string;
  user_id: string;
  scan_id: string | null;
  title: string;
  settings: ReleaseProtectionSettings;
  reference_package: ReferencePackage;
  readiness_score: number;
  readiness_level: string;
  paused: boolean;
  monitoring_start_at: string | null;
  monitoring_end_at: string | null;
  next_scan_at: string | null;
  last_scan_at: string | null;
  last_scan_id: string | null;
  stats: Record<string, unknown>;
};

export async function createReleaseProtectionRecord(
  supabase: SupabaseClient,
  input: {
    userId: string;
    scanId: string;
    title: string;
    settings: ReleaseProtectionSettings;
    referencePackage: ReferencePackage;
  },
): Promise<ReleaseProtectionRow> {
  const errors = validateReleaseProtectionSettings(input.settings);
  if (errors.length) throw new Error(errors.join(" "));

  if (input.settings.enabled && !meetsAutomaticMonitoringReferenceMinimum(input.referencePackage)) {
    throw new Error(
      "Automatic monitoring requires at least 1 primary poster, 2 additional visual references, and 1 official trailer or approved video reference.",
    );
  }

  const readiness = calculateProtectionReadiness({
    settings: input.settings,
    referencePackage: input.referencePackage,
    metadataComplete: Boolean(input.settings.studio && input.settings.distributor),
  });

  if (
    input.settings.enabled &&
    readiness.level !== "strong" &&
    readiness.level !== "high_confidence"
  ) {
    throw new Error(
      `Protection readiness is ${readiness.level} (${readiness.score}%). Strong reference package required for automatic monitoring.`,
    );
  }

  const window = computeMonitoringWindow(input.settings.release_date);
  const customMinutes =
    input.settings.cadence_profile === "custom" ? input.settings.custom_cadence_minutes : undefined;
  const nextScanAt = input.settings.enabled
    ? computeNextScanAt(input.settings.release_date, Date.now(), customMinutes)
    : null;

  const { data, error } = await supabase
    .from("copyright_release_protection")
    .insert({
      user_id: input.userId,
      scan_id: input.scanId,
      title: input.title,
      settings: input.settings as never,
      reference_package: input.referencePackage as never,
      readiness_score: readiness.score,
      readiness_level: readiness.level,
      paused: false,
      monitoring_start_at: window.monitoring_start_at,
      monitoring_end_at: window.monitoring_end_at,
      next_scan_at: nextScanAt,
      stats: {
        cadence_minutes: monitoringCadenceMinutes(
          input.settings.release_date,
          Date.now(),
          customMinutes,
        ),
        cadence_label: formatCadenceLabel(
          monitoringCadenceMinutes(input.settings.release_date, Date.now(), customMinutes),
        ),
      },
    })
    .select("*")
    .single();

  if (error || !data)
    throw new Error(error?.message ?? "Could not create release protection record.");
  return data as unknown as ReleaseProtectionRow;
}

export async function listReleaseProtectionForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<ReleaseProtectionRow[]> {
  const { data, error } = await supabase
    .from("copyright_release_protection")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReleaseProtectionRow[];
}

export async function setReleaseProtectionPaused(
  supabase: SupabaseClient,
  input: { userId: string; protectionId: string; paused: boolean },
): Promise<void> {
  const { error } = await supabase
    .from("copyright_release_protection")
    .update({ paused: input.paused })
    .eq("id", input.protectionId)
    .eq("user_id", input.userId);
  if (error) throw new Error(error.message);
}

export async function scheduleReleaseProtectionScanNow(
  supabase: SupabaseClient,
  input: { userId: string; protectionId: string },
): Promise<{ scanId: string }> {
  const { data: row, error } = await supabase
    .from("copyright_release_protection")
    .select("*")
    .eq("id", input.protectionId)
    .eq("user_id", input.userId)
    .single();
  if (error || !row) throw new Error(error?.message ?? "Release protection not found.");

  const protection = row as unknown as ReleaseProtectionRow;
  const settings = protection.settings;
  if (!settings?.enabled) throw new Error("Release protection is not enabled.");

  const { data: scan, error: scanErr } = await supabase
    .from("copyright_scans")
    .insert({
      user_id: input.userId,
      title: protection.title,
      reference_kind: "image",
      storage_path: protection.reference_package.primary_poster_key ?? null,
      frame_paths: [
        protection.reference_package.primary_poster_key,
        ...protection.reference_package.additional_visual_keys,
      ].filter(Boolean),
      status: "queued",
      stats: {
        release_protection_id: protection.id,
        release_protection_run: true,
        release_date: settings.release_date,
        release_alt_titles: settings.alternate_titles ?? [],
        release_alert_threshold: settings.alert_threshold,
        pending_input: {
          contentType: "image/jpeg",
          keys: [
            protection.reference_package.primary_poster_key,
            ...protection.reference_package.additional_visual_keys,
          ].filter(Boolean),
        },
      },
    })
    .select("id")
    .single();
  if (scanErr || !scan) throw new Error(scanErr?.message ?? "Could not queue monitoring scan.");

  const scanId = scan.id as string;
  const scheduledFor = new Date().toISOString();

  const { data: runRow, error: runErr } = await supabase
    .from("release_monitor_runs")
    .insert({
      release_protection_id: protection.id,
      user_id: input.userId,
      scheduled_for: scheduledFor,
      started_at: scheduledFor,
      status: "running",
      scan_id: scanId,
    })
    .select("id")
    .single();
  if (runErr) throw new Error(runErr.message);

  const { dispatchCopyrightScanExecution } = await import("@/lib/copyright.functions");
  await dispatchCopyrightScanExecution(scanId, supabase);

  const customMinutes =
    settings.cadence_profile === "custom" ? settings.custom_cadence_minutes : undefined;
  await supabase
    .from("copyright_release_protection")
    .update({
      last_scan_at: scheduledFor,
      last_scan_id: scanId,
      next_scan_at: computeNextScanAt(settings.release_date, Date.now(), customMinutes),
    })
    .eq("id", protection.id);

  return { scanId };
}

/** Idempotent sweep for due release protection rows — server-side only. */
export async function runReleaseProtectionSweep(
  supabase: SupabaseClient,
  opts?: { limit?: number },
): Promise<{ scheduled: number; skipped: number }> {
  const limit = opts?.limit ?? 10;
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("copyright_release_protection")
    .select("*")
    .eq("paused", false)
    .lte("next_scan_at", nowIso)
    .limit(limit);
  if (error) throw new Error(error.message);

  let scheduled = 0;
  let skipped = 0;

  for (const row of due ?? []) {
    const protection = row as unknown as ReleaseProtectionRow;
    const settings = protection.settings;
    if (!settings?.enabled) {
      skipped += 1;
      continue;
    }

    const { data: inflight } = await supabase
      .from("release_monitor_runs")
      .select("id")
      .eq("release_protection_id", protection.id)
      .in("status", ["scheduled", "running"])
      .limit(1);
    if (inflight?.length) {
      skipped += 1;
      continue;
    }

    try {
      await scheduleReleaseProtectionScanNow(supabase, {
        userId: protection.user_id,
        protectionId: protection.id,
      });
      scheduled += 1;
    } catch {
      skipped += 1;
    }
  }

  return { scheduled, skipped };
}

export async function getReleaseProtectionDashboard(
  supabase: SupabaseClient,
  userId: string,
  protectionId?: string,
) {
  let query = supabase
    .from("copyright_release_protection")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (protectionId) query = query.eq("id", protectionId);

  const { data: protections, error } = await query.limit(protectionId ? 1 : 20);
  if (error) throw new Error(error.message);

  const ids = (protections ?? []).map((p) => p.id);
  const [runs, incidents] = await Promise.all([
    ids.length
      ? supabase
          .from("release_monitor_runs")
          .select("*")
          .in("release_protection_id", ids)
          .order("scheduled_for", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from("release_protection_incidents")
          .select("*")
          .in("release_protection_id", ids)
          .order("last_seen_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (runs.error) throw new Error(runs.error.message);
  if (incidents.error) throw new Error(incidents.error.message);

  return {
    protections: protections ?? [],
    runs: runs.data ?? [],
    incidents: incidents.data ?? [],
  };
}
