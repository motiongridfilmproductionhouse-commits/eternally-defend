/**
 * Authorised media uploads + caption / transcript imports.
 * Media itself is stored in the private `multimedia-uploads` bucket by the
 * client; this module records metadata + permission confirmation and parses
 * captions into timestamped segments.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getLimits } from "./quota.server";
import { detectCaptionFormat, parseCaptions, findingsFromCaptions } from "./captions.server";

const ALLOWED_MIME = new Set([
  "video/mp4", "video/quicktime", "video/webm",
  "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a",
  "image/jpeg", "image/png", "image/webp",
  "application/x-subrip", "text/vtt", "text/plain",
]);

const RegisterInput = z.object({
  filename: z.string().min(1).max(300),
  mime_type: z.string().min(1).max(120),
  size_bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storage_path: z.string().min(1).max(500),
  permission_confirmed: z.literal(true, {
    errorMap: () => ({ message: "You must confirm you own or have lawful permission to process this file." }),
  }),
  retention_policy: z.enum(["immediate", "7d", "30d", "case_closure", "legal_hold"]).default("30d"),
  organization: z.string().max(200).optional(),
  job_id: z.string().uuid().optional(),
});

export const registerAuthorisedUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => RegisterInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const limits = getLimits();
    if (!ALLOWED_MIME.has(data.mime_type)) {
      throw new Error(`Unsupported file type: ${data.mime_type}`);
    }
    const mb = data.size_bytes / (1024 * 1024);
    if (mb > limits.maxUploadMb) {
      throw new Error(`File exceeds ${limits.maxUploadMb} MB upload limit`);
    }
    const retentionDays = { immediate: 0, "7d": 7, "30d": 30, case_closure: 3650, legal_hold: 36500 }[data.retention_policy];
    const retentionUntil = retentionDays > 0
      ? new Date(Date.now() + retentionDays * 86400 * 1000).toISOString()
      : new Date().toISOString();

    const { data: ins, error } = await supabase.from("multimedia_uploads").insert({
      user_id: userId,
      job_id: data.job_id ?? null,
      filename: data.filename,
      mime_type: data.mime_type,
      size_bytes: data.size_bytes,
      sha256: data.sha256,
      storage_path: data.storage_path,
      permission_confirmed: true,
      retention_policy: data.retention_policy,
      retention_until: retentionUntil,
      organization: data.organization ?? null,
    }).select("id, retention_until").single();
    if (error) throw new Error(error.message);
    return { id: ins.id as string, retention_until: ins.retention_until };
  });

export const listAuthorisedUploads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("multimedia_uploads")
      .select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
    return { uploads: data ?? [] };
  });

const CaptionInput = z.object({
  job_id: z.string().uuid().optional(),
  filename: z.string().max(300).optional(),
  raw_text: z.string().min(1).max(2_000_000),
  transcript_source: z.enum(["user_uploaded", "owner_authorised", "stt", "manual", "external"]).default("user_uploaded"),
  language: z.string().max(20).optional(),
  target_name: z.string().min(1).max(200).optional(),
  target_aliases: z.array(z.string().max(120)).max(20).default([]),
});

export const importCaptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => CaptionInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const format = detectCaptionFormat(data.raw_text, data.filename);
    const segments = parseCaptions(data.raw_text, format);
    const { data: ins, error } = await supabase.from("caption_imports").insert({
      user_id: userId,
      job_id: data.job_id ?? null,
      filename: data.filename ?? null,
      format,
      transcript_source: data.transcript_source,
      raw_text: data.raw_text.slice(0, 200_000),
      segment_count: segments.length,
      segments: segments as any,
      language: data.language ?? null,
    }).select("id").single();
    if (error) throw new Error(error.message);

    // If tied to a job and we have target names, synthesize timestamped findings
    let findingsCreated = 0;
    if (data.job_id && data.target_name) {
      const nameTerms = [data.target_name, ...(data.target_aliases ?? [])].filter(Boolean);
      const findings = findingsFromCaptions(segments, nameTerms);
      if (findings.length) {
        const rows = findings.map((f) => ({
          user_id: userId, job_id: data.job_id!,
          finding_type: f.finding_type,
          start_seconds: f.start_seconds,
          end_seconds: f.end_seconds,
          severity: f.severity,
          title: `Caption match: ${f.matched.join(", ")}`,
          description: `Timestamped mention derived from imported ${format.toUpperCase()} captions.`,
          transcript_excerpt: f.text,
          speaker: f.speaker ?? null,
          timestamp_source: "captions",
          evidence_source: `caption_import:${ins.id}`,
          confidence: 0.9,
          human_review_status: "unreviewed",
          detection_reason: `Matched keywords: ${f.matched.join(", ")}`,
          contributing_signals: { matched: f.matched, source: data.transcript_source },
        }));
        const res = await supabase.from("timestamp_findings").insert(rows);
        if (!res.error) findingsCreated = rows.length;
      }
    }
    return { id: ins.id as string, format, segment_count: segments.length, findingsCreated };
  });

export const createSignedMediaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ storage_path: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Ownership check via folder prefix
    if (!data.storage_path.startsWith(`${userId}/`)) throw new Error("Forbidden");
    const { data: signed, error } = await supabase.storage.from("multimedia-uploads").createSignedUrl(data.storage_path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl, expires_in: 600 };
  });
