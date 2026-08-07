import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSignedPutUrl, putObject } from "@/lib/aws/s3.server";
import { copyrightImageTypes } from "@/lib/copyright/storage.server";


/** Presigned upload slot for a reference image or an extracted video frame. */
export const prepareCopyrightUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        fileName: z.string().min(1).max(180),
        contentType: z.enum(copyrightImageTypes),
        size: z
          .number()
          .int()
          .positive()
          .max(12 * 1024 * 1024),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/copyright/${crypto.randomUUID()}-${safe}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 600) };
  });

/** Same-origin fallback upload used by the Copyright scanner to avoid fragile browser-to-S3 PUT failures. */
export const uploadCopyrightReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        fileName: z.string().min(1).max(180),
        contentType: z.enum(copyrightImageTypes),
        base64: z
          .string()
          .min(1)
          .max(20 * 1024 * 1024),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const bytes = Buffer.from(data.base64, "base64");
    if (!bytes.length) throw new Error("Reference file is empty.");
    if (bytes.length > 12 * 1024 * 1024) throw new Error("Reference file exceeds the 12 MB limit.");
    const key = `clients/${context.userId}/copyright/${crypto.randomUUID()}-${safe}`;
    await putObject({
      key,
      body: bytes,
      contentType: data.contentType,
      metadata: {
        user_id: context.userId,
        source: "copyright_intel",
      },
    });
    return { key };
  });

export const runCopyrightScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        referenceKind: z.enum(["image", "video"]),
        contentType: z.enum(copyrightImageTypes),
        /** Frame keys: one for a still, several sampled frames for a video. */
        keys: z.array(z.string().min(10).max(500)).min(1).max(6),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prefix = `clients/${userId}/copyright/`;
    if (data.keys.some((k) => !k.startsWith(prefix)))
      throw new Error("Invalid reference storage path.");

    const { data: scan, error: sErr } = await supabase
      .from("copyright_scans")
      .insert({
        user_id: userId,
        title: data.title,
        reference_kind: data.referenceKind,
        storage_path: data.keys[0],
        frame_paths: data.keys,
        status: "running",
      })
      .select("id")
      .single();
    if (sErr || !scan) throw new Error(sErr?.message ?? "Could not start scan.");

    try {
      const { executeCopyrightScanPipeline } = await import(
        "@/lib/copyright/scan-executor.server"
      );
      const result = await executeCopyrightScanPipeline({
        supabase,
        scanId: scan.id as string,
        userId,
        title: data.title,
        keys: data.keys,
        contentType: data.contentType,
        source: "inline",
      });
      const num = (key: string) => {
        const v = result.stats[key];
        return typeof v === "number" ? v : 0;
      };
      return {
        scanId: result.scanId,
        status: result.status,
        summary: {
          candidates: num("candidates"),
          matches: num("matches"),
          graded: num("graded"),
        },
      };
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e));
    }
  });

export const listCopyrightScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("copyright_scans")
      .select("*")
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getCopyrightScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: scan, error } = await context.supabase
      .from("copyright_scans")
      .select("*")
      .eq("id", data.scanId)
      .single();
    if (error) throw new Error(error.message);

    const { data: matches, error: mErr } = await context.supabase
      .from("copyright_matches")
      .select("*")
      .eq("scan_id", data.scanId)
      .order("confidence", { ascending: false });
    if (mErr) throw new Error(mErr.message);

    const matchRows = (matches ?? []).filter((m) => {
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      return ev.client_visible !== false;
    });
    const stats = (scan.stats ?? {}) as Record<string, unknown>;
    const expectedCount = Number(stats.matches ?? 0);

    if (expectedCount > 0 && matchRows.length === 0) {
      console.warn(
        `[CopyrightScan] Diagnostic Warning: scan_id=${data.scanId} has stats.matches=${expectedCount} but copyright_matches query returned 0 rows.`,
      );
    }

    return { scan, matches: matchRows };
  });

export const listAllCopyrightMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ includeArchived: z.boolean().optional() }).parse(raw))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: matches, error } = await context.supabase
      .from("copyright_matches")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (matches ?? []).filter((m) => {
      if (m.user_id && m.user_id !== userId) return false;
      return true;
    });

    if (data.includeArchived) return rows;
    return rows.filter((m) => {
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      return ev.client_visible !== false;
    });
  });

export const archivePreviousCopyrightResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ keepScanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    console.log("[archivePreviousCopyrightResults] Starting archive", {
      userId,
      keepScanId: data.keepScanId,
    });

    const { data: matches, error: fetchErr } = await context.supabase
      .from("copyright_matches")
      .select("id, scan_id, evidence, user_id")
      .neq("scan_id", data.keepScanId);

    if (fetchErr) {
      console.error("[archivePreviousCopyrightResults] Fetch error:", fetchErr);
      throw new Error(`Failed to fetch previous copyright matches: ${fetchErr.message}`);
    }

    const rowsToArchive = (matches ?? []).filter((m) => {
      if (m.user_id && m.user_id !== userId) return false;
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      return ev.client_visible !== false;
    });

    if (rowsToArchive.length === 0) {
      console.log("[archivePreviousCopyrightResults] No active rows to archive.");
      return { success: true, archivedCount: 0 };
    }

    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const row of rowsToArchive) {
      const ev = (row.evidence ?? {}) as Record<string, unknown>;
      const updatedEvidence = {
        ...ev,
        client_visible: false,
        archived_at: now,
      };

      const { error: updErr } = await context.supabase
        .from("copyright_matches")
        .update({ evidence: updatedEvidence })
        .eq("id", row.id);

      if (updErr) {
        console.error(
          `[archivePreviousCopyrightResults] Update error for row_id=${row.id}:`,
          updErr,
        );
        throw new Error(`Failed to archive copyright match ${row.id}: ${updErr.message}`);
      }
      updatedCount++;
    }

    // Mark previous scans as archived
    await context.supabase
      .from("copyright_scans")
      .update({ status: "archived" })
      .neq("id", data.keepScanId)
      .eq("user_id", userId);

    console.log("[archivePreviousCopyrightResults] Completed successfully", {
      archivedCount: updatedCount,
    });
    return { success: true, archivedCount: updatedCount };
  });

export const archiveScanCopyrightResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    console.log("[archiveScanCopyrightResults] Starting archive", { userId, scanId: data.scanId });

    const { data: matches, error: fetchErr } = await context.supabase
      .from("copyright_matches")
      .select("id, evidence, user_id")
      .eq("scan_id", data.scanId);

    if (fetchErr) {
      console.error("[archiveScanCopyrightResults] Fetch error:", fetchErr);
      throw new Error(`Failed to fetch scan copyright matches: ${fetchErr.message}`);
    }

    const rowsToArchive = (matches ?? []).filter((m) => {
      if (m.user_id && m.user_id !== userId) return false;
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      return ev.client_visible !== false;
    });

    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const row of rowsToArchive) {
      const ev = (row.evidence ?? {}) as Record<string, unknown>;
      const updatedEvidence = {
        ...ev,
        client_visible: false,
        archived_at: now,
      };

      const { error: updErr } = await context.supabase
        .from("copyright_matches")
        .update({ evidence: updatedEvidence })
        .eq("id", row.id);

      if (updErr) {
        console.error(`[archiveScanCopyrightResults] Update error for row_id=${row.id}:`, updErr);
        throw new Error(`Failed to archive match ${row.id}: ${updErr.message}`);
      }
      updatedCount++;
    }

    // Mark the scan itself as archived
    await context.supabase
      .from("copyright_scans")
      .update({ status: "archived" })
      .eq("id", data.scanId);

    console.log("[archiveScanCopyrightResults] Completed successfully", {
      archivedCount: updatedCount,
    });
    return { success: true, archivedCount: updatedCount };
  });

export const updateCopyrightMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        matchId: z.string().uuid(),
        reviewStatus: z.enum(["pending", "evidence_ready", "dismissed"]),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("copyright_matches")
      .update({ review_status: data.reviewStatus })
      .eq("id", data.matchId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
