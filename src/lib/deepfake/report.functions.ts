import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ScopeInput = z
  .object({
    scanId: z.string().uuid().optional(),
    profileId: z.string().uuid().optional(),
    force: z.boolean().optional(),
    reportMode: z.enum(["final", "interim"]).optional(),
  })
  .refine((value) => Boolean(value.scanId || value.profileId), {
    message: "Provide a scanId or profileId.",
  });

/**
 * Return a signed download URL for a Deepfake Threat Report.
 * Generates on demand from persisted scan findings for the selected
 * protected identity / scan. Never fabricates evidence.
 */
export const getDeepfakeReportUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => ScopeInput.parse(raw))
  .handler(async ({ data, context }) => {
    const {
      generateAndStoreDeepfakeReport,
      signDeepfakeReportUrl,
    } = await import("@/lib/deepfake/report.server");
    const { supabase, userId } = context;

    const report = await generateAndStoreDeepfakeReport(supabase, userId, {
      scanId: data.scanId,
      profileId: data.profileId,
      force: data.force,
      reportMode: data.reportMode,
    });

    return {
      url: await signDeepfakeReportUrl(report.storageKey),
      fileName: report.fileName,
      generatedAt: report.generatedAt,
      reportId: report.reportId,
      scanId: report.scanId,
      profileId: report.profileId,
      findings: report.findings,
      reportMode: report.reportMode,
      historyId: report.historyId,
    };
  });

/** List Ready deepfake reports for the selected scan/profile. */
export const listDeepfakeReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        scanId: z.string().uuid().optional(),
        profileId: z.string().uuid().optional(),
      })
      .refine((value) => Boolean(value.scanId || value.profileId), {
        message: "Provide a scanId or profileId.",
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { listDeepfakeReportHistory } = await import(
      "@/lib/deepfake/report.server"
    );
    return listDeepfakeReportHistory(context.supabase, context.userId, {
      scanId: data.scanId,
      profileId: data.profileId,
    });
  });

/** Download an existing report history PDF by id. */
export const downloadDeepfakeReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({ historyId: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const {
      downloadDeepfakeReportByHistoryId,
      signDeepfakeReportUrl,
    } = await import("@/lib/deepfake/report.server");

    const report = await downloadDeepfakeReportByHistoryId(
      context.supabase,
      context.userId,
      data.historyId,
    );

    return {
      url: await signDeepfakeReportUrl(report.storageKey),
      fileName: report.fileName,
      generatedAt: report.generatedAt,
      reportId: report.reportId,
      reportMode: report.reportMode,
      findings: report.findings,
      historyId: report.historyId,
    };
  });
