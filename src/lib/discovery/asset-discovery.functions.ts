/**
 * Owner-scoped server functions for public-web asset discovery.
 *
 * Every read/write is scoped to the authenticated account's own protected
 * asset. Nothing here performs enforcement: verified candidates become
 * `copyright_matches` with `review_status = 'pending'`, and the existing
 * match -> case promotion path stays the only route to enforcement.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type JobRow = Database["public"]["Tables"]["asset_discovery_jobs"]["Row"];
type CandidateRow = Database["public"]["Tables"]["discovery_candidates"]["Row"];

/* ------------------------------------------------------------------ */
/* startAssetDiscovery                                                 */
/* ------------------------------------------------------------------ */
export const startAssetDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        protectedAssetId: z.string().uuid(),
        scanId: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Ownership check before any job is created.
    const { data: asset, error: aErr } = await context.supabase
      .from("protected_assets")
      .select("id,name,phash,dhash,ahash")
      .eq("id", data.protectedAssetId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!asset) throw new Error("Protected asset not found for this account");

    const { data: job, error } = await context.supabase
      .from("asset_discovery_jobs")
      .insert({
        user_id: context.userId,
        protected_asset_id: data.protectedAssetId,
        scan_id: data.scanId ?? null,
        status: "pending",
        stage: "queued",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { runAssetDiscoveryJob } = await import("./asset-discovery.server");
    const result = await runAssetDiscoveryJob(context.supabase, job.id);
    // diagnostics is free-form JSON; normalize it so the RPC payload is serializable.
    return {
      ...result,
      diagnostics: JSON.parse(JSON.stringify(result.diagnostics ?? {})) as Record<string, string>,
    };
  });

/* ------------------------------------------------------------------ */
/* listAssetDiscoveryJobs                                              */
/* ------------------------------------------------------------------ */
export const listAssetDiscoveryJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        protectedAssetId: z.string().uuid().optional().nullable(),
        limit: z.number().int().min(1).max(50).optional().default(10),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("asset_discovery_jobs")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.protectedAssetId) query = query.eq("protected_asset_id", data.protectedAssetId);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []) as JobRow[];
  });

/* ------------------------------------------------------------------ */
/* listDiscoveryCandidates                                             */
/* ------------------------------------------------------------------ */
export const listDiscoveryCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        protectedAssetId: z.string().uuid(),
        statuses: z
          .array(z.enum(["UNVERIFIED", "VERIFIED_MATCH", "REJECTED", "FETCH_FAILED"]))
          .optional(),
        limit: z.number().int().min(1).max(200).optional().default(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("discovery_candidates")
      .select("*")
      .eq("user_id", context.userId)
      .eq("protected_asset_id", data.protectedAssetId)
      .order("similarity", { ascending: false, nullsFirst: false })
      .order("last_seen_at", { ascending: false })
      .limit(data.limit);
    if (data.statuses?.length) query = query.in("verification_status", data.statuses);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []) as CandidateRow[];
  });
