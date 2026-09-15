import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertAgentAccess } from "./policy";
import { executeAssessmentScan } from "./scan";
import type { Assessment } from "./model";

// New schema is isolated here until the Supabase generated types are refreshed after migration.
export const db = supabaseAdmin as SupabaseClient;
export const hashReference = (raw: string) => createHash("sha256").update(raw).digest("hex");
export const newReference = () => randomBytes(32).toString("base64url");
export const publicColumns =
  "id,agent_id,artist_name,official_profile_url,image_url,status,stage,signals,pricing,reason,conversion_status,created_at,updated_at";
export async function access(userId: string) {
  const [admin, superAdmin, member] = await Promise.all([
    db.rpc("has_role", { _user_id: userId, _role: "admin" }),
    db.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    db.from("agent_memberships").select("active").eq("user_id", userId).maybeSingle(),
  ]);
  if (admin.error || superAdmin.error || member.error) throw new Error("Unable to verify access.");
  return {
    admin: admin.data === true || superAdmin.data === true,
    active: member.data?.active === true,
  };
}
export async function requireAgent(userId: string, id?: string) {
  const role = await access(userId);
  assertAgentAccess(userId, role.active, role.admin);
  if (!id) return { role, assessment: null };
  const { data, error } = await db
    .from("agent_assessments")
    .select(publicColumns)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("Assessment not found.");
  assertAgentAccess(userId, role.active, role.admin, data.agent_id);
  return { role, assessment: data as Assessment };
}
export async function audit(actor: string, action: string, id?: string) {
  const { error } = await db
    .from("agent_assessment_audit")
    .insert({ actor_id: actor, assessment_id: id ?? null, action });
  if (error) throw new Error("Could not record assessment activity.");
}
export async function runAssessment(id: string) {
  // Atomic claim: duplicate submissions/background invocations never execute a job twice.
  const { data: row, error } = await db
    .from("agent_assessments")
    .update({ status: "SCANNING" })
    .eq("id", id)
    .eq("status", "QUEUED")
    .select("*")
    .maybeSingle();
  if (error) throw new Error("Unable to claim assessment job.");
  if (!row) return;
  const { DiscoveryRouter } = await import("@/lib/scan/discovery/router.server");
  const { braveProvider } = await import("@/lib/scan/discovery/brave-provider.server");
  const { serpapiProvider } = await import("@/lib/scan/discovery/serpapi-provider.server");
  const { firecrawlProvider } = await import("@/lib/scan/discovery/firecrawl-provider.server");
  const { googleProvider } = await import("@/lib/scan/discovery/google-provider.server");
  const { wikipediaProvider } = await import("@/lib/scan/discovery/wikipedia-provider.server");
  const { fetchArtistPortrait } = await import("./portrait.server");
  // Use actual search APIs. LLM grounding is excluded from evidence used for a price.
  // Wikipedia's keyless public API is a fallback so identity resolution still works
  // when the paid providers are rate limited or out of credits.
  const router = new DiscoveryRouter({
    adapters: [braveProvider, serpapiProvider, firecrawlProvider, googleProvider, wikipediaProvider],
    only: ["brave", "google", "serpapi", "firecrawl", "wikipedia"],
  });
  await executeAssessmentScan(row.artist_name, row.official_profile_url, {
    search: (query, signal) => router.search(query, 15, { signal }),
    successfulQueries: () =>
      router.report().providers.reduce((sum, p) => sum + p.queriesSuccessful, 0),
    portrait: (name, signal) => fetchArtistPortrait(name, signal),
    policy: async () => {
      const { data, error } = await db
        .from("agent_pricing_policy")
        .select("*")
        .eq("id", true)
        .single();
      if (error) throw new Error("Pricing unavailable");
      return data;
    },
    persist: async (patch) => {
      const { error } = await db
        .from("agent_assessments")
        .update(patch)
        .eq("id", id)
        .in("status", ["SCANNING", "ANALYZING"]);
      if (error) throw new Error("Unable to persist scan progress");
    },
  });
}
export async function resolveReference(token: string) {
  const { data, error } = await db
    .from("agent_assessment_handoffs")
    .select("assessment_id,expires_at,claimed_by")
    .eq("token_hash", hashReference(token))
    .maybeSingle();
  if (error || !data || Date.parse(data.expires_at) <= Date.now() || data.claimed_by)
    throw new Error("Invalid or expired assessment reference.");
  return data;
}
