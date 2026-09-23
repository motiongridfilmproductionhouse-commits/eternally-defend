/**
 * Client-facing view of a delivered pre-enrollment package.
 *
 * Reads through the client's own RLS-scoped session: a client only ever sees
 * packages and imported findings linked to their own account. Imported
 * findings are for review — they never start enforcement.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface PreEnrollmentSummary {
  delivered: boolean;
  prospectScanIds: string[];
  findings: Array<{
    id: string;
    prospect_scan_id: string;
    stage_key: string;
    category: string;
    source_url: string;
    platform: string | null;
    title: string | null;
    finding_state: string;
    review_status: string;
    evidence_count: number;
  }>;
}

export const getMyPreEnrollmentSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PreEnrollmentSummary> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const [{ data: pkgs }, { data: rows }] = await Promise.all([
      db
        .from("prospect_enrollment_packages")
        .select("scan_id")
        .eq("client_user_id", context.userId),
      db
        .from("client_prospect_findings")
        .select(
          "id, prospect_scan_id, stage_key, category, source_url, platform, title, finding_state, review_status, evidence_refs",
        )
        .eq("client_user_id", context.userId)
        .order("created_at", { ascending: true })
        .limit(200),
    ]);
    return {
      delivered: (pkgs ?? []).length > 0,
      prospectScanIds: (pkgs ?? []).map((p: { scan_id: string }) => p.scan_id),
      findings: (rows ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        prospect_scan_id: String(r.prospect_scan_id),
        stage_key: String(r.stage_key),
        category: String(r.category),
        source_url: String(r.source_url),
        platform: (r.platform as string | null) ?? null,
        title: (r.title as string | null) ?? null,
        finding_state: String(r.finding_state),
        review_status: String(r.review_status),
        evidence_count: Array.isArray(r.evidence_refs) ? r.evidence_refs.length : 0,
      })),
    };
  });
