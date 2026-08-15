import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deriveAssetStatus, type SocialStatus } from "./status";

export interface SocialAssetStatusRow {
  id: string;
  name: string;
  kind: string | null;
  status: SocialStatus;
  label: string;
  reason: string | null;
  platform: string | null;
  import_method: string | null;
  source_post_url: string | null;
  created_at: string;
}

/**
 * Owner-scoped status list for socially sourced protected assets (link import
 * or manual upload). Read-only: it never enrolls, activates, or enforces.
 */
export const listSocialProtectedAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [{ data: assets, error }, { data: profile }, { data: targets }] = await Promise.all([
      supabase
        .from("protected_assets")
        .select("id,name,kind,phash,dhash,ahash,metadata,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("protection_profiles")
        .select("status,paused,auto_scan_enabled")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("protection_targets")
        .select("target_ref,label,active")
        .eq("user_id", userId)
        .eq("target_kind", "asset"),
    ]);
    if (error) throw new Error(error.message);

    const activeRefs = new Set(
      ((targets ?? []) as Array<{ target_ref: string | null; active: boolean | null }>)
        .filter((t) => t.active !== false)
        .map((t) => t.target_ref ?? ""),
    );
    const activeLabels = new Set(
      ((targets ?? []) as Array<{ label: string | null; active: boolean | null }>)
        .filter((t) => t.active !== false)
        .map((t) => t.label ?? ""),
    );

    const rows: SocialAssetStatusRow[] = [];
    for (const asset of (assets ?? []) as Array<Record<string, any>>) {
      const provenance = (asset.metadata?.provenance ?? null) as Record<string, any> | null;
      if (!provenance?.import_method) continue;
      const view = deriveAssetStatus({
        fingerprinted: Boolean(asset.phash || asset.dhash || asset.ahash),
        hasTarget: activeRefs.has(asset.id) || activeLabels.has(asset.name ?? ""),
        profileStatus: (profile?.status ?? null) as string | null,
        profilePaused: profile?.paused ?? null,
        autoScanEnabled: profile?.auto_scan_enabled ?? null,
      });
      rows.push({
        id: asset.id,
        name: asset.name,
        kind: asset.kind ?? null,
        status: view.status,
        label: view.label,
        reason: view.reason,
        platform: provenance.source_platform ?? null,
        import_method: provenance.import_method ?? null,
        source_post_url: provenance.source_post_url ?? null,
        created_at: asset.created_at,
      });
    }
    return { assets: rows };
  });
