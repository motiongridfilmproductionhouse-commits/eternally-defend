import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Severity = "Critical" | "High" | "Medium" | "Low";
export type Status = "Detected" | "In Review" | "Takedown Sent" | "Resolved";

export interface Asset {
  id: string;
  name: string;
  type: "Image" | "Video" | "Audio" | "Document" | "Brand";
  platform: string;
  registered: string;
  status: "Protected" | "Monitoring" | "At Risk";
}

export type SourceType =
  | "YouTube Video"
  | "News Article"
  | "Instagram Post"
  | "Reddit Discussion"
  | "TikTok Video"
  | "Facebook Page"
  | "Unauthorized Advertisement"
  | "Fake Profile"
  | "Copyright Violation";

export type RiskType =
  | "Defamation"
  | "Impersonation"
  | "Deepfake"
  | "Copyright"
  | "Fraud"
  | "Scam"
  | "Brand Abuse"
  | "News Attack";

export type Virality = "Normal" | "Growing" | "Viral" | "Exploding";

export interface Threat {
  id: string;
  title: string;
  sourceType: SourceType;
  riskType: RiskType;
  platform: string;
  severity: Severity;
  detected: string;
  location: string;
  status: Status;
  confidence: number;
  threatScore: number;   // 0-100
  reach: number;         // raw
  sources: number;       // count
  evidence: number;      // findings count
  velocity: Virality;
  firstDetected: string; // e.g. "12 Jul"
  latestActivity: string; // e.g. "14 Jul"
  growthPct: number;     // e.g. 187
  narrativeClaim: string;
  caseId?: string;
}

export interface Case {
  id: string;
  subject: string;
  type: "DMCA" | "Legal" | "Platform" | "Investigation";
  status: "Open" | "In Progress" | "Escalated" | "Closed";
  priority: Severity;
  opened: string;
  assignee: string;
}

export interface Removal {
  id: string;
  url: string;
  platform: string;
  method: "DMCA" | "Platform Report" | "Legal Notice";
  submitted: string;
  status: "Queued" | "Sent" | "Removed" | "Rejected";
}

const seed = {
  assets: [
    { id: "A-001", name: "Brand Logo v3", type: "Brand", platform: "Global", registered: "2026-01-14", status: "Protected" },
    { id: "A-002", name: "Product Launch Video", type: "Video", platform: "YouTube", registered: "2026-02-02", status: "Monitoring" },
    { id: "A-003", name: "Founder Portrait", type: "Image", platform: "Instagram", registered: "2026-02-19", status: "At Risk" },
    { id: "A-004", name: "Podcast Ep. 42 Audio", type: "Audio", platform: "Spotify", registered: "2026-03-08", status: "Protected" },
    { id: "A-005", name: "Whitepaper 2026", type: "Document", platform: "Web", registered: "2026-03-22", status: "Monitoring" },
    { id: "A-006", name: "Campaign Hero Image", type: "Image", platform: "Meta Ads", registered: "2026-04-11", status: "Protected" },
  ] as Asset[],
  threats: [
    { id: "T-9821", title: "Deepfake Video Spreading", sourceType: "YouTube Video", riskType: "Deepfake", platform: "YouTube", severity: "Critical", detected: "08:23 AM", location: "USA", status: "In Review", confidence: 92, threatScore: 92, reach: 248000, sources: 12, evidence: 17, velocity: "Exploding", firstDetected: "12 Jul", latestActivity: "14 Jul", growthPct: 187, narrativeClaim: "Brand X CEO caught in fabricated statement", caseId: "CASE-2031" },
    { id: "T-9822", title: "Impersonation Account", sourceType: "Instagram Post", riskType: "Impersonation", platform: "Instagram", severity: "High", detected: "07:44 AM", location: "India", status: "Detected", confidence: 88, threatScore: 84, reach: 62000, sources: 6, evidence: 9, velocity: "Viral", firstDetected: "11 Jul", latestActivity: "14 Jul", growthPct: 94, narrativeClaim: "Fake founder profile soliciting investments" },
    { id: "T-9823", title: "False News Article", sourceType: "News Article", riskType: "News Attack", platform: "News Portal", severity: "High", detected: "06:12 AM", location: "UK", status: "Takedown Sent", confidence: 81, threatScore: 78, reach: 134000, sources: 4, evidence: 6, velocity: "Growing", firstDetected: "10 Jul", latestActivity: "13 Jul", growthPct: 42, narrativeClaim: "Regulatory investigation allegations (unverified)", caseId: "CASE-2029" },
    { id: "T-9824", title: "Unauthorized Ad Campaign", sourceType: "Unauthorized Advertisement", riskType: "Brand Abuse", platform: "Meta Ads", severity: "Medium", detected: "Yesterday", location: "UAE", status: "In Review", confidence: 76, threatScore: 68, reach: 48000, sources: 3, evidence: 5, velocity: "Growing", firstDetected: "09 Jul", latestActivity: "13 Jul", growthPct: 21, narrativeClaim: "Cloned ad creative used by third party" },
    { id: "T-9825", title: "Viral TikTok Clip Misuse", sourceType: "TikTok Video", riskType: "Copyright", platform: "TikTok", severity: "Medium", detected: "Yesterday", location: "India", status: "Detected", confidence: 71, threatScore: 61, reach: 96000, sources: 8, evidence: 11, velocity: "Viral", firstDetected: "08 Jul", latestActivity: "14 Jul", growthPct: 133, narrativeClaim: "Product footage remixed with false claims" },
    { id: "T-9826", title: "Reddit Copyright Repost", sourceType: "Reddit Discussion", riskType: "Copyright", platform: "Reddit", severity: "Low", detected: "2 days ago", location: "USA", status: "Resolved", confidence: 64, threatScore: 34, reach: 12000, sources: 2, evidence: 3, velocity: "Normal", firstDetected: "07 Jul", latestActivity: "11 Jul", growthPct: 4, narrativeClaim: "Whitepaper excerpt reposted without attribution" },
  ] as Threat[],
  cases: [
    { id: "CASE-2025-0622-0012", subject: "Deepfake takedown - YouTube", type: "DMCA", status: "In Progress", priority: "Critical", opened: "2026-07-05", assignee: "Legal Team" },
    { id: "CASE-2025-0622-0011", subject: "Impersonation account - Instagram", type: "Platform", status: "Open", priority: "High", opened: "2026-07-05", assignee: "Enforcement" },
    { id: "CASE-2025-0622-0009", subject: "False news article - Portal24", type: "Legal", status: "Escalated", priority: "High", opened: "2026-07-04", assignee: "External Counsel" },
    { id: "CASE-2025-0622-0007", subject: "Ad campaign misuse - Meta", type: "Investigation", status: "In Progress", priority: "Medium", opened: "2026-07-03", assignee: "Analyst" },
  ] as Case[],
  removals: [
    { id: "R-4410", url: "youtube.com/watch?v=xxxx", platform: "YouTube", method: "DMCA", submitted: "08:31 AM", status: "Sent" },
    { id: "R-4409", url: "instagram.com/p/abcd", platform: "Instagram", method: "Platform Report", submitted: "Yesterday", status: "Removed" },
    { id: "R-4408", url: "reddit.com/r/x/comments/y", platform: "Reddit", method: "DMCA", submitted: "Yesterday", status: "Removed" },
    { id: "R-4407", url: "tiktok.com/@user/video/1", platform: "TikTok", method: "DMCA", submitted: "2 days ago", status: "Queued" },
    { id: "R-4406", url: "portal24.com/story/deep", platform: "News Portal", method: "Legal Notice", submitted: "2 days ago", status: "Rejected" },
  ] as Removal[],
};

interface Ctx {
  assets: Asset[];
  threats: Threat[];
  cases: Case[];
  removals: Removal[];
  addAsset: (a: Omit<Asset, "id" | "registered">) => void;
  addThreat: (t: Partial<Threat> & Pick<Threat, "title" | "platform" | "severity" | "location" | "confidence">) => void;
  updateThreatStatus: (id: string, status: Status) => void;
  updateCaseStatus: (id: string, status: Case["status"]) => void;
  addRemoval: (r: Omit<Removal, "id" | "submitted" | "status">) => void;
}

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState(seed.assets);
  const [threats, setThreats] = useState(seed.threats);
  const [cases, setCases] = useState(seed.cases);
  const [removals, setRemovals] = useState(seed.removals);

  const value = useMemo<Ctx>(() => ({
    assets, threats, cases, removals,
    addAsset: (a) => setAssets((prev) => [
      { ...a, id: `A-${String(prev.length + 1).padStart(3, "0")}`, registered: new Date().toISOString().slice(0, 10) },
      ...prev,
    ]),
    addThreat: (t) => setThreats((prev) => [
      {
        sourceType: "News Article",
        riskType: "Brand Abuse",
        threatScore: Math.round(t.confidence ?? 60),
        reach: 0,
        sources: 1,
        evidence: 1,
        velocity: "Normal",
        firstDetected: "Just now",
        latestActivity: "Just now",
        growthPct: 0,
        narrativeClaim: t.title ?? "",
        ...t,
        id: `T-${9827 + prev.length}`,
        detected: "Just now",
        status: "Detected",
      } as Threat,
      ...prev,
    ]),
    updateThreatStatus: (id, status) => setThreats((prev) => prev.map((t) => t.id === id ? { ...t, status } : t)),
    updateCaseStatus: (id, status) => setCases((prev) => prev.map((c) => c.id === id ? { ...c, status } : c)),
    addRemoval: (r) => setRemovals((prev) => [
      { ...r, id: `R-${4411 + prev.length}`, submitted: "Just now", status: "Queued" },
      ...prev,
    ]),
  }), [assets, threats, cases, removals]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData() {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useData must be used inside DataProvider");
  return ctx;
}

export function severityColor(s: Severity) {
  switch (s) {
    case "Critical": return "oklch(0.63 0.24 25)";
    case "High": return "oklch(0.7 0.2 35)";
    case "Medium": return "oklch(0.75 0.16 70)";
    case "Low": return "oklch(0.68 0.16 155)";
  }
}
