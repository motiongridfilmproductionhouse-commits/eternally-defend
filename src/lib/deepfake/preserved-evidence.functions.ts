import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TargetInput = z
  .object({
    findingId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    sourcePageUrl: z.string().url().max(2000).optional(),
  })
  .refine((v) => Boolean(v.findingId || v.leadId || v.sourcePageUrl), {
    message: "A finding, lead, or source URL is required.",
  });

export type PreservedEvidenceItem = {
  id: string;
  media_kind: string;
  source_page_url: string;
  source_media_url: string | null;
  platform_domain: string | null;
  content_type: string;
  bytes: number;
  sha256: string | null;
  perceptual_hash: string | null;
  frame_index: number | null;
  frame_timestamp_seconds: number | null;
  capture_timestamp: string;
  face_similarity: number | null;
  identity_confidence: number | null;
  synthetic_confidence: number | null;
  evidence_status: string;
  source_reachable: boolean | null;
  source_http_status: number | null;
  finding_id: string | null;
  lead_id: string | null;
  view_url: string;
};

const SELECT_COLUMNS =
  "id,media_kind,source_page_url,source_media_url,platform_domain,content_type,bytes,sha256,perceptual_hash,frame_index,frame_timestamp_seconds,capture_timestamp,face_similarity,identity_confidence,synthetic_confidence,evidence_status,source_reachable,source_http_status,finding_id,lead_id,s3_key";

/** Owner-scoped listing of preserved evidence with short-lived signed view URLs. */
export const listPreservedEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TargetInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let query = supabase
      .from("preserved_evidence_media")
      .select(SELECT_COLUMNS)
      .eq("user_id", userId)
      .order("capture_timestamp", { ascending: false })
      .limit(60);

    if (data.findingId) query = query.eq("finding_id", data.findingId);
    else if (data.leadId) query = query.eq("lead_id", data.leadId);
    else if (data.sourcePageUrl) query = query.eq("source_page_url", data.sourcePageUrl);

    const { data: rows, error } = await query;
    if (error) throw error;

    const { getSignedGetUrl } = await import("../aws/s3.server");
    const items: PreservedEvidenceItem[] = [];
    for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
      const key = row.s3_key as string;
      const url = await getSignedGetUrl(key, 300, {
        disposition: "inline",
        contentType: (row.content_type as string) || "image/jpeg",
      });
      const { s3_key: _ignored, ...rest } = row;
      items.push({ ...(rest as Omit<PreservedEvidenceItem, "view_url">), view_url: url });
    }
    return { items, expires_in: 300 };
  });

/**
 * Preserve already-captured media for a finding/lead into Eterna's evidence store.
 * Does not change verification, discovery, or enforcement behaviour.
 */
export const preserveFindingEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        findingId: z.string().uuid().optional(),
        leadId: z.string().uuid().optional(),
      })
      .refine((v) => Boolean(v.findingId || v.leadId), {
        message: "A finding or lead is required.",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { preserveEvidenceForTarget } = await import("./evidence-preservation.server");
    const summary = await preserveEvidenceForTarget({
      supabase,
      userId,
      findingId: data.findingId ?? null,
      leadId: data.leadId ?? null,
    });
    return summary;
  });
