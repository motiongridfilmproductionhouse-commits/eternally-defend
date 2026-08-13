import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Company / brand protection metrics.
 *
 * Deliberately face-free: company accounts are protected through registered
 * assets, verified digital properties, deepfake/manipulated media findings,
 * copyright matches and stored evidence — never an enrolled human face.
 * Every number is a real aggregation over existing user-scoped tables.
 */
export const getCompanyProtectionStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [assets, verifiedAssets, deepfakes, copyright, evidence] = await Promise.all([
      supabase
        .from("protected_assets")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("active", true),
      supabase
        .from("digital_assets")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("verification_status", "VERIFIED"),
      supabase
        .from("deepfake_findings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", week),
      supabase
        .from("copyright_matches")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", week),
      supabase
        .from("evidence_vault_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

    return {
      protectedAssets: assets.count ?? 0,
      verifiedDigitalAssets: verifiedAssets.count ?? 0,
      deepfakeFindings7d: deepfakes.count ?? 0,
      copyrightMatches7d: copyright.count ?? 0,
      evidenceItems: evidence.count ?? 0,
    };
  });
