/**
 * Face Protection status sync. There is no independent Face Protection
 * scan in this codebase — face-matching only happens as a side effect of
 * Reputation/Web Scan (analyzeHitForFaces, already automated) and, after
 * the Channel Watch fix in analysis.server.ts, Channel Watch video analysis.
 * This module mirrors those real results rather than running a scan of
 * its own, matching the "self-cron" pattern already used for Channel Watch.
 *
 * "Does this customer have a verified face reference" is answered from EITHER
 * real production chain:
 *   1. onboarding liveness enrollment: protected_face_profiles.status =
 *      'FACE_VERIFIED' (optionally with active protected_faces rows), or
 *   2. manual Deepfake Intel enrollment: user_id ->
 *      deepfake_target_profiles -> deepfake_reference_faces.
 * Checking only (2) reported NO_VERIFIED_FACE_REFERENCE for accounts that
 * completed onboarding face liveness.
 */
export interface FaceProtectionSync {
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

/** True when the account has any verified face reference from either enrollment path. */
export async function hasVerifiedFaceReference(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
): Promise<boolean> {
  const [{ data: faceProfile }, { count: activeFaces }, { data: targetProfile }] =
    await Promise.all([
      supabaseAdmin
        .from("protected_face_profiles")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("protected_faces")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "ACTIVE"),
      supabaseAdmin
        .from("deepfake_target_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  if (faceProfile?.status === "FACE_VERIFIED") return true;
  if ((activeFaces ?? 0) > 0) return true;

  if (targetProfile) {
    const { count } = await supabaseAdmin
      .from("deepfake_reference_faces")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", targetProfile.id);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

export async function syncFaceProtectionForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
): Promise<FaceProtectionSync> {
  const hasReferenceFace = await hasVerifiedFaceReference(supabaseAdmin, userId);

  if (!hasReferenceFace) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_VERIFIED_FACE_REFERENCE",
    };
  }


  const { data: events } = await supabaseAdmin
    .from("face_match_events")
    .select("id, review_status")
    .eq("user_id", userId);
  const rows = events ?? [];
  const confirmed = rows.filter(
    (e: { review_status: string }) => e.review_status === "threat_created",
  );

  return {
    status: "COMPLETED",
    candidates_found: rows.length,
    verified_findings: confirmed.length,
    blocked_reason: null,
  };
}
