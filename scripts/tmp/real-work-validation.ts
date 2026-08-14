/** Controlled real-work discovery validation. Read/write to test account only; enforcement OFF. */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { getBucket, getS3 } from "@/lib/aws/clients.server";
import { computePerceptualHashes } from "@/lib/media/perceptual-hash.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAssetDiscoveryJob } from "@/lib/discovery/asset-discovery.server";
import { reverseImageProvidersConfigured } from "@/lib/discovery/reverse-image.server";

const ASSET_ID = "ea34e7b6-2762-4db1-90a8-0d2061d79169";
const sb = supabaseAdmin as any;

const { data: asset } = await sb.from("protected_assets").select("*").eq("id", ASSET_ID).single();
console.log("asset:", asset.name, asset.kind, asset.source_url, "fingerprinted:", !!asset.dhash);

if (!asset.dhash) {
  const res = await fetch(asset.source_url, { headers: { "user-agent": "EternaSentinel/1.0 (validation)" } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  console.log("downloaded original bytes:", bytes.length, res.status);
  const key = `clients/${asset.user_id}/assets/${crypto.randomUUID()}-taj-mahal.jpg`;
  await getS3().send(new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: bytes, ContentType: "image/jpeg" }));
  const hashes = computePerceptualHashes(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log("hashes:", hashes, "sha256:", sha256.slice(0, 16));
  const { error } = await sb.from("protected_assets").update({
    storage_path: key, phash: hashes?.phash ?? null, dhash: hashes?.dhash ?? null, ahash: hashes?.ahash ?? null,
    hash_algorithm: hashes ? "phash64_dct32+dhash64+ahash64" : null, hashed_at: new Date().toISOString(),
    metadata: { ...(asset.metadata ?? {}), status: "Monitoring", content_type: "image/jpeg", sha256, perceptual_hashes: hashes },
  }).eq("id", ASSET_ID);
  if (error) throw new Error(error.message);
}

console.log("reverse-image providers configured:", reverseImageProvidersConfigured());

const { data: job, error: jErr } = await sb.from("asset_discovery_jobs").insert({
  user_id: asset.user_id, protected_asset_id: ASSET_ID, status: "pending", stage: "queued",
}).select("*").single();
if (jErr) throw new Error(jErr.message);

const result = await runAssetDiscoveryJob(sb, job.id);
console.log("RESULT:", JSON.stringify(result, null, 2));

const { data: jobRow } = await sb.from("asset_discovery_jobs").select("*").eq("id", job.id).single();
console.log("JOB ROW:", JSON.stringify(jobRow, null, 2));
