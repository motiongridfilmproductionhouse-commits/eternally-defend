import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ScanReportPayload, ScanReportRow } from "@/lib/protection/report/types";

const REPORT_COLUMNS =
  "id, name, kind, status, pdf_url, findings_count, created_at, module_key, scan_id, run_started_at, run_completed_at, discovered_count, eligible_count, review_count, not_eligible_count";

/**
 * Scan report history for the signed-in account. Refreshes reports for the
 * account's most recent module runs first, so history is complete even for
 * runs that predate report generation. Read-only w.r.t. enforcement.
 */
export const listScanReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    try {
      const [{ supabaseAdmin }, { buildRecentScanReportsForUser }] = await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("@/lib/protection/report/build.server"),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await buildRecentScanReportsForUser(supabaseAdmin as any, userId);
    } catch (err) {
      console.error("[reports] refresh failed", err);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const { data, error } = await supabase
      .from("generated_reports")
      .select(REPORT_COLUMNS)
      .eq("user_id", userId)
      .not("module_key", "is", null)
      .order("run_started_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { reports: (data ?? []) as Omit<ScanReportRow, "payload">[] };
  });

export const getScanReport = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ reportId: z.string().uuid() }).parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;
    const { data: row, error } = await supabase
      .from("generated_reports")
      .select(`${REPORT_COLUMNS}, payload`)
      .eq("user_id", userId)
      .eq("id", data.reportId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Report not found");
    return {
      report: row as Omit<ScanReportRow, "payload"> & { payload: ScanReportPayload | null },
    };
  });
