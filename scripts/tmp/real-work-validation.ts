/** Controlled real-work discovery validation. Read/write to test account only; enforcement OFF. */
import { createHash } from "node:crypto";
import { computePerceptualHashes } from "@/lib/media/perceptual-hash.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAssetDiscoveryJob } from "@/lib/discovery/asset-discovery.server";
import { reverseImageProvidersConfigured } from "@/lib/discovery/reverse-image.server";

const ASSET_ID = "ea34e7b6-2762-4db1-90a8-0d2061d79169";
const sb = supabaseAdmin as any;
const REAL_SOURCE = "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200";
const REAL_NAME = "Validation work — Unsplash landscape (photo-1506744038136)";
await sb.from("protected_assets").update({ name: REAL_NAME, source_url: REAL_SOURCE, storage_path: null }).eq("id", ASSET_ID);

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

const { data: cands } = await sb
  .from("discovery_candidates")
  .select("page_url,media_url,host,platform,provider,match_type,verification_status,crawl_status,crawl_failure_reason,similarity,hamming_distance,hash_algorithm,match_reason,copyright_match_id,first_seen_at,last_seen_at")
  .eq("protected_asset_id", ASSET_ID)
  .order("similarity", { ascending: false, nullsFirst: false })
  .limit(200);
console.log("CANDIDATE COUNT:", cands?.length);
const byStatus: Record<string, number> = {};
for (const c of cands ?? []) byStatus[c.verification_status] = (byStatus[c.verification_status] ?? 0) + 1;
console.log("BY STATUS:", byStatus);
console.log("TOP 12:", JSON.stringify((cands ?? []).slice(0, 12), null, 2));
const failures: Record<string, number> = {};
for (const c of cands ?? []) if (c.crawl_failure_reason) failures[c.crawl_failure_reason.slice(0, 60)] = (failures[c.crawl_failure_reason.slice(0,60)] ?? 0) + 1;
console.log("FAILURE REASONS:", failures);
