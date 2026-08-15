/**
 * Enroll a freshly fingerprinted protected asset into Protection Autopilot.
 *
 * Deliberately conservative: only fingerprinted assets are enrolled, and only
 * when the user already has an ACTIVE, unpaused protection profile. It never
 * changes matching thresholds, enforcement flags, or cadence policy — it just
 * creates/refreshes the `asset` target the existing sweep already understands.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEFAULT_CADENCE_MINUTES } from "./autopilot";

type Client = any;

export interface EnrollResult {
  enrolled: boolean;
  target_id: string | null;
  reason: string | null;
}

export async function enrollAssetInAutopilot(
  supabase: Client,
  userId: string,
  asset: { id: string; name: string; phash?: string | null; dhash?: string | null; ahash?: string | null },
): Promise<EnrollResult> {
  if (!(asset.phash || asset.dhash || asset.ahash)) {
    return { enrolled: false, target_id: null, reason: "asset_not_fingerprinted" };
  }

  const { data: profile } = await supabase
    .from("protection_profiles")
    .select("status,paused,auto_scan_enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) return { enrolled: false, target_id: null, reason: "no_protection_profile" };
  if (profile.status !== "ACTIVE")
    return { enrolled: false, target_id: null, reason: "profile_not_active" };
  if (profile.paused || !profile.auto_scan_enabled)
    return { enrolled: false, target_id: null, reason: "profile_paused" };

  const label = (asset.name || "Protected asset").slice(0, 200);
  const { data: existing } = await supabase
    .from("protection_targets")
    .select("id")
    .eq("user_id", userId)
    .eq("target_kind", "asset")
    .eq("label", label)
    .maybeSingle();

  const patch = {
    user_id: userId,
    target_kind: "asset" as const,
    target_ref: asset.id,
    label,
    cadence_minutes: DEFAULT_CADENCE_MINUTES.asset,
    active: true,
    next_run_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await supabase.from("protection_targets").update(patch).eq("id", existing.id);
    return { enrolled: true, target_id: existing.id, reason: null };
  }

  const { data: inserted, error } = await supabase
    .from("protection_targets")
    .insert(patch)
    .select("id")
    .maybeSingle();
  if (error) return { enrolled: false, target_id: null, reason: error.message };
  return { enrolled: true, target_id: inserted?.id ?? null, reason: null };
}
