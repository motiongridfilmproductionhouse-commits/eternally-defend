import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const KindEnum = z.enum(["screenshot", "takedown_package", "certificate", "thumbnail", "archive", "other"]);

const UploadInput = z.object({
  kind: KindEnum,
  base64: z.string().min(1).max(20 * 1024 * 1024), // ~15MB decoded ceiling
  contentType: z.string().min(3).max(120),
  label: z.string().max(200).optional(),
  caseId: z.string().uuid().optional(),
  enforcementRequestId: z.string().uuid().optional(),
  scanHitId: z.string().uuid().optional(),
  faceMatchEventId: z.string().uuid().optional(),
});

export const uploadEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UploadInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { putObject, sha256Hex, getBucket } = await import("./aws/s3.server");
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) throw new Error("File too large");
    const sha = await sha256Hex(bytes);
    const key = `clients/${userId}/evidence/${data.kind}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}`;
    const bucket = getBucket();
    await putObject({ key, body: bytes, contentType: data.contentType });
    const { data: row, error } = await supabase.from("evidence_vault_items").insert({
      user_id: userId,
      kind: data.kind,
      case_id: data.caseId ?? null,
      enforcement_request_id: data.enforcementRequestId ?? null,
      scan_hit_id: data.scanHitId ?? null,
      face_match_event_id: data.faceMatchEventId ?? null,
      s3_bucket: bucket, s3_key: key, sha256: sha, bytes: bytes.byteLength, content_type: data.contentType,
      label: data.label ?? null,
    }).select("id,s3_key,sha256,bytes,created_at").single();
    if (error) throw error;
    return { ok: true, item: row };
  });

export const listEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    kind: KindEnum.optional(),
    caseId: z.string().uuid().optional(),
    enforcementRequestId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("evidence_vault_items")
      .select("id,kind,label,s3_key,sha256,bytes,content_type,created_at,case_id,enforcement_request_id,scan_hit_id,face_match_event_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.kind) q = q.eq("kind", data.kind);
    if (data.caseId) q = q.eq("case_id", data.caseId);
    if (data.enforcementRequestId) q = q.eq("enforcement_request_id", data.enforcementRequestId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const getEvidenceSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase.from("evidence_vault_items")
      .select("s3_key,content_type").eq("id", data.id).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Not found");
    const { getSignedGetUrl } = await import("./aws/s3.server");
    const url = await getSignedGetUrl(row.s3_key, 300);
    return { url, contentType: row.content_type, expiresIn: 300 };
  });

export const deleteEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // We only remove the DB row; keep S3 object for legal hold. (Manual delete via S3 lifecycle policies.)
    const { error } = await supabase.from("evidence_vault_items").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
