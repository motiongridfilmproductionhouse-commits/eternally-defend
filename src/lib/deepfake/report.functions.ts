import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Return a signed download URL for a Deepfake Threat Report.
 * Generates on demand from persisted scan findings for the selected
 * protected identity / scan. Never fabricates evidence.
 */
export const getDeepfakeReportUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        scanId: z.string().uuid().optional(),
        profileId: z.string().uuid().optional(),
        force: z.boolean().optional(),
      })
      .refine((value) => Boolean(value.scanId || value.profileId), {
        message: "Provide a scanId or profileId.",
      })
      .parse(raw),
  )
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
    });

    return {
      url: await signDeepfakeReportUrl(report.storageKey),
      fileName: report.fileName,
      generatedAt: report.generatedAt,
      reportId: report.reportId,
      scanId: report.scanId,
      profileId: report.profileId,
      findings: report.findings,
    };
  });
