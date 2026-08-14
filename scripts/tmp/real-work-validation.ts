/** Controlled real-work discovery validation. Read/write to test account only; enforcement OFF. */
import { createHash } from "node:crypto";
import { computePerceptualHashes } from "@/lib/media/perceptual-hash.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAssetDiscoveryJob } from "@/lib/discovery/asset-discovery.server";
import { reverseImageProvidersConfigured } from "@/lib/discovery/reverse-image.server";

const ASSET_ID = "ea34e7b6-2762-4db1-90a8-0d2061d79169";
const sb = supabaseAdmin as any;

const { data: asset } = await sb.from("protected_assets").select("*").eq("id", ASSET_ID).single();
console.log("asset:", asset.name, asset.kind, asset.source_url, "fingerprinted:", !!asset.dhash);

if (!asset.dhash) {
  const res = await fetch(asset.source_url, {
    headers: { "user-agent": "EternaSentinelValidation/1.0 (contact: hellosreehari@gmail.com)", accept: "image/*" },
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  console.log("downloaded original bytes:", bytes.length, "http", res.status, res.headers.get("content-type"));
  const hashes = computePerceptualHashes(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log("hashes:", hashes, "sha256:", sha256.slice(0, 16));
  const { error } = await sb.from("protected_assets").update({
    phash: hashes?.phash ?? null, dhash: hashes?.dhash ?? null, ahash: hashes?.ahash ?? null,
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
