import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { putObject } from "@/lib/aws/s3.server";
import { computePerceptualHashes } from "@/lib/media/perceptual-hash.server";
import { runAssetDiscoveryJob } from "@/lib/discovery/asset-discovery.server";
import { reverseImageProvidersConfigured } from "@/lib/discovery/reverse-image.server";

const USER = "606afa01-0767-4356-8459-7e7d8521c233"; // demo account
const IMG = "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Taj_Mahal_in_March_2004.jpg/800px-Taj_Mahal_in_March_2004.jpg";

console.log("providers:", reverseImageProvidersConfigured());
const bytes = new Uint8Array(await (await fetch(IMG)).arrayBuffer());
console.log("seed bytes:", bytes.length);
const hashes = computePerceptualHashes(bytes);
console.log("hashes:", hashes);

const key = `clients/${USER}/assets/dryrun-${crypto.randomUUID()}.jpg`;
await putObject({ key, body: bytes, contentType: "image/jpeg" });

const { data: asset, error } = await supabaseAdmin.from("protected_assets").insert({
  user_id: USER, name: "Dry-run reference photo", kind: "photo", storage_path: key, active: true,
  phash: hashes?.phash ?? null, dhash: hashes?.dhash ?? null, ahash: hashes?.ahash ?? null,
  hash_algorithm: hashes ? "phash64_dct32+dhash64+ahash64" : null,
  hashed_at: new Date().toISOString(),
}).select("id,name").single();
if (error) throw error;
console.log("asset:", asset);

const { data: job, error: jErr } = await supabaseAdmin.from("asset_discovery_jobs").insert({
  user_id: USER, protected_asset_id: asset.id, status: "pending", stage: "queued",
}).select("id").single();
if (jErr) throw jErr;

const result = await runAssetDiscoveryJob(supabaseAdmin as never, job.id);
console.log("RESULT:", JSON.stringify(result, null, 2));

const { data: cands } = await supabaseAdmin.from("discovery_candidates")
  .select("page_url,host,platform,provider,match_type,verification_status,crawl_status,similarity,distance,match_reason,copyright_match_id")
  .eq("job_id", job.id).order("similarity", { ascending: false, nullsFirst: false }).limit(15);
console.log("CANDIDATES:", JSON.stringify(cands, null, 2));
const { data: jobRow } = await supabaseAdmin.from("asset_discovery_jobs").select("*").eq("id", job.id).single();
console.log("JOB:", JSON.stringify(jobRow, null, 2));
