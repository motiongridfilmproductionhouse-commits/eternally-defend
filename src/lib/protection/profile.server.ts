/**
 * Builds/updates the canonical protected-subject profile from data already
 * verified during onboarding. Never asks the client to re-enter anything;
 * only aggregates client_profiles, digital_assets, authorization_scopes, and
 * the latest client_authorizations row. Uses the service-role client
 * directly so it can run from server hooks/cron with no live user session.
 *
 * Deliberately carries no face-reference column or reference of any kind —
 * production schema inspection confirmed public.protected_face_profiles
 * does not exist (a tracked migration for it was apparently never applied).
 * Face-reference storage for Deepfake/Face Protection lives entirely in
 * deepfake_target_profiles/deepfake_reference_faces (keyed by user_id), kept
 * separate from this table — see src/lib/protection/dispatch/deepfake.server.ts
 * and face-protection.server.ts.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ProtectionProfileResult {
  profileId: string;
  userId: string;
}

/**
 * protection_profiles pre-existed in production (9 real customer rows) with
 * only (user_id, status) before this table was upgraded to the canonical
 * schema — status values seen: 'ACTIVE' | 'PENDING_AUTHORIZATION'. The new
 * protection_status column is only populated once buildOrUpdateProtectionProfile
 * runs for that user; until then it's null for legacy rows. Never overwrites
 * or destroys the legacy `status` column — this only computes a display
 * value, preferring the new column and falling back to a mapped legacy
 * value so pre-migration rows don't show as blank/unknown.
 */
export function effectiveProtectionStatus(
  row: { protection_status?: string | null; status?: string | null } | null | undefined,
): string | null {
  if (!row) return null;
  if (row.protection_status) return row.protection_status;
  if (row.status === "ACTIVE") return "ACTIVE";
  if (row.status) return "INACTIVE";
  return null;
}

export async function buildOrUpdateProtectionProfile(
  userId: string,
): Promise<ProtectionProfileResult | null> {
  // protection_profiles/protection_profile_aliases are new tables not yet
  // reflected in the generated Database type until the migration is applied
  // and types are regenerated — cast, matching this codebase's existing
  // convention for tables ahead of codegen (see src/lib/enforcement/worker.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const [{ data: profile }, { data: assets }, { data: auth }] = await Promise.all([
    db.from("client_profiles").select("*").eq("user_id", userId).maybeSingle(),
    db.from("digital_assets").select("*").eq("user_id", userId),
    db
      .from("client_authorizations")
      .select("id, status")
      .eq("user_id", userId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!profile) return null;

  const socialAssets = (assets ?? []).filter((a: { kind?: string }) => a.kind === "social_account");
  const declaredSocials = socialAssets.map((a: Record<string, unknown>) => ({
    platform: (a.metadata as Record<string, unknown> | null)?.platform ?? a.kind,
    url: a.channel_url ?? a.handle ?? null,
    handle: a.handle ?? null,
    source: "digital_asset",
  }));
  const existingSocials = Array.isArray(profile.official_socials) ? profile.official_socials : [];
  const officialSocials = [...existingSocials, ...declaredSocials];

  const patch = {
    user_id: userId,
    client_id: profile.client_id ?? null,
    authorization_id: auth?.id ?? null,
    verified_name: profile.legal_name ?? profile.full_name ?? null,
    display_name: profile.display_name ?? profile.legal_name ?? profile.full_name ?? null,
    profession_category: profile.onboarding_account_type ?? profile.client_type ?? null,
    country: profile.country ?? null,
    official_website: profile.website ?? null,
    official_socials: officialSocials,
    protection_status: auth?.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
    source_onboarding_version: profile.onboarding_version ?? "v1",
  };

  const { data: row, error } = await db
    .from("protection_profiles")
    .upsert(patch, { onConflict: "user_id" })
    .select("id")
    .single();
  if (error || !row) {
    console.error("[protection] buildOrUpdateProtectionProfile failed", error);
    return null;
  }

  const aliasCandidates = new Set<string>();
  for (const v of [
    profile.legal_name,
    profile.full_name,
    profile.display_name,
    profile.company_name,
  ]) {
    const trimmed = typeof v === "string" ? v.trim() : "";
    if (trimmed) aliasCandidates.add(trimmed);
  }

  await db.from("protection_profile_aliases").delete().eq("profile_id", row.id);
  if (aliasCandidates.size > 0) {
    await db.from("protection_profile_aliases").insert(
      Array.from(aliasCandidates).map((alias) => ({
        profile_id: row.id,
        alias,
        alias_type: "name_variation",
        active: true,
      })),
    );
  }

  return { profileId: row.id, userId };
}
