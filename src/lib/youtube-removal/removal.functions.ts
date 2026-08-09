import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildQueryPlan } from "./queries";

export const previewQueryPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({ targetName: z.string().min(2).max(120), aliases: z.array(z.string()).max(10).optional() })
      .parse(raw),
  )
  .handler(async ({ data }) => buildQueryPlan({ targetName: data.targetName, aliases: data.aliases }));

export const listYoutubeRemovalScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("youtube_removal_scans")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getYoutubeRemovalScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const [scanRes, findingsRes] = await Promise.all([
      context.supabase
        .from("youtube_removal_scans")
        .select("*")
        .eq("id", data.scanId)
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("youtube_removal_findings")
        .select("*")
        .eq("scan_id", data.scanId)
        .eq("user_id", context.userId)
        .order("priority_score", { ascending: false }),
    ]);
    if (scanRes.error) throw new Error(scanRes.error.message);
    if (findingsRes.error) throw new Error(findingsRes.error.message);
    const all = findingsRes.data ?? [];
    return {
      scan: scanRes.data,
      // Client-facing: verified subjects from non-official channels only.
      findings: all.filter(
        (f) => f.channel_class !== "official_news" && f.subject_status === "verified",
      ),
      excludedNews: all.filter((f) => f.channel_class === "official_news").length,
      notSubject: all.filter(
        (f) => f.channel_class !== "official_news" && f.subject_status !== "verified",
      ).length,
    };
  });

export const startYoutubeRemovalScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        targetName: z.string().min(2).max(120),
        aliases: z.array(z.string().min(1).max(80)).max(10).optional(),
        languageHint: z.string().max(20).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const queries = buildQueryPlan({ targetName: data.targetName, aliases: data.aliases });
    const { data: scan, error } = await context.supabase
      .from("youtube_removal_scans")
      .insert({
        user_id: context.userId,
        target_name: data.targetName,
        aliases: data.aliases ?? [],
        language_hint: data.languageHint ?? null,
        status: "queued",
        stage: "queued",
        queries,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const scanId = (scan as { id: string }).id;
    const { runYoutubeRemovalScan } = await import("./scan.server");
    try {
      await runYoutubeRemovalScan(context.supabase, context.userId, scanId);
    } catch (e) {
      console.error("[yt-removal] scan failed", scanId, e);
    }
    return { scanId };
  });

export const retryYoutubeRemovalScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { runYoutubeRemovalScan } = await import("./scan.server");
    try {
      await runYoutubeRemovalScan(context.supabase, context.userId, data.scanId);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Scan failed" };
    }
  });
