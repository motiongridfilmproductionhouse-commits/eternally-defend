import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ensureCollectionForUser(userId: string, supabase: {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: string) => {
        maybeSingle: () => Promise<{ data: { collection_id: string } | null; error: unknown }>;
      };
    };
    upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: unknown }>;
    update: (row: Record<string, unknown>) => { eq: (col: string, v: string) => Promise<{ error: unknown }> };
  };
}) {
  const { ensureCollection } = await import("./aws/rekognition.server");
  const collectionId = await ensureCollection(userId);
  await supabase.from("rekognition_collections").upsert(
    { user_id: userId, collection_id: collectionId, status: "active" },
    { onConflict: "user_id" },
  );
  return collectionId;
}

export const ensureClientCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collectionId = await ensureCollectionForUser(userId, supabase as any);
    return { ok: true, collectionId };
  });

const ImportAccountInput = z.object({ discoveredAccountId: z.string().uuid() });

export const importOfficialAccountFaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImportAccountInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: acct, error } = await supabase
      .from("discovered_accounts")
      .select("id,platform,handle,profile_url,avatar_url,thumbnails")
      .eq("id", data.discoveredAccountId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!acct) throw new Error("Account not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collectionId = await ensureCollectionForUser(userId, supabase as any);
    const { fetchImageBytes, putObject, getBucket } = await import("./aws/s3.server");
    const { indexFace } = await import("./aws/rekognition.server");

    const urls: string[] = [];
    if (acct.avatar_url) urls.push(acct.avatar_url);
    const thumbs = Array.isArray(acct.thumbnails) ? (acct.thumbnails as unknown[]).filter((t): t is string => typeof t === "string") : [];
    for (const t of thumbs.slice(0, 4)) if (!urls.includes(t)) urls.push(t);

    const bucket = getBucket();
    let indexed = 0;
    const errors: string[] = [];

    for (const url of urls) {
      const img = await fetchImageBytes(url);
      if (!img) { errors.push(`skip ${url} (unreachable / not an image)`); continue; }
      const key = `clients/${userId}/reference/discovered/${acct.id}/${crypto.randomUUID()}`;
      try {
        await putObject({ key, body: img.bytes, contentType: img.contentType, metadata: { source: url.slice(0, 512) } });
        const externalImageId = `da_${acct.id.replace(/-/g, "")}`.slice(0, 255);
        const faces = await indexFace({ collectionId, bytes: img.bytes, externalImageId });
        for (const f of faces) {
          await supabase.from("protected_faces").insert({
            user_id: userId,
            collection_id: collectionId,
            discovered_account_id: acct.id,
            platform: acct.platform,
            label: acct.handle ?? null,
            source_url: url,
            s3_bucket: bucket,
            s3_key: key,
            face_id: f.faceId,
            image_id: f.imageId ?? null,
            external_image_id: f.externalImageId ?? externalImageId,
            confidence: f.confidence ?? null,
            bounding_box: f.boundingBox ?? null,
          });
          indexed++;
        }
        if (faces.length === 0) errors.push(`no face detected in ${url}`);
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message}`);
      }
    }

    if (indexed > 0) {
      const { count } = await supabase
        .from("protected_faces").select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      await supabase.from("rekognition_collections").update({ face_count: count ?? 0 }).eq("user_id", userId);
    }

    return { ok: true, indexed, attempted: urls.length, errors };
  });

const ImportAssetInput = z.object({
  assetId: z.string().uuid(),
  imageUrls: z.array(z.string().url()).min(1).max(20),
});

export const importAssetFaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImportAssetInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: asset, error } = await supabase
      .from("protected_assets")
      .select("id,name,type")
      .eq("id", data.assetId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!asset) throw new Error("Asset not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collectionId = await ensureCollectionForUser(userId, supabase as any);
    const { fetchImageBytes, putObject, getBucket } = await import("./aws/s3.server");
    const { indexFace } = await import("./aws/rekognition.server");
    const bucket = getBucket();
    let indexed = 0;
    const errors: string[] = [];

    for (const url of data.imageUrls) {
      const img = await fetchImageBytes(url);
      if (!img) { errors.push(`skip ${url}`); continue; }
      const key = `clients/${userId}/reference/asset/${asset.id}/${crypto.randomUUID()}`;
      try {
        await putObject({ key, body: img.bytes, contentType: img.contentType });
        const externalImageId = `pa_${asset.id.replace(/-/g, "")}`.slice(0, 255);
        const faces = await indexFace({ collectionId, bytes: img.bytes, externalImageId });
        for (const f of faces) {
          await supabase.from("protected_faces").insert({
            user_id: userId,
            collection_id: collectionId,
            asset_id: asset.id,
            label: asset.name ?? null,
            source_url: url,
            s3_bucket: bucket,
            s3_key: key,
            face_id: f.faceId,
            image_id: f.imageId ?? null,
            external_image_id: f.externalImageId ?? externalImageId,
            confidence: f.confidence ?? null,
            bounding_box: f.boundingBox ?? null,
          });
          indexed++;
        }
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message}`);
      }
    }

    return { ok: true, indexed, errors };
  });

export const listProtectedFaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("protected_faces")
      .select("id,platform,label,source_url,s3_key,face_id,confidence,created_at,asset_id,discovered_account_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return data ?? [];
  });

export const deleteProtectedFace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("protected_faces")
      .select("id,collection_id,face_id")
      .eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Not found");
    try {
      const { deleteFace } = await import("./aws/rekognition.server");
      await deleteFace(row.collection_id, row.face_id);
    } catch { /* ignore Rekognition error, still remove DB row */ }
    await supabase.from("protected_faces").delete().eq("id", row.id).eq("user_id", userId);
    return { ok: true };
  });
