import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getReleaseProtectionDashboard,
  listReleaseProtectionForUser,
  scheduleReleaseProtectionScanNow,
  setReleaseProtectionPaused,
} from "@/lib/copyright/release-protection.server";
import { MONITORING_DISCLAIMER, type ReleaseProtectionSettings } from "@/lib/copyright/release-protection";

function serializeProtectionRow(row: {
  id: string;
  user_id: string;
  scan_id: string | null;
  title: string;
  settings: ReleaseProtectionSettings;
  reference_package: {
    primary_poster_key?: string;
    additional_visual_keys: string[];
    video_reference_keys: string[];
  };
  readiness_score: number;
  readiness_level: string;
  paused: boolean;
  monitoring_start_at: string | null;
  monitoring_end_at: string | null;
  next_scan_at: string | null;
  last_scan_at: string | null;
  last_scan_id: string | null;
  stats: {
    cadence_minutes?: number;
    cadence_label?: string;
  };
}) {
  return {
    id: row.id,
    user_id: row.user_id,
    scan_id: row.scan_id,
    title: row.title,
    settings: row.settings,
    reference_package: {
      primary_poster_key: row.reference_package.primary_poster_key ?? null,
      additional_visual_keys: row.reference_package.additional_visual_keys ?? [],
      video_reference_keys: row.reference_package.video_reference_keys ?? [],
    },
    readiness_score: row.readiness_score,
    readiness_level: row.readiness_level,
    paused: row.paused,
    monitoring_start_at: row.monitoring_start_at,
    monitoring_end_at: row.monitoring_end_at,
    next_scan_at: row.next_scan_at,
    last_scan_at: row.last_scan_at,
    last_scan_id: row.last_scan_id,
    stats: {
      cadence_minutes:
        typeof row.stats.cadence_minutes === "number" ? row.stats.cadence_minutes : null,
      cadence_label: typeof row.stats.cadence_label === "string" ? row.stats.cadence_label : null,
    },
  };
}

export const getReleaseProtection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({ protectionId: z.string().uuid().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }) => {
    const dashboard = await getReleaseProtectionDashboard(
      context.supabase,
      context.userId,
      data.protectionId,
    );
    return {
      protections: (dashboard.protections ?? []).map((row) =>
        serializeProtectionRow(row as never),
      ),
      runs: dashboard.runs ?? [],
      incidents: dashboard.incidents ?? [],
      disclaimer: MONITORING_DISCLAIMER,
    };
  });

export const listReleaseProtection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await listReleaseProtectionForUser(context.supabase, context.userId);
    return {
      protections: rows.map((row) => serializeProtectionRow(row as never)),
      disclaimer: MONITORING_DISCLAIMER,
    };
  });

export const pauseReleaseProtection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({ protectionId: z.string().uuid(), paused: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await setReleaseProtectionPaused(context.supabase, {
      userId: context.userId,
      protectionId: data.protectionId,
      paused: data.paused,
    });
    return { ok: true };
  });

export const runReleaseProtectionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({ protectionId: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const result = await scheduleReleaseProtectionScanNow(context.supabase, {
      userId: context.userId,
      protectionId: data.protectionId,
    });
    return result;
  });
