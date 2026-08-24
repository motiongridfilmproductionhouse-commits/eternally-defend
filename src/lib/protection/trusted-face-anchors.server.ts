/**
 * Unified trusted-face-anchor lookup, shared by every dispatcher that needs
 * to know "does this customer have an identity to compare screenshots
 * against, and if so where do the bytes live." Two legitimate sources exist
 * in production and neither is more or less trusted than the other for
 * comparison purposes:
 *
 *  SOURCE A — Face Protection / AWS Face Liveness enrollment:
 *    protected_face_profiles.status = 'FACE_VERIFIED', backed by ACTIVE
 *    protected_faces rows (src/lib/onboarding/face-enrollment-core.server.ts,
 *    src/lib/face-protection/protected-face-registry.ts).
 *
 *  SOURCE B — manual Deepfake Intel enrollment:
 *    deepfake_target_profiles -> deepfake_reference_faces
 *    (src/lib/deepfake/face-profile.functions.ts).
 *
 * Every query here is scoped from `userId` down — this file is the single
 * place that decides "what counts as a trusted anchor for this user," so
 * every dispatcher that reuses it inherits the same tenant isolation
 * automatically instead of re-implementing (and potentially getting wrong)
 * its own version of this check.
 */

export type TrustedAnchorSource = "FACE_PROTECTION" | "DEEPFAKE_PROFILE";

/**
 * Reuses the existing deepfake_reference_faces.reference_tier vocabulary —
 * a liveness-verified anchor is exactly what that tier's name already
 * describes, so no new persisted tier is introduced. Source A anchors don't
 * persist a tier value anywhere (protected_faces has no such column); this
 * is purely a runtime label attached when normalizing the two sources.
 */
export type TrustedAnchorTier =
  "CANONICAL_VERIFIED_REFERENCE" | "APPROVED_SECONDARY_REFERENCE" | "SCREENSHOT_DERIVED_REFERENCE";

export type AnchorRetrieval =
  | { kind: "s3"; bucket: string; key: string }
  | { kind: "deepfake_reference_storage"; path: string };

export interface TrustedFaceAnchor {
  source: TrustedAnchorSource;
  tier: TrustedAnchorTier;
  /** protected_faces.id or deepfake_reference_faces.id — never the raw Rekognition face id. */
  referenceId: string;
  trusted: true;
  retrieval: AnchorRetrieval;
}

export interface TrustedFaceAnchorResult {
  anchors: TrustedFaceAnchor[];
  /** Present only when a deepfake_target_profiles row already exists for this user. */
  deepfakeTargetProfileId: string | null;
}

export function hasTrustedAnchor(result: TrustedFaceAnchorResult): boolean {
  return result.anchors.length > 0;
}

const TIER_PRIORITY: Record<TrustedAnchorTier, number> = {
  CANONICAL_VERIFIED_REFERENCE: 0,
  APPROVED_SECONDARY_REFERENCE: 1,
  SCREENSHOT_DERIVED_REFERENCE: 2,
};

/** Canonical-first ordering, stable otherwise. Callers typically slice() the front for a comparison batch. */
export function orderAnchorsByTrust(anchors: TrustedFaceAnchor[]): TrustedFaceAnchor[] {
  return [...anchors].sort((a, b) => TIER_PRIORITY[a.tier] - TIER_PRIORITY[b.tier]);
}

/**
 * Read-only. Never inserts, updates, or deletes protected_face_profiles,
 * protected_faces, deepfake_target_profiles, or deepfake_reference_faces —
 * every query below is scoped by the caller-supplied userId, so one
 * customer's lookup can never return another customer's rows.
 */
export async function getTrustedFaceAnchorsForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
): Promise<TrustedFaceAnchorResult> {
  const [{ data: faceProfile }, { data: activeFaces }, { data: targetProfile }] = await Promise.all(
    [
      supabaseAdmin
        .from("protected_face_profiles")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("protected_faces")
        .select("id, s3_bucket, s3_key, status")
        .eq("user_id", userId)
        .eq("status", "ACTIVE"),
      supabaseAdmin
        .from("deepfake_target_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle(),
    ],
  );

  const anchors: TrustedFaceAnchor[] = [];

  if (faceProfile?.status === "FACE_VERIFIED") {
    for (const face of (activeFaces ?? []) as Array<{
      id: string;
      s3_bucket: string | null;
      s3_key: string | null;
      status: string;
    }>) {
      if (!face.s3_bucket || !face.s3_key) continue;
      anchors.push({
        source: "FACE_PROTECTION",
        tier: "CANONICAL_VERIFIED_REFERENCE",
        referenceId: face.id,
        trusted: true,
        retrieval: { kind: "s3", bucket: face.s3_bucket, key: face.s3_key },
      });
    }
  }

  let deepfakeTargetProfileId: string | null = null;
  if (targetProfile) {
    deepfakeTargetProfileId = targetProfile.id;
    const { data: refFaces } = await supabaseAdmin
      .from("deepfake_reference_faces")
      .select("id, storage_path, reference_tier")
      .eq("profile_id", targetProfile.id);
    for (const ref of (refFaces ?? []) as Array<{
      id: string;
      storage_path: string | null;
      reference_tier: string | null;
    }>) {
      if (!ref.storage_path) continue;
      anchors.push({
        source: "DEEPFAKE_PROFILE",
        tier: (ref.reference_tier as TrustedAnchorTier) ?? "APPROVED_SECONDARY_REFERENCE",
        referenceId: ref.id,
        trusted: true,
        retrieval: { kind: "deepfake_reference_storage", path: ref.storage_path },
      });
    }
  }

  return { anchors, deepfakeTargetProfileId };
}

/**
 * The one mutating operation in this module, and it's deliberately narrow:
 * find-or-create a deepfake_target_profiles row so a liveness-only customer
 * (Source A anchor, no Source B row) has somewhere valid to attach a
 * promoted screenshot-derived reference — deepfake_reference_faces.profile_id
 * is a NOT NULL foreign key into this table. This does not create or infer
 * any face data; the face being promoted has already independently cleared
 * the >=95% comparison against the customer's own liveness anchor before
 * this is ever called. Idempotent: always checks for an existing row first,
 * so re-running never creates a duplicate profile, and the existing manual
 * "Create Target Profile" Deepfake Intel workflow is untouched — a customer
 * who already has a row (created either way) always gets that same row id
 * back.
 */
export async function ensureDeepfakeTargetProfileForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  targetName: string,
): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("deepfake_target_profiles")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { getDeepfakeFaceCollectionId } = await import("@/lib/deepfake/face-enrollment.server");
  const { data: created, error } = await supabaseAdmin
    .from("deepfake_target_profiles")
    .insert({
      user_id: userId,
      target_name: targetName,
      authorization_status: "testing",
      rekognition_collection_id: getDeepfakeFaceCollectionId(),
    })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(error?.message ?? "Failed to create bridging deepfake target profile.");
  }
  return created.id;
}
