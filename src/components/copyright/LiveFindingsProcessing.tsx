import { useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  CircleAlert,
  Search,
  CheckCircle2,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import {
  parseWebsiteActivity,
  sanitizeActivityHostname,
  type ScanActivityEvent,
  type ScanActivityThreat,
} from "@/lib/copyright/scan-activity";

export interface LiveFindingCandidateItem {
  id: string;
  url: string;
  domain: string;
  title: string;
  faviconUrl: string;
  progressPercent: number;
  statusStage:
    | "DISCOVERED"
    | "SCANNING"
    | "ANALYZING"
    | "POTENTIAL THREAT"
    | "VERIFYING"
    | "VERIFIED THREAT"
    | "SAFE"
    | "REJECTED";
  colorTone: "blue" | "purple" | "orange" | "red" | "green" | "gray";
  confidence?: number;
  evidenceUrl?: string | null;
}

export interface LiveFindingsProcessingProps {
  stats: Record<string, unknown> | null | undefined;
  scanStatus?: string | null;
  scanId?: string | null;
  matches?: Array<Record<string, unknown>> | null;
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return sanitizeActivityHostname(url) ?? "example-site.com";
  }
}

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return `${parsed.hostname}${parsed.pathname.length > 1 ? parsed.pathname : ""}`;
  } catch {
    return url;
  }
}

export function parseLiveCandidateItems(
  stats: Record<string, unknown> | null | undefined,
  matches?: Array<Record<string, unknown>> | null,
): LiveFindingCandidateItem[] {
  const items: LiveFindingCandidateItem[] = [];
  const seenUrls = new Set<string>();

  // 1. Incorporate persisted matches first
  if (matches && matches.length > 0) {
    for (const m of matches) {
      const url = String(m.source_url || m.url || "");
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      const domain = extractDomain(url);
      const title = String(m.page_title || m.title || `${domain} lead`);
      const confidence = Number(m.confidence ?? 0);
      const isDismissed = m.review_status === "dismissed";
      const isConfirmed = confidence >= 90 || m.confidence_band === "confirmed";
      const isProbable = m.confidence_band === "probable" || confidence >= 65;

      let statusStage: LiveFindingCandidateItem["statusStage"] = "ANALYZING";
      let colorTone: LiveFindingCandidateItem["colorTone"] = "purple";
      let progressPercent = 65;

      if (isDismissed) {
        statusStage = "REJECTED";
        colorTone = "gray";
        progressPercent = 100;
      } else if (isConfirmed) {
        statusStage = "VERIFIED THREAT";
        colorTone = "red";
        progressPercent = 100;
      } else if (isProbable) {
        statusStage = "POTENTIAL THREAT";
        colorTone = "orange";
        progressPercent = 85;
      } else {
        statusStage = "VERIFYING";
        colorTone = "purple";
        progressPercent = 75;
      }

      items.push({
        id: String(m.id || url),
        url: truncateUrl(url),
        domain,
        title,
        faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
        progressPercent,
        statusStage,
        colorTone,
        confidence,
        evidenceUrl: url.startsWith("http") ? url : `https://${url}`,
      });
    }
  }

  // 2. Parse live telemetry activities from stats
  const activityEvents = parseWebsiteActivity(stats);
  for (const ev of activityEvents) {
    const host = ev.hostname;
    if (!host || seenUrls.has(host)) continue;
    seenUrls.add(host);

    let statusStage: LiveFindingCandidateItem["statusStage"] = "DISCOVERED";
    let colorTone: LiveFindingCandidateItem["colorTone"] = "blue";
    let progressPercent = 25;

    switch (ev.threat) {
      case "checking":
        statusStage = ev.stage === "classifying" ? "ANALYZING" : "SCANNING";
        colorTone = ev.stage === "classifying" ? "purple" : "blue";
        progressPercent = ev.stage === "classifying" ? 60 : 40;
        break;
      case "potential":
        statusStage = "POTENTIAL THREAT";
        colorTone = "orange";
        progressPercent = 80;
        break;
      case "high_risk":
      case "verified_finding":
        statusStage = "VERIFIED THREAT";
        colorTone = "red";
        progressPercent = 100;
        break;
      case "excluded":
      case "no_threat":
        statusStage = "SAFE";
        colorTone = "green";
        progressPercent = 100;
        break;
      case "retrieval_failed":
      case "blocked_safety":
        statusStage = "REJECTED";
        colorTone = "gray";
        progressPercent = 100;
        break;
    }

    items.push({
      id: ev.id,
      url: `${host}/${ev.page_label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      domain: host,
      title: ev.page_label,
      faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
      progressPercent,
      statusStage,
      colorTone,
      evidenceUrl: ev.evidence_href ?? null,
    });
  }

  // 3. Fallback seeds from stats.distribution_summary if list is empty
  if (items.length === 0 && stats?.distribution_summary && Array.isArray(stats.distribution_summary)) {
    for (const d of stats.distribution_summary as Array<Record<string, unknown>>) {
      const url = String(d.url || "");
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      const domain = extractDomain(url);
      const highRisk = d.domain_risk === "high";

      items.push({
        id: url,
        url: truncateUrl(url),
        domain,
        title: String(d.url ?? "Distribution lead"),
        faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
        progressPercent: highRisk ? 100 : 70,
        statusStage: highRisk ? "VERIFIED THREAT" : "ANALYZING",
        colorTone: highRisk ? "red" : "purple",
        confidence: Number(d.confidence ?? 70),
        evidenceUrl: url.startsWith("http") ? url : `https://${url}`,
      });
    }
  }

  return items;
}

function toneClasses(tone: LiveFindingCandidateItem["colorTone"]) {
  switch (tone) {
    case "blue":
      return {
        badge: "border-sky-500/40 bg-sky-500/10 text-sky-300",
        bar: "from-sky-500/40 via-sky-400 to-sky-500/40",
        glow: "border-sky-500/30 bg-sky-500/5",
        text: "text-sky-400",
      };
    case "purple":
      return {
        badge: "border-purple-500/40 bg-purple-500/10 text-purple-300",
        bar: "from-purple-500/40 via-purple-400 to-purple-500/40",
        glow: "border-purple-500/30 bg-purple-500/5",
        text: "text-purple-400",
      };
    case "orange":
      return {
        badge: "border-orange-500/50 bg-orange-500/10 text-orange-300",
        bar: "from-orange-500/50 via-orange-400 to-orange-500/50",
        glow: "border-orange-500/40 bg-orange-500/5",
        text: "text-orange-400",
      };
    case "red":
      return {
        badge: "border-red-500/60 bg-red-500/15 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.2)]",
        bar: "from-red-500 via-red-400 to-red-600",
        glow: "border-red-500/40 bg-red-500/10",
        text: "text-red-400",
      };
    case "green":
      return {
        badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        bar: "from-emerald-500 via-emerald-400 to-emerald-600",
        glow: "border-emerald-500/30 bg-emerald-500/5",
        text: "text-emerald-400",
      };
    case "gray":
    default:
      return {
        badge: "border-slate-500/30 bg-slate-500/10 text-slate-400",
        bar: "from-slate-600/40 to-slate-500/40",
        glow: "border-slate-500/20 bg-background/20 opacity-60",
        text: "text-slate-400",
      };
  }
}

export function LiveFindingsProcessing({
  stats,
  scanStatus,
  scanId,
  matches,
}: LiveFindingsProcessingProps) {
  const candidates = useMemo(() => parseLiveCandidateItems(stats, matches), [stats, matches]);
  const isScanning = scanStatus === "queued" || scanStatus === "running" || scanStatus === "pending";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative grid h-2.5 w-2.5 place-items-center">
            <span className={`absolute h-full w-full rounded-full bg-primary ${isScanning ? "animate-ping opacity-75" : ""}`} />
            <span className="relative h-2 w-2 rounded-full bg-primary" />
          </span>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live Findings Processing
          </h3>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {candidates.length} candidate(s) tracked
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 bg-background/20 p-6 text-center space-y-2">
          <Loader2 className={`mx-auto h-5 w-5 text-primary ${isScanning ? "animate-spin" : ""}`} />
          <p className="text-xs text-muted-foreground">
            {isScanning
              ? "Scanning web sources & resolving live candidate URLs..."
              : "No candidate URLs processed for this scan."}
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {candidates.map((item) => {
            const styles = toneClasses(item.colorTone);
            const isFinished = item.progressPercent >= 100;

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-3 text-xs transition-all duration-300 space-y-2.5 ${styles.glow}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <img
                      src={item.faviconUrl}
                      alt={item.domain}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                      className="h-4 w-4 shrink-0 rounded mt-0.5 object-contain"
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-semibold truncate text-foreground/95">{item.title}</p>
                      <p className="font-mono text-[11px] text-muted-foreground truncate">{item.url}</p>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {item.evidenceUrl && (
                      <a
                        href={item.evidenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="View source"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${styles.badge}`}
                    >
                      {!isFinished && item.colorTone !== "gray" && (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      )}
                      {item.statusStage}
                    </span>
                  </div>
                </div>

                {/* Smooth Animated Progress Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                    <span>Stage Progress</span>
                    <span className={`font-semibold ${styles.text}`}>{item.progressPercent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60 relative">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${styles.bar} transition-all duration-500 ease-out`}
                      style={{ width: `${item.progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
