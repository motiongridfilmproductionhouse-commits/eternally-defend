import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Sev = "Critical" | "High" | "Medium" | "Low" | "Info";
const SEV_WEIGHT: Record<string, number> = { Critical: 10, High: 8, Medium: 5, Low: 3, Info: 1, critical: 10, high: 8, medium: 5, low: 3, info: 1 };

function bucketPlatform(source: string | null | undefined): string {
  const s = (source ?? "").toLowerCase();
  if (s.includes("youtube")) return "YouTube";
  if (s.includes("tiktok")) return "TikTok";
  if (s.includes("insta")) return "Instagram";
  if (s.includes("facebook") || s.includes("fb")) return "Facebook";
  if (s.includes("twitter") || s === "x" || s.includes("x.com")) return "X";
  if (s.includes("reddit")) return "Reddit";
  if (s.includes("news")) return "News";
  if (s.includes("blog")) return "Blogs";
  if (s.includes("forum")) return "Forums";
  return source || "Web";
}

const SPOILER_MAP: Record<string, string> = {
  defamation: "Defamation",
  "false claim": "False Claims",
  "false-claim": "False Claims",
  misinformation: "False Claims",
  "fake news": "Fake News",
  fake_news: "Fake News",
  leak: "Leaks",
  leaks: "Leaks",
  exposed: "Exposed Content",
  scandal: "Scandals",
  harassment: "Harassment",
  hate: "Hate Content",
  manipulation: "Manipulation",
  deepfake: "Manipulation",
  impersonation: "Manipulation",
};

function spoilerCategory(riskType: string | null, tags: string[] | null): string | null {
  const bag = [(riskType ?? "").toLowerCase(), ...(tags ?? []).map((t) => t.toLowerCase())];
  for (const key of Object.keys(SPOILER_MAP)) {
    if (bag.some((b) => b.includes(key))) return SPOILER_MAP[key];
  }
  return null;
}

export const getCommandCenterStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const now = Date.now();
    const since14 = new Date(now - 14 * 86_400_000).toISOString();
    const since24h = new Date(now - 86_400_000).toISOString();
    const since48h = new Date(now - 2 * 86_400_000).toISOString();

    const [hitsRes, scansRes, enfRes, evidenceRes, assetsRes, casesRes, profileRes, jobsRes] = await Promise.all([
      supabase
        .from("scan_hits")
        .select("id, source, source_type, title, permalink, canonical_url, thumbnail_url, author, published_at, first_seen_at, reach, engagement, threat_score, risk_score, severity, risk_type, tags, growth_pct, hidden_at")
        .eq("user_id", userId)
        .is("hidden_at", null)
        .gte("first_seen_at", since14)
        .order("first_seen_at", { ascending: false })
        .limit(500),
      supabase.from("scans").select("id, name, query, status, sources, total_hits, started_at, completed_at, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
      supabase.from("enforcement_requests").select("id, status, submission_status, platform, created_at, submitted_at, target_url").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
      supabase.from("enforcement_evidence").select("id, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
      supabase.from("protected_assets").select("id, name, kind, created_at").eq("user_id", userId),
      supabase.from("cases").select("id, status, priority, created_at").eq("user_id", userId),
      supabase.from("client_profiles").select("authorization_level, authorization_status, target_name").eq("user_id", userId).maybeSingle(),
      supabase.from("multimedia_analysis_jobs").select("reputation_score").eq("user_id", userId).not("reputation_score", "is", null).order("created_at", { ascending: false }).limit(50),
    ]);

    const hits = hitsRes.data ?? [];
    const scans = scansRes.data ?? [];
    const enforcements = enfRes.data ?? [];
    const evidence = evidenceRes.data ?? [];
    const assets = assetsRes.data ?? [];
    const cases = casesRes.data ?? [];
    const profile = profileRes.data ?? null;
    const jobs = jobsRes.data ?? [];

    // Reputation score: derive from jobs, fall back to 100 - avg(threat_score)
    let reputation = 100;
    if (jobs.length) {
      reputation = Math.round(jobs.reduce((s, j) => s + Number(j.reputation_score ?? 0), 0) / jobs.length);
    } else if (hits.length) {
      const avg = hits.reduce((s, h) => s + Number(h.threat_score ?? 0), 0) / hits.length;
      reputation = Math.max(0, Math.min(100, Math.round(100 - avg)));
    }

    // Severity distribution
    const bySev: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
    for (const h of hits) {
      const sev = (h.severity as string) || "Low";
      const key = sev[0]?.toUpperCase() + sev.slice(1).toLowerCase();
      if (bySev[key] !== undefined) bySev[key]++;
    }
    const critical = bySev.Critical;
    const high = bySev.High;

    // Threat level
    let threatLevel: "Safe" | "Low" | "Moderate" | "High" | "Critical" = "Safe";
    if (critical > 5) threatLevel = "Critical";
    else if (critical > 0 || high > 5) threatLevel = "High";
    else if (high > 0 || bySev.Medium > 5) threatLevel = "Moderate";
    else if (hits.length > 0) threatLevel = "Low";

    // Velocity: last 24h vs prior 24h
    const last24 = hits.filter((h) => (h.first_seen_at as string) >= since24h).length;
    const prior24 = hits.filter((h) => (h.first_seen_at as string) >= since48h && (h.first_seen_at as string) < since24h).length;
    const velocityDelta = last24 - prior24;

    const totalReach = hits.reduce((s, h) => s + Number(h.reach ?? 0), 0);

    // Danger meter composite (0-100)
    const avgThreat = hits.length ? hits.reduce((s, h) => s + Number(h.threat_score ?? 0), 0) / hits.length : 0;
    const reachFactor = Math.min(1, Math.log10(totalReach + 1) / 8);
    const velocityFactor = Math.min(1, Math.max(0, velocityDelta) / 20);
    const criticalFactor = Math.min(1, critical / 10);
    const danger = Math.round((avgThreat * 0.4 + reachFactor * 100 * 0.25 + velocityFactor * 100 * 0.2 + criticalFactor * 100 * 0.15));
    let dangerZone: "SAFE" | "WATCH" | "DANGER" | "CRITICAL" = "SAFE";
    if (danger >= 75) dangerZone = "CRITICAL";
    else if (danger >= 50) dangerZone = "DANGER";
    else if (danger >= 25) dangerZone = "WATCH";

    // Enforcement counts
    const enforceOpen = enforcements.filter((e) => !["resolved", "closed", "rejected"].includes(e.status)).length;
    const enforcePending = enforcements.filter((e) => e.submission_status === "pending" || e.status === "draft").length;
    const activeScans = scans.filter((s) => s.status === "running" || s.status === "queued").length;

    // Radar nodes (top 40 by threat_score * log(reach))
    const scored = hits
      .map((h) => {
        const score = Number(h.threat_score ?? 0);
        const reach = Number(h.reach ?? 0);
        const w = score * Math.log10(reach + 10);
        return { h, w };
      })
      .sort((a, b) => b.w - a.w)
      .slice(0, 40);
    const radar = scored.map(({ h }) => ({
      id: h.id as string,
      platform: bucketPlatform(h.source as string),
      title: (h.title as string) || (h.canonical_url as string) || "Untitled",
      severity: (h.severity as string) || "Low",
      threatScore: Number(h.threat_score ?? 0),
      reach: Number(h.reach ?? 0),
      permalink: (h.permalink as string) || (h.canonical_url as string) || null,
      thumbnail: (h.thumbnail_url as string) || null,
    }));

    // Trending: top 10
    const trending = radar.slice(0, 10).map((r) => ({ ...r }));

    // Threat heatmap: platform × severity
    const platformCounts = new Map<string, Record<string, number>>();
    for (const h of hits) {
      const p = bucketPlatform(h.source as string);
      const sev = (h.severity as string) || "Low";
      const key = sev[0]?.toUpperCase() + sev.slice(1).toLowerCase();
      const row = platformCounts.get(p) ?? { Critical: 0, High: 0, Medium: 0, Low: 0, Info: 0 };
      if (row[key] !== undefined) row[key]++;
      platformCounts.set(p, row);
    }
    const heatmap = [...platformCounts.entries()]
      .map(([platform, counts]) => ({ platform, ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total);

    // Spoiler detector
    const spoilerAgg = new Map<string, { count: number; reach: number; maxSev: number }>();
    for (const h of hits) {
      const cat = spoilerCategory(h.risk_type as string, h.tags as string[]);
      if (!cat) continue;
      const cur = spoilerAgg.get(cat) ?? { count: 0, reach: 0, maxSev: 0 };
      cur.count++;
      cur.reach += Number(h.reach ?? 0);
      cur.maxSev = Math.max(cur.maxSev, SEV_WEIGHT[(h.severity as string) ?? "Low"] ?? 3);
      spoilerAgg.set(cat, cur);
    }
    const spoilers = [...spoilerAgg.entries()]
      .map(([category, v]) => ({ category, ...v, risk: v.maxSev >= 9 ? "Critical" : v.maxSev >= 7 ? "High" : v.maxSev >= 5 ? "Medium" : "Low" }))
      .sort((a, b) => b.count - a.count);

    // Live scanners: derive from recent scans + sources
    const scannerKinds = ["Web", "YouTube", "News", "Reddit", "Social", "Archive"];
    const liveScanners = scannerKinds.map((kind) => {
      const s = scans.find((x) => (x.sources ?? []).some((src: string) => src.toLowerCase().includes(kind.toLowerCase())));
      if (!s) return { kind, status: "idle", query: null as string | null, progress: 0, results: 0 };
      return {
        kind,
        status: s.status,
        query: s.query as string,
        progress: s.status === "completed" ? 100 : s.status === "running" ? 60 : s.status === "queued" ? 10 : 0,
        results: Number(s.total_hits ?? 0),
      };
    });

    // Timeline: merge events
    const timeline: { time: string; type: string; label: string; sub?: string }[] = [];
    for (const h of hits.slice(0, 8)) timeline.push({ time: h.first_seen_at as string, type: "finding", label: (h.title as string) || "New finding", sub: bucketPlatform(h.source as string) });
    for (const e of evidence.slice(0, 5)) timeline.push({ time: e.created_at as string, type: "evidence", label: "Evidence captured" });
    for (const e of enforcements.slice(0, 5)) timeline.push({ time: (e.submitted_at as string) || (e.created_at as string), type: "enforcement", label: `Enforcement ${e.status}`, sub: e.platform as string });
    timeline.sort((a, b) => (b.time > a.time ? 1 : -1));

    // Asset exposure — join by target_name contained in title
    const targetName = (profile?.target_name as string) || "";
    const assetExposure = assets.slice(0, 6).map((a) => {
      const name = (a.name as string) || "";
      const rel = hits.filter((h) => name && ((h.title as string) ?? "").toLowerCase().includes(name.toLowerCase()));
      return {
        name,
        kind: (a.kind as string) || "asset",
        mentions: rel.length,
        threats: rel.filter((h) => ["Critical", "High"].includes((h.severity as string) || "")).length,
        reach: rel.reduce((s, h) => s + Number(h.reach ?? 0), 0),
        riskScore: rel.length ? Math.round(rel.reduce((s, h) => s + Number(h.threat_score ?? 0), 0) / rel.length) : 0,
      };
    });

    // 7-day sparklines
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) days.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
    const dayBucket = (list: { first_seen_at?: string; created_at?: string }[], key: "first_seen_at" | "created_at") => {
      const m = new Map(days.map((d) => [d, 0]));
      for (const r of list) {
        const t = (r as any)[key] as string;
        if (!t) continue;
        const d = t.slice(0, 10);
        if (m.has(d)) m.set(d, (m.get(d) ?? 0) + 1);
      }
      return days.map((d) => ({ d, v: m.get(d) ?? 0 }));
    };

    const findingsSpark = dayBucket(hits.map((h) => ({ first_seen_at: h.first_seen_at as string })), "first_seen_at");
    const criticalSpark = dayBucket(hits.filter((h) => (h.severity as string) === "Critical").map((h) => ({ first_seen_at: h.first_seen_at as string })), "first_seen_at");

    const trend = (arr: { v: number }[]) => {
      const half = Math.floor(arr.length / 2);
      const a = arr.slice(0, half).reduce((s, x) => s + x.v, 0);
      const b = arr.slice(half).reduce((s, x) => s + x.v, 0);
      if (b > a) return "up" as const;
      if (b < a) return "down" as const;
      return "flat" as const;
    };

    return {
      target: targetName || null,
      protection: {
        level: (profile?.authorization_level as string) ?? null,
        status: (profile?.authorization_status as string) ?? "pending",
      },
      top: {
        reputation,
        threatLevel,
        activeScans,
        protectedAssets: assets.length,
        criticalCases: cases.filter((c) => (c.priority as string) === "critical" || (c.status as string) === "critical").length,
        pendingActions: enforcePending,
        openEnforcement: enforceOpen,
      },
      overview: {
        totalFindings: hits.length,
        criticalFindings: critical,
        newToday: last24,
        escalated: enforcements.length,
        resolved: enforcements.filter((e) => e.status === "resolved").length,
        falsePositives: (hits as any[]).filter((h) => (h.tags ?? []).includes("false_positive")).length,
        findingsSpark,
        criticalSpark,
        findingsTrend: trend(findingsSpark),
        criticalTrend: trend(criticalSpark),
      },
      danger: { score: danger, zone: dangerZone, velocityDelta, totalReach },
      radar,
      trending,
      heatmap,
      spoilers,
      liveScanners,
      assetExposure,
      timeline: timeline.slice(0, 12),
      generatedAt: new Date().toISOString(),
    };
  });

export const getNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [hitsRes, enfRes, assetsRes] = await Promise.all([
      supabase
        .from("scan_hits")
        .select("id, title, source, severity, first_seen_at, permalink, canonical_url")
        .eq("user_id", userId)
        .in("severity", ["Critical", "High"] as never)
        .is("hidden_at", null)
        .gte("first_seen_at", since)
        .order("first_seen_at", { ascending: false })
        .limit(30),
      supabase
        .from("enforcement_requests")
        .select("id, status, submission_status, platform, target_url, updated_at, created_at")
        .eq("user_id", userId)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(30),
      supabase
        .from("protected_assets")
        .select("id, name, kind, created_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    type Note = { id: string; kind: "threat" | "enforcement" | "asset" | "digest"; title: string; body: string; time: string; tag: string; tone: string };
    const notes: Note[] = [];

    for (const h of hitsRes.data ?? []) {
      notes.push({
        id: `hit-${h.id}`,
        kind: "threat",
        title: (h.severity as string) === "Critical" ? "Critical threat detected" : "High-severity threat detected",
        body: `${h.source ?? "Web"} — ${(h.title as string) ?? "New finding"}.`,
        time: h.first_seen_at as string,
        tag: (h.severity as string) ?? "High",
        tone: (h.severity as string) === "Critical" ? "oklch(0.63 0.24 25)" : "oklch(0.72 0.18 55)",
      });
    }
    for (const e of enfRes.data ?? []) {
      const isSuccess = e.status === "resolved" || e.submission_status === "accepted";
      notes.push({
        id: `enf-${e.id}`,
        kind: "enforcement",
        title: isSuccess ? "Takedown accepted" : `Enforcement ${e.status}`,
        body: `${e.platform ?? "Platform"} — ${e.target_url ?? "target"}`,
        time: (e.updated_at as string) || (e.created_at as string),
        tag: isSuccess ? "Success" : "Info",
        tone: isSuccess ? "oklch(0.68 0.16 155)" : "oklch(0.55 0.22 295)",
      });
    }
    for (const a of assetsRes.data ?? []) {
      notes.push({
        id: `asset-${a.id}`,
        kind: "asset",
        title: "New asset protected",
        body: `${a.name ?? "Asset"} registered${a.kind ? ` (${a.kind})` : ""}.`,
        time: a.created_at as string,
        tag: "Info",
        tone: "oklch(0.55 0.22 295)",
      });
    }

    notes.sort((a, b) => (b.time > a.time ? 1 : -1));
    return { notes: notes.slice(0, 40), unread: (hitsRes.data ?? []).length + (enfRes.data ?? []).filter((e) => e.status !== "resolved").length };
  });
