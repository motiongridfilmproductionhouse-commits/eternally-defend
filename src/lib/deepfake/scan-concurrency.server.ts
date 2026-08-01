/**
 * Concurrent deepfake scan prevention helpers.
 *
 * Application and database must normalize the target identity identically:
 * lower(btrim(target_name)) — do NOT collapse internal whitespace.
 */

/** Sentinel UUID used when profile_id is NULL in the active-scan unique index. */
export const NULL_PROFILE_SENTINEL =
  "00000000-0000-0000-0000-000000000000";

export function normalizeScanTargetName(targetName: string): string {
  return targetName.trim().toLowerCase();
}

export function normalizeProfileIdForIndex(
  profileId: string | null | undefined,
): string {
  return profileId ?? NULL_PROFILE_SENTINEL;
}

export function sameActiveScanIdentity(a: {
  user_id: string;
  profile_id?: string | null;
  target_name: string;
}, b: {
  user_id: string;
  profile_id?: string | null;
  target_name: string;
}): boolean {
  return (
    a.user_id === b.user_id &&
    normalizeProfileIdForIndex(a.profile_id) ===
      normalizeProfileIdForIndex(b.profile_id) &&
    normalizeScanTargetName(a.target_name) ===
      normalizeScanTargetName(b.target_name)
  );
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string };
  if (record.code === "23505") return true;
  return /duplicate key|unique constraint|deepfake_scans_one_active/i.test(
    record.message ?? "",
  );
}

export type ActiveScanRow = {
  id: string;
  user_id: string;
  profile_id?: string | null;
  target_name: string;
  status: string;
  started_at?: string | null;
  created_at?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
};

/**
 * Application-level guard: find a still-active running scan for the same
 * user/profile/target. Prefer the newest started_at.
 */
export async function findActiveScanForIdentity(input: {
  supabase: any;
  userId: string;
  profileId?: string | null;
  targetName: string;
}): Promise<ActiveScanRow | null> {
  const normalized = normalizeScanTargetName(input.targetName);

  let query = input.supabase
    .from("deepfake_scans")
    .select(
      "id, user_id, profile_id, target_name, status, started_at, created_at, lease_expires_at, heartbeat_at",
    )
    .eq("user_id", input.userId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(25);

  if (input.profileId) {
    query = query.eq("profile_id", input.profileId);
  } else {
    query = query.is("profile_id", null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const matches = ((data ?? []) as ActiveScanRow[]).filter(
    (row) => normalizeScanTargetName(row.target_name) === normalized,
  );

  return matches[0] ?? null;
}

export async function getActiveScanById(input: {
  supabase: any;
  scanId: string;
}): Promise<ActiveScanRow | null> {
  const { data, error } = await input.supabase
    .from("deepfake_scans")
    .select(
      "id, user_id, profile_id, target_name, status, started_at, created_at, lease_expires_at, heartbeat_at",
    )
    .eq("id", input.scanId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ActiveScanRow | null) ?? null;
}
