/**
 * Narrative clustering — groups findings that describe the same story.
 *
 * Cluster key priority (first match wins):
 *   1. same extracted claim  → claim:<claim_id>
 *   2. same YouTube video    → video:<video_id>
 *   3. same source URL       → url:<host+path>
 *   4. normalised title      → title:<slug>
 *
 * Combined metrics (source_count, combined_reach, first/latest_detected)
 * are aggregated on write.  Narrative velocity is (source_count / age_days).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
function hostPath(u: string) { try { const x = new URL(u); return `${x.host}${x.pathname}`.toLowerCase(); } catch { return u.toLowerCase(); } }

function clusterKeyFor(job: any, finding: any): { key: string; kind: string } {
  if (finding.extracted_claim_id) return { key: `claim:${finding.extracted_claim_id}`, kind: "claim" };
  const meta = job.source_metadata ?? {};
  if (meta.video_id) return { key: `video:${meta.video_id}`, kind: "video" };
  if (job.source_ref?.startsWith("http")) return { key: `url:${hostPath(job.source_ref)}`, kind: "url" };
  const t = finding.title ?? meta.title ?? job.target_name;
  return { key: `title:${slugify(String(t))}`, kind: "title" };
}

export const clusterFindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [{ data: jobs }, { data: findings }] = await Promise.all([
      supabase.from("multimedia_analysis_jobs")
        .select("id, source_ref, source_kind, source_metadata, target_name")
        .eq("user_id", userId),
      supabase.from("timestamp_findings")
        .select("id, job_id, title, extracted_claim_id, severity, created_at, confidence")
        .eq("user_id", userId),
    ]);
    const jobMap = new Map((jobs ?? []).map((j: any) => [j.id, j]));

    // Group findings by cluster key
    const groups = new Map<string, { key: string; kind: string; target: string; findings: any[]; sources: Set<string>; reach: number; dominantHost?: string; hostCounts: Map<string, number> }>();
    for (const f of findings ?? []) {
      const job = jobMap.get(f.job_id);
      if (!job) continue;
      const { key, kind } = clusterKeyFor(job, f);
      const g = groups.get(key) ?? { key, kind, target: job.target_name, findings: [], sources: new Set<string>(), reach: 0, hostCounts: new Map<string, number>() };
      g.findings.push({ ...f, job });
      g.sources.add(job.source_ref);
      g.reach += Number(job.source_metadata?.view_count ?? 0);
      const host = (() => { try { return new URL(job.source_ref).host; } catch { return job.source_kind; } })();
      g.hostCounts.set(host, (g.hostCounts.get(host) ?? 0) + 1);
      groups.set(key, g);
    }

    let created = 0, updated = 0, linked = 0;
    for (const g of groups.values()) {
      const times = g.findings.map((f) => new Date(f.created_at).getTime()).sort((a, b) => a - b);
      const first = new Date(times[0]).toISOString();
      const latest = new Date(times[times.length - 1]).toISOString();
      const dominant = [...g.hostCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      // Upsert cluster
      const { data: existing } = await supabase.from("narrative_clusters")
        .select("id").eq("user_id", userId).eq("cluster_key", g.key).maybeSingle();
      let clusterId: string;
      const payload = {
        user_id: userId,
        cluster_key: g.key,
        target_name: g.target,
        source_count: g.sources.size,
        combined_reach: g.reach,
        first_detected_at: first,
        latest_detected_at: latest,
        dominant_source: dominant,
        narrative_summary: g.findings[0]?.title ?? null,
        sources: Array.from(g.sources).slice(0, 100) as any,
      };
      if (existing?.id) {
        clusterId = existing.id;
        await supabase.from("narrative_clusters").update(payload).eq("id", clusterId);
        updated++;
      } else {
        const { data: ins } = await supabase.from("narrative_clusters")
          .insert(payload).select("id").single();
        clusterId = ins!.id as string;
        created++;
      }
      // Backfill cluster_id on findings
      const ids = g.findings.map((f) => f.id);
      if (ids.length) {
        await supabase.from("timestamp_findings").update({ cluster_id: clusterId } as any).in("id", ids);
        linked += ids.length;
      }
    }

    return { created, updated, linked, clusters: groups.size };
  });

export const listNarrativeClusters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("narrative_clusters")
      .select("*").eq("user_id", userId)
      .order("latest_detected_at", { ascending: false }).limit(100);
    // Compute derived metrics client-side data
    const clusters = (data ?? []).map((c: any) => {
      const ageDays = Math.max(1, (Date.now() - new Date(c.first_detected_at).getTime()) / 86400000);
      const velocity = c.source_count / ageDays;
      const threat = Math.min(100, Math.round(velocity * 10 + Math.log10(Math.max(1, c.combined_reach)) * 8 + c.source_count * 3));
      return { ...c, narrative_velocity: Number(velocity.toFixed(2)), threat_score: threat };
    });
    return { clusters };
  });

export const getClusterDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ clusterId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: cluster }, { data: findings }] = await Promise.all([
      supabase.from("narrative_clusters").select("*").eq("id", data.clusterId).maybeSingle(),
      supabase.from("timestamp_findings").select("*").eq("cluster_id", data.clusterId).order("created_at", { ascending: false }),
    ]);
    return { cluster, findings: findings ?? [] };
  });
