/**
 * Real I/O adapters for the Face Reference Extraction pipeline — S3 for
 * protected_assets screenshots and screenshot-derived tile crops (same
 * bucket/pattern as asset-registration.functions.ts), Supabase Storage for
 * the deepfake-reference-faces bucket (same as face-filter.server.ts's
 * loadReferenceImages), and the existing indexDeepfakeReferenceFace +
 * deepfake_reference_faces insert (same as face-profile.functions.ts's
 * uploadDeepfakeReferenceFace) for promotion. Kept separate from
 * pipeline.server.ts so the pipeline itself stays fully unit-testable
 * without any network dependency.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3, getBucket } from "@/lib/aws/clients.server";
import { putObject, sha256Hex } from "@/lib/aws/s3.server";
import { indexDeepfakeReferenceFace } from "@/lib/deepfake/face-enrollment.server";

export async function downloadAssetBytes(storagePath: string): Promise<Uint8Array> {
  const object = await getS3().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: storagePath }),
  );
  if (!object.Body) throw new Error("Empty S3 object body");
  return new Uint8Array(await object.Body.transformToByteArray());
}

export async function uploadTileBytes(key: string, bytes: Uint8Array): Promise<void> {
  await putObject({ key, body: bytes, contentType: "image/jpeg" });
}

export function sha256(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}

/**
 * Reference faces manually uploaded via the Deepfake Intel UI live in
 * Supabase Storage (bucket "deepfake-reference-faces"), not S3 — see
 * src/lib/deepfake/face-profile.functions.ts's uploadDeepfakeReferenceFace
 * and src/lib/deepfake/face-filter.server.ts's loadReferenceImages, which
 * this mirrors.
 */
export async function downloadReferenceImageBytes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storagePath: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from("deepfake-reference-faces")
    .download(storagePath);
  if (error || !data) throw new Error(error?.message ?? "Reference image download failed");
  const buffer = await data.arrayBuffer();
  if (!buffer.byteLength) throw new Error("Reference image is empty");
  return new Uint8Array(buffer);
}

export async function promoteToReferenceFace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: {
    userId: string;
    profileId: string;
    tileBytes: Uint8Array;
    tileStorageKey: string;
    sourceAssetId: string;
    sourceTileId: string;
    faceConfidence: number | null;
    phash: string;
  },
): Promise<{ referenceId: string }> {
  const referenceFaceId = crypto.randomUUID();
  const indexed = await indexDeepfakeReferenceFace({
    imageBytes: input.tileBytes,
    targetProfileId: input.profileId,
    referenceFaceId,
  });

  const { data: record, error } = await supabaseAdmin
    .from("deepfake_reference_faces")
    .insert({
      id: referenceFaceId,
      profile_id: input.profileId,
      storage_path: input.tileStorageKey,
      rekognition_face_id: indexed.faceId,
      external_image_id: indexed.externalImageId,
      face_confidence: indexed.confidence,
      reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
      source_type: "SCREENSHOT_DERIVED",
      source_asset_id: input.sourceAssetId,
      source_tile_id: input.sourceTileId,
      phash: input.phash,
    })
    .select("id")
    .single();

  if (error || !record) {
    throw new Error(error?.message ?? "Failed to save screenshot-derived reference face.");
  }

  return { referenceId: record.id };
}
