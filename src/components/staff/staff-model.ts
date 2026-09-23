/**
 * View-model helpers for the staff scan experience (pure, client-safe).
 * Everything derives from the stored-row snapshot returned by getProspectScan.
 */

import type { ScanSnapshotView, SourceView } from "@/lib/prospect/snapshot.server";
import type { DiscoveryRow, FindingRow } from "@/lib/prospect/analysis";

export type RailKey =
  | "ai_manipulation"
  | "harmful_content"
  | "impersonation"
  | "privacy_exposure"
  | "search_reputation"
  | "propagation"
  | "summary";

export const RAIL: Array<{ key: RailKey; n: string; label: string; long: string }> = [
  { key: "ai_manipulation", n: "01", label: "Deepfake", long: "Deepfake & AI Manipulation" },
  {
    key: "harmful_content",
    n: "02",
    label: "Reputation",
    long: "Harmful & Reputation-Risk Content",
  },
  { key: "impersonation", n: "03", label: "Impersonation", long: "Identity Impersonation" },
  { key: "privacy_exposure", n: "04", label: "Privacy", long: "Privacy Exposure" },
  { key: "search_reputation", n: "05", label: "Search Reputation", long: "Search Reputation" },
  { key: "propagation", n: "06", label: "Propagation", long: "Content Propagation" },
  { key: "summary", n: "07", label: "Summary", long: "Digital Exposure Intelligence" },
];

export type RailState = "done" | "active" | "live" | "waiting";

const LIVE_DURING_DISCOVERY: RailKey[] = ["harmful_content", "impersonation", "privacy_exposure"];

export function isFinished(status: unknown): boolean {
  return status === "completed" || status === "partial" || status === "failed";
}

export function railStates(
  snap: Pick<ScanSnapshotView, "scan" | "capabilities">,
): Record<RailKey, RailState> {
  const status = snap.scan.status;
  const stage = String(snap.scan.stage ?? "");
  const finished = isFinished(status);
  const done = new Set(snap.capabilities.map((c) => c.analysis_key));
  const out = {} as Record<RailKey, RailState>;
  for (const item of RAIL) {
    if (item.key === "summary") {
      out.summary = finished ? "done" : stage === "summary" ? "active" : "waiting";
      continue;
    }
    if (done.has(item.key) || finished) out[item.key] = "done";
    else if (stage === item.key) out[item.key] = "active";
    else if (
      (stage === "discovery" || stage === "") &&
      LIVE_DURING_DISCOVERY.includes(item.key) &&
      status === "running"
    )
      out[item.key] = "live";
    else out[item.key] = "waiting";
  }
  return out;
}

/** The stage the workspace should follow automatically. */
export function followStage(snap: Pick<ScanSnapshotView, "scan" | "capabilities">): RailKey {
  const states = railStates(snap);
  if (states.summary === "done") return "summary";
  const active = RAIL.find((r) => states[r.key] === "active");
  if (active) return active.key;
  const live = RAIL.find((r) => states[r.key] === "live");
  return live?.key ?? "ai_manipulation";
}

export function sourceStatusText(s: SourceView): string {
  const failed = (s.providers ?? []).filter((p) =>
    /CREDIT_EXHAUSTED|RATE_LIMITED|AUTH_FAILED|TIMEOUT|PROVIDER_ERROR/.test(p),
  );
  switch (s.state) {
    case "connecting":
      return "Connecting";
    case "scanning":
      return s.raw_results ? `Searching · ${s.raw_results}` : "Searching";
    case "results_found":
      return `Results found · ${s.unique_items}`;
    case "no_results":
      return "No relevant results";
    case "provider_error":
      return failed.length ? humanProviderStatus(failed[0]!.split(":")[1] ?? "") : "Provider error";
    case "policy_disabled":
      return "Policy disabled";
    case "unavailable":
      return "Unavailable";
    default:
      return "Queued";
  }
}

export function humanProviderStatus(status: string): string {
  return (
    (
      {
        CREDIT_EXHAUSTED: "Credit exhausted",
        RATE_LIMITED: "Rate limited",
        AUTH_FAILED: "Auth failed",
        TIMEOUT: "Timed out",
        PROVIDER_ERROR: "Provider error",
        COMPLETE: "Complete",
        SEARCHING: "Searching",
        CONNECTING: "Connecting",
      } as Record<string, string>
    )[status] ?? status.replace(/_/g, " ").toLowerCase()
  );
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type SourceType = "Articles" | "Videos" | "Social posts" | "Forums" | "Other web pages";

export function sourceTypeOf(
  d: Pick<DiscoveryRow, "original_url" | "platform" | "media_kind">,
): SourceType {
  const u = d.original_url.toLowerCase();
  if (d.media_kind === "video" || /youtube\.com|youtu\.be|tiktok\.com|\/reel|\/watch/.test(u))
    return "Videos";
  if (/reddit\.com|quora\.com|forum|\/threads?\//.test(u)) return "Forums";
  if (/instagram\.com|facebook\.com|x\.com|twitter\.com|threads\.net/.test(u))
    return "Social posts";
  if (
    /news|times|herald|express|hindu|mirror|post|tribune|reporter|\/article|bbc|reuters|cnn|ndtv|manorama|mathrubhumi/.test(
      u,
    )
  )
    return "Articles";
  return "Other web pages";
}

export const FINDING_STATE_LABEL: Record<string, string> = {
  DISCOVERED: "Discovered",
  CLASSIFIED: "Classified",
  NEEDS_HUMAN_REVIEW: "Needs review",
  VERIFIED: "Human verified",
  REJECTED: "Rejected",
  ESCALATED: "Escalated",
};

export const IDENTITY_LABEL: Record<string, string> = {
  MATCHED: "Identity matched",
  POSSIBLE_MATCH: "Possible match",
  NEEDS_IDENTITY_REVIEW: "Needs identity review",
  UNRELATED: "Unrelated",
};

export function stateTone(state: string): string {
  if (state === "VERIFIED") return "ok";
  if (state === "ESCALATED") return "risk";
  if (state === "REJECTED") return "mute";
  if (state === "NEEDS_HUMAN_REVIEW") return "warn";
  return "blue";
}

export function identityTone(bucket: string): string {
  if (bucket === "MATCHED") return "ok";
  if (bucket === "UNRELATED") return "mute";
  return "violet";
}

export interface JoinedFinding extends FindingRow {
  created_at: string;
  discovery: DiscoveryRow | undefined;
}

export function joinFindings(
  snap: Pick<ScanSnapshotView, "findings" | "discoveries">,
  stage?: string,
): JoinedFinding[] {
  const byId = new Map(snap.discoveries.map((d) => [d.id, d]));
  return snap.findings
    .filter((f) => !stage || f.stage_key === stage)
    .map((f) => ({ ...f, discovery: byId.get(f.discovery_id) }))
    .sort((a, b) => {
      const am = a.discovery?.identity_bucket === "MATCHED" ? 0 : 1;
      const bm = b.discovery?.identity_bucket === "MATCHED" ? 0 : 1;
      return am - bm || Number(b.severity ?? 0) - Number(a.severity ?? 0);
    });
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const t = Date.parse(value);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtTime(value: string | null | undefined): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function bandLabel(band: string | null | undefined): string {
  if (!band) return "—";
  if (band === "PENDING_VERIFICATION") return "Pending verification";
  if (band === "INSUFFICIENT_DATA") return "Insufficient data";
  return band;
}
