import {
  PROTECTED_FACE_ACTIVE,
  filterActiveProtectedFaces,
  type ProtectedFaceLike,
} from "./protected-face-registry";

type MinimalSupabase = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/**
 * Resolves the Rekognition collection and the ACTIVE protected faces that the
 * server-side monitoring pipeline may compare candidates against.
 *
 * The collection is resolved from the registry first and falls back to the
 * onboarding face profile, so a user enrolled via onboarding is always
 * monitorable.
 */
export async function resolveActiveFaceMonitoring(
  supabase: MinimalSupabase,
  userId: string,
): Promise<{
  collectionId: string | null;
  activeFaces: ProtectedFaceLike[];
  activeFaceIds: string[];
}> {
  const { data: faces } = await supabase
    .from("protected_faces")
    .select("id,user_id,face_id,collection_id,status")
    .eq("user_id", userId)
    .eq("status", PROTECTED_FACE_ACTIVE);

  const activeFaces = filterActiveProtectedFaces((faces ?? []) as ProtectedFaceLike[]).filter(
    (f) => f.user_id === userId,
  );

  let collectionId: string | null = activeFaces[0]?.collection_id ?? null;

  if (!collectionId) {
    const { data: registry } = await supabase
      .from("rekognition_collections")
      .select("collection_id")
      .eq("user_id", userId)
      .maybeSingle();
    collectionId = registry?.collection_id ?? null;
  }

  if (!collectionId) {
    const { data: profile } = await supabase
      .from("protected_face_profiles")
      .select("collection_id,status")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile?.status === "FACE_VERIFIED") collectionId = profile.collection_id ?? null;
  }

  return {
    collectionId,
    activeFaces,
    activeFaceIds: activeFaces.map((f) => f.face_id),
  };
}
