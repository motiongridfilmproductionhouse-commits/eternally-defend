/**
 * Web Scan — durable persistence of every pipeline stage.
 *
 * Writes one row per scan run plus one row per candidate lead (including
 * excluded ones with their reason code) so coverage loss is auditable.
 */

import type { ScanPipelineFunnel } from "./pipeline-funnel";
import type { IdentityTier } from "./identity-confidence";

export interface PersistLeadInput {
  url: string;
  canonicalUrl: string;
  title: string | null;
  source: string | null;
  platform: string | null;
  query: string | null;
  stage: "discovered" | "extracted" | "verified" | "needs_review" | "excluded";
  identity_tier: IdentityTier;
  identity_confidence: number;
  matched_signals: string[];
  failed_signals: string[];
  exclusion_reason: string | null;
  extractor: string | null;
  page_excerpt: string | null;
  severity: string | null;
  threat_score: number | null;
  /** PIPELINE (default) or OPENAI_RESEARCH when the query came from the AI layer. */
  query_origin?: "PIPELINE" | "OPENAI_RESEARCH";
  ai_content_type?: string | null;
  ai_reputation_risk?: string | null;
  ai_subject_confidence?: number | null;
  ai_evidence_confidence?: number | null;
  ai_recommended_action?: string | null;
  ai_evidence_basis?: string | null;
  ai_reasoning_summary?: string | null;
}


export async function persistScanRun(input: {
  query: string;
  aliases: string[];
  sources: string[];
  funnel: ScanPipelineFunnel;
  leads: PersistLeadInput[];
}): Promise<{ runId: string | null; error?: string }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: run, error } = await supabaseAdmin
      .from("web_scan_runs")
      .insert({
        query: input.query,
        aliases: input.aliases,
        sources: input.sources,
        funnel: input.funnel as unknown as never,
      })
      .select("id")
      .single();
    if (error || !run) return { runId: null, error: error?.message ?? "insert failed" };

    const rows = input.leads.slice(0, 2000).map((lead) => ({
      run_id: run.id,
      url: lead.url.slice(0, 2000),
      canonical_url: lead.canonicalUrl.slice(0, 2000),
      title: lead.title?.slice(0, 400) ?? null,
      source: lead.source,
      platform: lead.platform,
      query: lead.query?.slice(0, 300) ?? null,
      stage: lead.stage,
      identity_tier: lead.identity_tier,
      identity_confidence: lead.identity_confidence,
      matched_signals: lead.matched_signals,
      failed_signals: lead.failed_signals,
      exclusion_reason: lead.exclusion_reason,
      extractor: lead.extractor,
      page_excerpt: lead.page_excerpt?.slice(0, 4000) ?? null,
      severity: lead.severity,
      threat_score: lead.threat_score,
    }));

    if (rows.length) {
      const { error: leadErr } = await supabaseAdmin.from("web_scan_leads").insert(rows);
      if (leadErr) return { runId: run.id, error: leadErr.message };
    }
    return { runId: run.id };
  } catch (e) {
    return { runId: null, error: e instanceof Error ? e.message : "persist failed" };
  }
}
