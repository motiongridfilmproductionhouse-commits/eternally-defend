import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Return a signed download URL for a scan's threat intelligence dossier, generating it on demand. */
export const getCopyrightReportUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { generateAndStoreCopyrightReport, attachReportToScanStats, signReportUrl } =
      await import("@/lib/copyright/report.server");
    const { supabase, userId } = context;

    const { data: scan, error } = await supabase
      .from("copyright_scans")
      .select("id, stats")
      .eq("id", data.scanId)
      .maybeSingle();
    if (error || !scan) throw new Error(error?.message ?? "Scan not found.");

    const stats = (scan.stats ?? {}) as Record<string, unknown>;
    const existing = (stats.threat_report ?? null) as Record<string, unknown> | null;
    const storageKey = typeof existing?.storage_key === "string" ? existing.storage_key : null;

    if (storageKey) {
      return {
        url: await signReportUrl(storageKey),
        fileName:
          typeof existing?.file_name === "string" ? existing.file_name : "eterna-report.pdf",
        generatedAt: typeof existing?.generated_at === "string" ? existing.generated_at : null,
      };
    }

    const report = await generateAndStoreCopyrightReport(supabase, data.scanId, userId);
    if (!report) throw new Error("This investigation has no evidence to report on yet.");
    await attachReportToScanStats(supabase, data.scanId, report);
    return {
      url: await signReportUrl(report.storageKey),
      fileName: report.fileName,
      generatedAt: report.generatedAt,
    };
  });
