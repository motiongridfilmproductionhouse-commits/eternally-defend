/**
 * Unified media ingestion for social/remote media.
 *
 * One path for "bytes we already have" (upload) and "bytes at a permitted
 * public URL" (link import). Both end in the SAME place the upload flow already
 * ends: an owner-scoped `protected_assets` row with real perceptual hashes,
 * video keyframes in `protected_asset_frames`, provenance metadata, and an
 * Autopilot target. No thresholds or enforcement behaviour are changed here.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { getSignedGetUrl, putObject } from "@/lib/aws/s3.server";
import { computePerceptualHashes } from "@/lib/media/perceptual-hash.server";
import {
  extractVideoFrames,
  frameRowsForAsset,
  videoFrameExtractionConfigured,
} from "@/lib/media/video-frames.server";
import { enrollAssetInAutopilot } from "@/lib/protection/enroll-asset.server";
import type { AssetProvenance } from "./provenance";

type Client = any;

const MAX_BYTES = 15 * 1024 * 1024;

export interface IngestResult {
  status: "created" | "duplicate" | "skipped";
  asset_id: string | null;
  name: string;
  fingerprinted: boolean;
  frames: number;
  enrolled: boolean;
  reason: string | null;
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("quicktime")) return "mov";
  return "jpg";
}

/** Fetch permitted public media. Returns null when the host blocks anonymous access. */
export async function fetchPublicMedia(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) return null;
    const buffer = await res.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_BYTES) return null;
    return { bytes: new Uint8Array(buffer), contentType };
  } catch {
    return null;
  }
}

async function findDuplicate(
  supabase: Client,
  userId: string,
  sha256: string,
  provenance: AssetProvenance,
): Promise<string | null> {
  const { data } = await supabase
    .from("protected_assets")
    .select("id,metadata")
    .eq("user_id", userId)
    .limit(400);
  for (const row of (data ?? []) as any[]) {
    const meta = row.metadata ?? {};
    if (meta.sha256 && meta.sha256 === sha256) return row.id;
    const prov = meta.provenance ?? {};
    if (
      provenance.source_post_url &&
      prov.source_post_url === provenance.source_post_url &&
      (prov.source_media_url ?? null) === (provenance.source_media_url ?? null)
    ) {
      return row.id;
    }
  }
  return null;
}

export async function ingestMediaBytes(opts: {
  supabase: Client;
  userId: string;
  name: string;
  bytes: Uint8Array;
  contentType: string;
  provenance: AssetProvenance;
}): Promise<IngestResult> {
  const { supabase, userId, bytes, contentType, provenance } = opts;
  const name = opts.name.trim().slice(0, 200) || "Social media asset";
  const isVideo = contentType.startsWith("video/");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const duplicate = await findDuplicate(supabase, userId, sha256, provenance);
  if (duplicate) {
    return {
      status: "duplicate",
      asset_id: duplicate,
      name,
      fingerprinted: true,
      frames: 0,
      enrolled: false,
      reason: "already_protected",
    };
  }

  const key = `clients/${userId}/assets/social/${crypto.randomUUID()}.${extensionFor(contentType)}`;
  await putObject({ key, body: bytes, contentType });

  const hashes = isVideo ? null : computePerceptualHashes(bytes);

  const { data: inserted, error } = await supabase
    .from("protected_assets")
    .insert({
      user_id: userId,
      name,
      kind: isVideo ? "video" : "photo",
      source_url: provenance.source_post_url,
      storage_path: key,
      active: true,
      phash: hashes?.phash ?? null,
      dhash: hashes?.dhash ?? null,
      ahash: hashes?.ahash ?? null,
      hash_algorithm: hashes ? "phash64_dct32+dhash64+ahash64" : null,
      hashed_at: hashes ? new Date().toISOString() : null,
      metadata: {
        platform: provenance.source_platform,
        status: "Monitoring",
        content_type: contentType,
        sha256,
        bytes: bytes.byteLength,
        perceptual_hashes: hashes ? { ...hashes } : null,
        provenance,
      },
    })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const assetId = inserted?.id as string;

  let frames = 0;
  let framePhash: string | null = null;
  if (isVideo && videoFrameExtractionConfigured()) {
    try {
      const signed = await getSignedGetUrl(key, 900);
      const result = await extractVideoFrames(signed);
      const rows = frameRowsForAsset(userId, assetId, result);
      if (rows.length) {
        const { error: frameError } = await supabase.from("protected_asset_frames").insert(rows);
        if (!frameError) {
          frames = rows.length;
          framePhash = result.frames[0]?.phash ?? null;
        }
      }
    } catch {
      // Frame extraction is best effort; the asset stays registered and manual.
    }
  }

  // A video's searchable fingerprint is its first keyframe hash, so Autopilot
  // can treat it like any other fingerprinted asset.
  if (framePhash) {
    await supabase
      .from("protected_assets")
      .update({
        phash: framePhash,
        hash_algorithm: "video_keyframe_phash64",
        hashed_at: new Date().toISOString(),
      })
      .eq("id", assetId);
  }

  const effectivePhash = hashes?.phash ?? framePhash;
  const enrollment = await enrollAssetInAutopilot(supabase, userId, {
    id: assetId,
    name,
    phash: effectivePhash,
    dhash: hashes?.dhash ?? null,
    ahash: hashes?.ahash ?? null,
  });

  return {
    status: "created",
    asset_id: assetId,
    name,
    fingerprinted: Boolean(effectivePhash),
    frames,
    enrolled: enrollment.enrolled,
    reason: enrollment.reason,
  };
}

/** Ingest from a permitted public media URL. Never bypasses access controls. */
export async function ingestRemoteMedia(opts: {
  supabase: Client;
  userId: string;
  name: string;
  mediaUrl: string;
  provenance: AssetProvenance;
}): Promise<IngestResult> {
  const media = await fetchPublicMedia(opts.mediaUrl);
  if (!media) {
    return {
      status: "skipped",
      asset_id: null,
      name: opts.name,
      fingerprinted: false,
      frames: 0,
      enrolled: false,
      reason: "public_retrieval_blocked",
    };
  }
  return ingestMediaBytes({ ...opts, bytes: media.bytes, contentType: media.contentType });
}
