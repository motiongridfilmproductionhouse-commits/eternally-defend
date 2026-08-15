import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { discoverOnDomainCopyrightContact, recordDiscoveredRouteCandidate } from "@/lib/enforcement/contact-discovery.server";

const { data: f } = await supabaseAdmin
  .from("deepfake_findings")
  .select("id,user_id,final_url,canonical_url,url,source_type")
  .or("final_url.ilike.%flirttendre%,url.ilike.%flirttendre%,canonical_url.ilike.%flirttendre%")
  .limit(1)
  .maybeSingle();
console.log("finding:", f?.id, f?.final_url ?? f?.url);

const result = await discoverOnDomainCopyrightContact(f?.final_url ?? f?.url ?? "https://flirttendre.com/");
console.log("discovery:", JSON.stringify({ found: result.found, email: result.candidate?.email, source: result.candidate?.sourceUrl, hash: result.pageHash, pages: result.pagesInspected }, null, 1));
console.log("excerpt:", (result.evidenceExcerpt ?? "").slice(0, 300));

const out = await recordDiscoveredRouteCandidate({
  supabase: supabaseAdmin,
  result,
  findingId: f?.id ?? null,
  findingUrl: f?.final_url ?? f?.url ?? null,
  sourceType: f?.source_type ?? "deepfake_finding",
});
console.log("record:", JSON.stringify(out));

const { data: row } = await supabaseAdmin.from("domain_enforcement_routes").select("domain,recipient_email,verification_status,verification_method,authoritative_source_url,discovered_at,discovery_finding_id").eq("domain", result.domain).maybeSingle();
console.log("row:", JSON.stringify(row));
