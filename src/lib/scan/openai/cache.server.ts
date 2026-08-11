/**
 * Deterministic cache for OpenAI reasoning verdicts, keyed by evidence hash.
 * Best-effort: any failure simply means the analysis runs again.
 */

import type { ReasoningVerdict } from "./types";

export function createReasoningCache() {
  return {
    async get(hash: string): Promise<ReasoningVerdict | null> {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("scan_ai_analysis_cache")
        .select("verdict")
        .eq("evidence_hash", hash)
        .maybeSingle();
      if (error || !data?.verdict) return null;
      return data.verdict as unknown as ReasoningVerdict;
    },
    async set(hash: string, verdict: ReasoningVerdict): Promise<void> {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("scan_ai_analysis_cache")
        .upsert(
          { evidence_hash: hash, verdict: verdict as unknown as never },
          { onConflict: "evidence_hash" },
        );
    },
  };
}
