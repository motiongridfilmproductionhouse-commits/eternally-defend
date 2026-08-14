import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computePerceptualHashes } from "@/lib/media/perceptual-hash.server";
import { runAssetDiscoveryJob } from "@/lib/discovery/asset-discovery.server";
import { reverseImageProvidersConfigured } from "@/lib/discovery/reverse-image.server";

const USER = "606afa01-0767-4356-8459-7e7d8521c233";
const IMG = "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Taj_Mahal_in_March_2004.jpg/800px-Taj_Mahal_in_March_2004.jpg";

console.log("providers:", reverseImageProvidersConfigured());
const res = await fetch(IMG, { headers: { "User-Agent": "EternaSentinelDryRun/1.0 (contact: security@eternasentinel.com)" } });
const bytes = new Uint8Array(await res.arrayBuffer());
console.log("seed status", res.status, "bytes:", bytes.length);
const hashes = computePerceptualHashes(bytes);
console.log("hashes:", hashes);

const { data: asset, error } = await supabaseAdmin.from("protected_assets").insert({
  user_id: USER, name: "Dry-run reference photo", kind: "photo", source_url: IMG, active: true,
  phash: hashes?.phash ?? null, dhash: hashes?.dhash ?? null, ahash: hashes?.ahash ?? null,
  hash_algorithm: hashes ? "phash64_dct32+dhash64+ahash64" : null,
  hashed_at: hashes ? new Date().toISOString() : null,
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
  .eq("job_id", job.id).order("similarity", { ascending: false, nullsFirst: false }).limit(12);
console.log("CANDIDATES:", JSON.stringify(cands, null, 2));
const { data: jobRow } = await supabaseAdmin.from("asset_discovery_jobs").select("status,stage,candidates_discovered,candidates_fetched,candidates_verified,candidates_rejected,matches_created,diagnostics,error").eq("id", job.id).single();
console.log("JOB:", JSON.stringify(jobRow, null, 2));
