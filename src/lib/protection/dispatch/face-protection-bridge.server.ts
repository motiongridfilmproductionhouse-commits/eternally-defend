/**
 * Bridges a Path C admin-confirmed protected-asset identity anchor
 * (identity-bootstrap-core.server.ts's confirmIdentityCandidateClusterCore)
 * into Face Protection's own enrollment state — reusing the EXACT same
 * infrastructure a genuine AWS Face Liveness completion already sets up
 * (the rekognition_collections registry + an ACTIVE protected_faces row),
 * so the existing automatic monitoring sweep (src/lib/face-scan.server.ts's
 * analyzeHitForFaces, via resolveActiveFaceMonitoring) and Channel Watch
 * pick it up immediately with zero changes to either. This is deliberately
 * NOT a second face-scanning requirement — it indexes the SAME representative
 * tile image the admin already confirmed, once, via IndexFaces.
 *
 * Never claims liveness occurred: protected_face_profiles.status is set to
 * the distinct FACE_VERIFIED_VIA_PROTECTED_ASSET value, never FACE_VERIFIED,
 * and a profile that's already genuinely FACE_VERIFIED (real liveness) is
 * never touched, downgraded, or overwritten by this path.
 */
export interface FaceProtectionActivationDeps {
  ensureCollection?: (userId: string) => Promise<string>;
  indexFace?: (opts: {
    collectionId: string;
    bytes: Uint8Array;
    externalImageId: string;
  }) => Promise<
    Array<{
      faceId: string;
      imageId?: string | null;
      externalImageId?: string | null;
      confidence?: number | null;
      boundingBox?: unknown;
    }>
  >;
  getBucket?: () => string;
}

export interface FaceProtectionActivationInput {
  userId: string;
  tileBytes: Uint8Array;
  tileStorageKey: string;
  /** The deepfake_reference_faces row id this activation is derived from — stored so revocation can find and deactivate the resulting protected_faces row. */
  referenceFaceId: string;
  faceConfidence: number | null;
  label: string;
}

export interface FaceProtectionActivationResult {
  activated: boolean;
  reason?: "ALREADY_LIVENESS_VERIFIED" | "NO_FACE_INDEXED";
  protectedFaceId?: string;
}

export async function activateFaceProtectionFromProtectedAssetReference(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: FaceProtectionActivationInput,
  deps: FaceProtectionActivationDeps = {},
): Promise<FaceProtectionActivationResult> {
  const rekognition = await import("@/lib/aws/rekognition.server");
  const s3 = await import("@/lib/aws/s3.server");
  const ensureCollection = deps.ensureCollection ?? rekognition.ensureCollection;
  const indexFace = deps.indexFace ?? rekognition.indexFace;
  const getBucket = deps.getBucket ?? s3.getBucket;

  // A genuine liveness-verified profile is never touched by this path —
  // Path C is a fallback for accounts with no liveness, not a replacement.
  const { data: existingProfile } = await supabaseAdmin
    .from("protected_face_profiles")
    .select("status")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existingProfile?.status === "FACE_VERIFIED") {
    return { activated: false, reason: "ALREADY_LIVENESS_VERIFIED" };
  }

  const collectionId = await ensureCollection(input.userId);
  const faces = await indexFace({
    collectionId,
    bytes: input.tileBytes,
    externalImageId: `user_${input.userId.replace(/-/g, "")}_protected_asset`,
  });
  if (faces.length === 0) return { activated: false, reason: "NO_FACE_INDEXED" };

  const { buildProtectedAssetAdminConfirmedFaceRow } =
    await import("@/lib/face-protection/protected-face-registry");
  const face = faces[0];
  const verifiedAt = new Date().toISOString();
  const row = buildProtectedAssetAdminConfirmedFaceRow({
    userId: input.userId,
    collectionId,
    faceId: face.faceId,
    imageId: face.imageId ?? null,
    externalImageId: face.externalImageId ?? null,
    confidence: face.confidence ?? input.faceConfidence,
    boundingBox: face.boundingBox ?? null,
    s3Bucket: getBucket(),
    s3Key: input.tileStorageKey,
    label: input.label,
    verifiedAt,
    linkedReferenceFaceId: input.referenceFaceId,
  });

  const { data: existingFace } = await supabaseAdmin
    .from("protected_faces")
    .select("id")
    .eq("user_id", input.userId)
    .eq("face_id", face.faceId)
    .maybeSingle();

  let protectedFaceId: string;
  if (existingFace) {
    await supabaseAdmin
      .from("protected_faces")
      .update(row)
      .eq("id", existingFace.id)
      .eq("user_id", input.userId);
    protectedFaceId = existingFace.id;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("protected_faces")
      .insert(row)
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to save protected face reference.");
    }
    protectedFaceId = inserted.id;
  }

  await supabaseAdmin.from("rekognition_collections").upsert(
    { user_id: input.userId, collection_id: collectionId, status: "active" },
    {
      onConflict: "user_id",
    },
  );

  await supabaseAdmin.from("protected_face_profiles").upsert(
    {
      user_id: input.userId,
      collection_id: collectionId,
      status: "FACE_VERIFIED_VIA_PROTECTED_ASSET",
      enrollment_date: verifiedAt,
      failure_code: null,
      failure_reason: null,
      failure_at: null,
    },
    { onConflict: "user_id" },
  );

  return { activated: true, protectedFaceId };
}
