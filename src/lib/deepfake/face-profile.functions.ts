import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceScanSubject } from "@/lib/security/protected-subject.server";
import { DeleteFacesCommand } from "@aws-sdk/client-rekognition";
import { getRekognitionClient } from "@/lib/aws/rekognition-client.server";
import { getDeepfakeFaceCollectionId, indexDeepfakeReferenceFace } from "./face-enrollment.server";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const CreateProfileInput = z.object({
  target_name: z.string().trim().min(1).max(200),
  authorization_status: z.enum(["testing", "authorized"]).default("testing"),
});

const UploadReferenceInput = z.object({
  profile_id: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  image_base64: z.string().min(1),
});

const DeleteReferenceInput = z.object({
  profile_id: z.string().uuid(),
  reference_face_id: z.string().uuid(),
});

const ProfileInput = z.object({
  profile_id: z.string().uuid(),
});

function decodeBase64Image(value: string): Uint8Array {
  const cleanValue = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;

  const buffer = Buffer.from(cleanValue, "base64");

  if (!buffer.length) {
    throw new Error("Uploaded image is empty.");
  }

  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error("Uploaded image exceeds the 10 MB limit.");
  }

  return new Uint8Array(buffer);
}

function safeFilename(filename: string): string {
  const extension =
    filename
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";

  return `${crypto.randomUUID()}.${extension}`;
}

async function assertOwnedProfile(supabase: any, userId: string, profileId: string) {
  const { data, error } = await supabase
    .from("deepfake_target_profiles")
    .select("*")
    .eq("id", profileId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("Target profile was not found or is not accessible.");
  }

  return data;
}

export const createDeepfakeTargetProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // SUBJECT ISOLATION — face profiles can only be created for the registered subject.
    const enforcedSubject = await enforceScanSubject(context, { targetName: data.target_name });
    data.target_name = enforcedSubject.targetName;


    const { data: profile, error } = await supabase
      .from("deepfake_target_profiles")
      .insert({
        user_id: userId,
        target_name: data.target_name,
        authorization_status: data.authorization_status,
        rekognition_collection_id: getDeepfakeFaceCollectionId(),
      })
      .select("*")
      .single();

    if (error || !profile) {
      throw new Error(error?.message ?? "Failed to create target profile.");
    }

    return profile;
  });

export const listDeepfakeTargetProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("deepfake_target_profiles")
      .select(
        `
          *,
          deepfake_reference_faces (
            id,
            storage_path,
            rekognition_face_id,
            external_image_id,
            face_confidence,
            created_at
          )
        `,
      )
      .eq("user_id", userId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw new Error(error.message);
    }

    return data ?? [];
  });

export const getDeepfakeTargetProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProfileInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile, error } = await supabase
      .from("deepfake_target_profiles")
      .select(
        `
            *,
            deepfake_reference_faces (
              id,
              storage_path,
              rekognition_face_id,
              external_image_id,
              face_confidence,
              created_at
            )
          `,
      )
      .eq("id", data.profile_id)
      .eq("user_id", userId)
      .single();

    if (error || !profile) {
      throw new Error(error?.message ?? "Target profile was not found.");
    }

    return profile;
  });

export const uploadDeepfakeReferenceFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UploadReferenceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    await assertOwnedProfile(supabase, userId, data.profile_id);

    const imageBytes = decodeBase64Image(data.image_base64);

    const referenceFaceId = crypto.randomUUID();

    const storagePath = `${userId}/${data.profile_id}/` + `${safeFilename(data.filename)}`;

    const { error: uploadError } = await supabase.storage
      .from("deepfake-reference-faces")
      .upload(storagePath, imageBytes, {
        contentType: data.content_type,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Reference image upload failed: ${uploadError.message}`);
    }

    try {
      const indexed = await indexDeepfakeReferenceFace({
        imageBytes,
        targetProfileId: data.profile_id,
        referenceFaceId,
      });

      const { data: record, error: insertError } = await supabase
        .from("deepfake_reference_faces")
        .insert({
          id: referenceFaceId,
          profile_id: data.profile_id,
          storage_path: storagePath,
          rekognition_face_id: indexed.faceId,
          external_image_id: indexed.externalImageId,
          face_confidence: indexed.confidence,
        })
        .select("*")
        .single();

      if (insertError || !record) {
        await getRekognitionClient().send(
          new DeleteFacesCommand({
            CollectionId: indexed.collectionId,
            FaceIds: [indexed.faceId],
          }),
        );

        throw new Error(insertError?.message ?? "Failed to save reference face.");
      }

      return {
        ...record,
        collection_id: indexed.collectionId,
      };
    } catch (error) {
      await supabase.storage.from("deepfake-reference-faces").remove([storagePath]);

      throw error;
    }
  });

export const deleteDeepfakeReferenceFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteReferenceInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    await assertOwnedProfile(supabase, userId, data.profile_id);

    const { data: reference, error } = await supabase
      .from("deepfake_reference_faces")
      .select("*")
      .eq("id", data.reference_face_id)
      .eq("profile_id", data.profile_id)
      .single();

    if (error || !reference) {
      throw new Error("Reference face was not found.");
    }

    if (reference.rekognition_face_id) {
      try {
        await getRekognitionClient().send(
          new DeleteFacesCommand({
            CollectionId: getDeepfakeFaceCollectionId(),
            FaceIds: [reference.rekognition_face_id],
          }),
        );
      } catch (awsError) {
        console.warn("[DEEPFAKE:FACE] Failed to delete Rekognition face:", awsError);
      }
    }

    if (reference.storage_path) {
      await supabase.storage.from("deepfake-reference-faces").remove([reference.storage_path]);
    }

    const { error: deleteError } = await supabase
      .from("deepfake_reference_faces")
      .delete()
      .eq("id", reference.id)
      .eq("profile_id", data.profile_id);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return {
      deleted: true,
      id: reference.id,
    };
  });
