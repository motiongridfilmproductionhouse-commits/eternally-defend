/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dispatchBusinessReputationScan } from "./business-reputation/scan-worker-dispatch.server";

const Input = z.object({
  query: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().max(60)).max(20).default([]),
  variations: z.array(z.string().max(60)).max(40).default([]),
  hashtags: z.array(z.string().max(40)).max(20).default([]),
  handles: z.array(z.string().max(40)).max(20).default([]),
  site: z.string().max(300).optional(),
  country: z.string().max(80).optional(),
  industry: z.string().max(120).optional(),
  monthFilter: z.enum(["24h", "7d", "30d", "12m", "all"]).default("12m"),
  sources: z.array(z.string()).min(1).max(20),
});

export type BusinessScanStartInput = z.infer<typeof Input>;

export const BUSINESS_SCAN_PUBLIC_COLUMNS =
  "id,user_id,scan_type,name,status,query,params,sources,period,total_hits,unique_hits,new_hits,updated_hits,duplicate_hits_removed,error,started_at,completed_at,created_at,updated_at,heartbeat_at,lease_expires_at,discovery_metrics,brand_profile,business_profile_id,query_plan,report_summary";

export async function startBusinessReputationScanCore(input: {
  supabase: any;
  userId: string;
  data: BusinessScanStartInput;
  resolveProfile: (
    query: string,
    site?: string,
    country?: string,
    industry?: string,
  ) => Promise<any>;
  dispatch: (args: {
    scanId: string;
    scanRunToken: string;
    startupCorrelationId: string;
  }) => Promise<{ dispatched: boolean; reason?: string | null; executionId: string }>;
  now?: () => number;
}) {
  const profile = await input.resolveProfile(
    input.data.query,
    input.data.site,
    input.data.country,
    input.data.industry,
  );
  if (!profile.resolved)
    throw new Error(profile.error || "Business could not be confirmed in Google Places.");
  const queryPlan = {
    subject: profile.resolvedBrandName || input.data.query,
    aliases: input.data.aliases,
    variations: input.data.variations,
    hashtags: input.data.hashtags,
    handles: input.data.handles,
    sources: input.data.sources,
    monthFilter: input.data.monthFilter,
    site: input.data.site || profile.website || null,
    generatedAt: new Date().toISOString(),
  };
  const token = randomUUID();
  const nowMs = input.now?.() ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const { data: scan, error } = await input.supabase
    .from("scans")
    .insert({
      user_id: input.userId,
      scan_type: "business_reputation",
      name: profile.resolvedBrandName || input.data.query,
      query: profile.resolvedBrandName || input.data.query,
      params: input.data,
      sources: input.data.sources,
      period: input.data.monthFilter,
      status: "running",
      scan_run_token: token,
      heartbeat_at: now,
      lease_expires_at: new Date(nowMs + 90_000).toISOString(),
      brand_profile: profile,
      query_plan: queryPlan,
      discovery_metrics: { phase: "confirmed_profile", percent: 5 },
    })
    .select("id")
    .single();
  if (error || !scan)
    throw new Error(error?.message || "Failed to create Business Reputation scan");
  const { data: businessProfile, error: profileError } = await input.supabase
    .from("business_reputation_profiles")
    .upsert(
      {
        user_id: input.userId,
        places_place_id: profile.placeId,
        selected_name: profile.resolvedBrandName || input.data.query,
        normalized_domain: profile.website
          ? new URL(profile.website).hostname.replace(/^www\./i, "").toLowerCase()
          : null,
        scope: profile.scope || "brand",
        profile,
      },
      { onConflict: "user_id,places_place_id" },
    )
    .select("id")
    .single();
  if (profileError || !businessProfile?.id)
    throw new Error(profileError?.message || "Failed to persist the confirmed business profile");
  const { error: profileLinkError } = await input.supabase
    .from("scans")
    .update({ business_profile_id: businessProfile.id })
    .eq("id", scan.id)
    .eq("user_id", input.userId)
    .eq("scan_type", "business_reputation");
  if (profileLinkError) throw new Error(profileLinkError.message);
  const dispatch = await input.dispatch({
    scanId: scan.id,
    scanRunToken: token,
    startupCorrelationId: randomUUID(),
  });
  return {
    scanId: scan.id,
    status: dispatch.dispatched ? "running" : "failed",
    profile,
    dispatch,
    queryPlan,
  };
}

export const startBusinessReputationScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { resolveBrandWithPlaces } = await import("@/routes/api/scan");
    const result = await startBusinessReputationScanCore({
      supabase: context.supabase,
      userId: context.userId,
      data,
      resolveProfile: async (query, site, country, industry) =>
        resolveBrandWithPlaces(query, "Brand/Business", site, country, industry),
      dispatch: ({ scanId, scanRunToken, startupCorrelationId }) =>
        dispatchBusinessReputationScan({ scanId, scanRunToken, startupCorrelationId }),
    });
    const dispatch = result.dispatch;
    if (!dispatch.dispatched) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("scans")
        .update({
          status: "failed",
          error: "Business worker could not be started. Please try again.",
          scan_run_token: null,
          lease_expires_at: null,
        })
        .eq("id", result.scanId);
    }
    return result;
  });

export const getBusinessReputationScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ scanId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: scan, error } = await supabase
      .from("scans")
      .select(BUSINESS_SCAN_PUBLIC_COLUMNS)
      .eq("id", data.scanId)
      .eq("user_id", context.userId)
      .eq("scan_type", "business_reputation")
      .single();
    if (error || !scan) throw new Error(error?.message || "Business Reputation scan not found");
    const { data: dedicatedFindings, error: dedicatedError } = await supabase
      .from("business_reputation_findings")
      .select("*")
      .eq("user_id", context.userId)
      .eq("scan_id", data.scanId)
      .neq("state", "removed")
      .order("last_checked_at", { ascending: false })
      .limit(200);
    if (!dedicatedError && dedicatedFindings?.length) {
      return {
        scan,
        hits: dedicatedFindings.map((finding: any) => ({
          ...finding,
          first_seen_at: finding.first_detected_at,
          last_seen_at: finding.last_checked_at,
          times_detected: finding.times_detected || 1,
          is_new_since_last_scan: finding.state === "new" || finding.state === "reappeared",
          previous_scan_seen: finding.state !== "new",
        })),
      };
    }
    const { data: hits, error: hitsError } = await supabase
      .from("scan_hits")
      .select("*")
      .eq("scan_id", data.scanId)
      .eq("user_id", context.userId)
      .is("hidden_at", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (hitsError) throw new Error(hitsError.message);
    return { scan, hits: hits || [] };
  });
