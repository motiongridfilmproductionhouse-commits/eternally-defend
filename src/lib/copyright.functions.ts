import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBucket, getS3 } from "@/lib/aws/clients.server";
import { getSignedPutUrl, sha256Hex } from "@/lib/aws/s3.server";
import { hostOf, canonicalUrl, type DiscoveryCandidate } from "@/lib/copyright/url.server";
import { analyzeReference, firecrawlDiscover } from "@/lib/copyright/discover.server";

import { bandFor, gradeCandidate } from "@/lib/copyright/classify.server";
import { resolveAbuseContact } from "@/lib/copyright/contacts.server";
import type { Database } from "@/integrations/supabase/types";

type MatchInsert = Database["public"]["Tables"]["copyright_matches"]["Insert"];

const imageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

/** Presigned upload slot for a reference image or an extracted video frame. */
export const prepareCopyrightUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    fileName: z.string().min(1).max(180),
    contentType: z.enum(imageTypes),
    size: z.number().int().positive().max(12 * 1024 * 1024),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/copyright/${crypto.randomUUID()}-${safe}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 600) };
  });

async function readObject(key: string): Promise<Uint8Array> {
  const obj = await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  return new Uint8Array(await obj.Body!.transformToByteArray());
}

function toDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

export const runCopyrightScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    title: z.string().trim().min(1).max(200),
    referenceKind: z.enum(["image", "video"]),
    contentType: z.enum(imageTypes),
    /** Frame keys: one for a still, several sampled frames for a video. */
    keys: z.array(z.string().min(10).max(500)).min(1).max(6),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prefix = `clients/${userId}/copyright/`;
    if (data.keys.some((k) => !k.startsWith(prefix))) throw new Error("Invalid reference storage path.");

    const { data: scan, error: sErr } = await supabase.from("copyright_scans").insert({
      user_id: userId,
      title: data.title,
      reference_kind: data.referenceKind,
      storage_path: data.keys[0],
      frame_paths: data.keys,
      status: "running",
    }).select("id").single();
    if (sErr || !scan) throw new Error(sErr?.message ?? "Could not start scan.");

    try {
      const firstBytes = await readObject(data.keys[0]);
      if (!firstBytes.length) throw new Error("Reference file is empty.");
      const sha256 = await sha256Hex(firstBytes);
      const referenceDataUrl = toDataUrl(firstBytes, data.contentType);

      // 1. AI-vision analysis of the reference frame (title, OCR, watermark, features).
      const analysis = await analyzeReference(referenceDataUrl, data.title);

      // 2. Firecrawl reverse discovery, seeded by that analysis.
      const byUrl = new Map<string, DiscoveryCandidate>();
      for (const c of await firecrawlDiscover(referenceDataUrl, data.title, 0, analysis)) {
        if (!byUrl.has(c.url)) byUrl.set(c.url, c);
      }

      // Prioritise high-signal piracy leads, keep the grading budget bounded.
      const ordered = [...byUrl.values()]
        .filter((c) => c.thumbnail || c.imageUrl)
        .sort((a, b) => Number(b.exact) - Number(a.exact))
        .slice(0, 28);


      // 2. Evidence grading with a multimodal comparison.
      const rows: MatchInsert[] = [];
      let ignored = 0;
      for (let offset = 0; offset < ordered.length; offset += 4) {
        const batch = ordered.slice(offset, offset + 4);
        const graded = await Promise.all(batch.map(async (candidate) => {
          const img = candidate.imageUrl ?? candidate.thumbnail!;
          const result = await gradeCandidate({
            referenceDataUrl,
            candidateImageUrl: img,
            candidatePageUrl: candidate.url,
            candidateTitle: candidate.title,
            platform: candidate.source,
            workTitle: data.title,
            lensExact: candidate.exact,
          });
          return { candidate, result };
        }));

        for (const { candidate, result } of graded) {
          if (!result || result.falsePositive || result.detectionType === "unrelated" || result.confidence < 50) {
            ignored++;
            continue;
          }
          const contact = resolveAbuseContact(candidate.url);
          rows.push({
            scan_id: scan.id,
            user_id: userId,
            source_url: canonicalUrl(candidate.url),
            platform: contact.platform,
            page_title: candidate.title,
            thumbnail_url: candidate.thumbnail ?? candidate.imageUrl,
            confidence: result.confidence,
            confidence_band: bandFor(result.confidence),
            detection_type: result.detectionType,
            transformations: result.transformations,
            evidence: {
              reference_frame_index: candidate.frameIndex,
              reference_frame_path: data.keys[candidate.frameIndex] ?? data.keys[0],
              candidate_image_url: candidate.imageUrl ?? candidate.thumbnail,
              lens_bucket: candidate.exact ? "exact_match" : "visual_match",
              watermark: result.watermark,
              host: hostOf(candidate.url),
            },
            ocr_text: result.ocrText,
            reason: result.reason,
            contact: contact as unknown as MatchInsert["contact"],
          });
        }
      }

      if (rows.length) {
        const { error: mErr } = await supabase.from("copyright_matches").upsert(rows, { onConflict: "scan_id,source_url" });
        if (mErr) throw new Error(mErr.message);
      }

      const stats = {
        candidates: byUrl.size,
        graded: ordered.length,
        matches: rows.length,
        ignored,
        frames: data.keys.length,
        sha256,
        confirmed: rows.filter((r) => r.confidence_band === "confirmed").length,
        probable: rows.filter((r) => r.confidence_band === "probable").length,
        review: rows.filter((r) => r.confidence_band === "review").length,
      };
      await supabase.from("copyright_scans").update({ status: "completed", sha256, stats }).eq("id", scan.id);
      return { scanId: scan.id as string, stats };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await supabase.from("copyright_scans").update({ status: "failed", error: message.slice(0, 500) }).eq("id", scan.id);
      throw new Error(message);
    }
  });

export const listCopyrightScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("copyright_scans").select("*")
      .order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getCopyrightScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: scan, error } = await context.supabase
      .from("copyright_scans").select("*").eq("id", data.scanId).single();
    if (error) throw new Error(error.message);
    const { data: matches, error: mErr } = await context.supabase
      .from("copyright_matches").select("*").eq("scan_id", data.scanId)
      .order("confidence", { ascending: false });
    if (mErr) throw new Error(mErr.message);
    return { scan, matches: matches ?? [] };
  });

export const updateCopyrightMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    matchId: z.string().uuid(),
    reviewStatus: z.enum(["pending", "evidence_ready", "dismissed"]),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("copyright_matches").update({ review_status: data.reviewStatus }).eq("id", data.matchId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
