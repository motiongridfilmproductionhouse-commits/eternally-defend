/**
 * Pure mapping helpers for the detection → case handoff. Kept out of the
 * server-function module so code-splitting cannot strip them at runtime.
 */

export type FindingLike = {
  title: string | null;
  permalink: string | null;
  canonical_url: string | null;
  source: string | null;
  source_type: string | null;
  severity: string | null;
  risk_type: string | null;
};

export type CaseType = "DMCA" | "Legal" | "Platform" | "Investigation";
export type CasePriority = "Critical" | "High" | "Medium" | "Low";

export function caseTypeForFinding(hit: FindingLike): CaseType {
  const bag = `${hit.risk_type ?? ""} ${hit.source_type ?? ""}`.toLowerCase();
  if (/copyright|piracy|re-?upload|leak/.test(bag)) return "DMCA";
  if (/defam|libel|false|allegation|legal/.test(bag)) return "Legal";
  if (/impersonat|harass|deepfake|explicit|nudity|privacy/.test(bag)) return "Platform";
  return "Investigation";
}

export function casePriorityForSeverity(severity: string | null): CasePriority {
  const s = (severity ?? "").toLowerCase();
  if (s === "critical") return "Critical";
  if (s === "high") return "High";
  if (s === "low" || s === "info") return "Low";
  return "Medium";
}

export function caseSubjectFor(hit: FindingLike): string {
  const raw = (hit.title ?? "").trim();
  const host = (() => {
    const url = hit.permalink ?? hit.canonical_url ?? "";
    try {
      return url ? new URL(url).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  })();
  const base = raw || host || hit.source || "Untitled detection";
  const trimmed = base.length > 120 ? `${base.slice(0, 117)}…` : base;
  return host && !trimmed.includes(host) ? `${trimmed} · ${host}` : trimmed;
}
