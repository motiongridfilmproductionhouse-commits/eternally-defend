/**
 * Aggregate real dashboard stats for the bottom-row cards.
 * Backed by multimedia_analysis_jobs + timestamp_findings.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Sev = "info" | "low" | "medium" | "high" | "critical";
const SEV_WEIGHT: Record<Sev, number> = { info: 1, low: 3, medium: 5, high: 8, critical: 10 };

function platformFromRef(kind: string, ref: string): string {
  const r = (ref || "").toLowerCase();
  if (kind === "youtube_meta" || r.includes("youtu")) return "YouTube";
  if (r.includes("tiktok")) return "TikTok";
  if (r.includes("instagram")) return "Instagram";
  if (r.includes("facebook") || r.includes("fb.com")) return "Facebook";
  if (r.includes("twitter") || r.includes("x.com")) return "X";
  if (r.includes("reddit")) return "Reddit";
  if (kind === "upload_video") return "Uploaded Video";
  if (kind === "upload_audio") return "Uploaded Audio";
  if (kind === "upload_image" || kind === "screenshot") return "Uploaded Image";
  return "Web";
}

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;

    const [jobsRes, findingsRes] = await Promise.all([
      supabase
        .from("multimedia_analysis_jobs")
        .select("id, source_kind, source_ref, target_name, status, reputation_score, risk_scores, created_at, source_metadata")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("timestamp_findings")
        .select("id, job_id, finding_type, severity, title, description, confidence, created_at, review_status")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const jobs = jobsRes.data ?? [];
    const findings = findingsRes.data ?? [];

    // -------- AI Exposure Index --------
    const sevScore =
      findings.length === 0
        ? 0
        : findings.reduce((s, f) => s + (SEV_WEIGHT[(f.severity as Sev) ?? "low"] ?? 3), 0) /
          Math.max(findings.length, 1);
    const exposure = Math.round(Math.min(10, sevScore) * 10) / 10;
    const totalReach = jobs.reduce((s, j) => {
      const v = Number((j.source_metadata as any)?.view_count ?? 0);
      return s + (isFinite(v) ? v : 0);
    }, 0);
    const avgRep =
      jobs.filter((j) => j.reputation_score != null).reduce((s, j) => s + Number(j.reputation_score), 0) /
      Math.max(jobs.filter((j) => j.reputation_score != null).length, 1);
    const reputationImpact = Number.isFinite(avgRep) ? Math.round(avgRep - 100) : 0;
    const criticals = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
    const trustLoss = criticals >= 10 ? "High" : criticals >= 3 ? "Medium" : criticals > 0 ? "Low" : "None";
    const severityLabel =
      exposure >= 8 ? "Critical" : exposure >= 6 ? "High Severity" : exposure >= 4 ? "Medium" : exposure > 0 ? "Low" : "No Data";

    // -------- Unauthorized Usage --------
    const unauthorizedFindings = findings.filter((f) =>
      ["copyright_match", "logo_match", "unauthorized_ad", "impersonation"].includes(f.finding_type ?? ""),
    );
    const platformCounts = new Map<string, number>();
    for (const f of unauthorizedFindings) {
      const job = jobs.find((j) => j.id === f.job_id);
      if (!job) continue;
      const p = platformFromRef(job.source_kind, job.source_ref);
      platformCounts.set(p, (platformCounts.get(p) ?? 0) + 1);
    }
    const revenueLost = unauthorizedFindings.length * 1750; // $1,750 est per unauthorized use
    const unauthorized = {
      detected: unauthorizedFindings.length,
      platforms: [...platformCounts.entries()].map(([name, count]) => ({ name, count })),
      revenueLost,
    };

    // -------- Deepfake Intelligence --------
    const deepfakes = findings.filter((f) =>
      ["deepfake", "face_swap", "voice_clone", "synthetic_media"].includes(f.finding_type ?? ""),
    );
    const avgConf = (subset: typeof findings) =>
      subset.length === 0
        ? 0
        : Math.round(
            (subset.reduce((s, f) => s + Number(f.confidence ?? 0), 0) / subset.length) * 100,
          );
    const faceMatch = avgConf(deepfakes.filter((f) => f.finding_type === "face_swap" || f.finding_type === "deepfake"));
    const voiceMatch = avgConf(deepfakes.filter((f) => f.finding_type === "voice_clone"));
    const deepfakeProb = avgConf(deepfakes);
    const deepfakeRisk =
      deepfakeProb >= 80 ? "Critical" : deepfakeProb >= 60 ? "High" : deepfakeProb >= 40 ? "Medium" : deepfakeProb > 0 ? "Low" : "None";

    // -------- Top Active Threats --------
    const byJob = new Map<string, { count: number; maxSev: number; latest: string }>();
    for (const f of findings) {
      const cur = byJob.get(f.job_id) ?? { count: 0, maxSev: 0, latest: f.created_at as string };
      cur.count += 1;
      cur.maxSev = Math.max(cur.maxSev, SEV_WEIGHT[(f.severity as Sev) ?? "low"] ?? 3);
      if ((f.created_at as string) > cur.latest) cur.latest = f.created_at as string;
      byJob.set(f.job_id, cur);
    }
    const topThreats = [...byJob.entries()]
      .map(([jobId, agg]) => {
        const job = jobs.find((j) => j.id === jobId);
        if (!job) return null;
        const score = Math.min(10, Math.round(agg.maxSev * 10) / 10);
        const tag = score >= 9 ? "Critical" : score >= 7 ? "High" : score >= 5 ? "Medium" : "Low";
        return {
          jobId,
          title: (job.source_metadata as any)?.title || job.target_name || "Untitled",
          platform: platformFromRef(job.source_kind, job.source_ref),
          score,
          tag,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    return {
      exposure: {
        score: exposure,
        severityLabel,
        reach: totalReach,
        reputationImpact,
        trustLoss,
      },
      unauthorized,
      deepfake: {
        faceMatch,
        voiceMatch,
        deepfakeProb,
        risk: deepfakeRisk,
        sampleCount: deepfakes.length,
      },
      topThreats,
      totals: {
        jobs: jobs.length,
        findings: findings.length,
      },
    };
  });
