import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import {
  Send, FileText, Scale, ShieldAlert, Loader2, Download, X, Youtube, Instagram,
  Facebook, Music2, MessageCircle, Globe, Newspaper, ExternalLink, CheckCircle2, Clock,
} from "lucide-react";
import { useAuthorization } from "@/hooks/use-authorization";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateEnforcementPackages, signPackageUrl } from "@/lib/enforcement-packages.functions";
import { AutomationDrawer } from "@/components/enforcement/AutomationDrawer";
import { Bot } from "lucide-react";

export const Route = createFileRoute("/_app/enforcement")({
  head: () => ({ meta: [{ title: "Enforcement Center — Eterna AI" }] }),
  component: EnforcementPage,
});

type Method = "DMCA" | "Platform Report" | "Legal Notice";
type Platform = "YouTube" | "Instagram" | "Facebook" | "TikTok" | "X" | "Reddit" | "News" | "Blog" | "Other";

interface HitRow {
  id: string;
  title: string | null;
  permalink: string | null;
  canonical_url: string | null;
  source: string;
  source_type: string | null;
  risk_type: string | null;
  severity: string | null;
  threat_score: number | null;
  reach: number | null;
  source_metadata: Record<string, unknown> | null;
}

interface EnforcementRow {
  id: string;
  scan_hit_id: string | null;
  platform: string | null;
  method: string;
  status: string;
  submission_status: string;
  target_url: string | null;
  submitted_at: string | null;
  responded_at: string | null;
  created_at: string;
  evidence_pdf_path: string | null;
  authorization_pdf_path: string | null;
  platform_complaint_pdf_path: string | null;
  package_generated_at: string | null;
  automation_job_id: string | null;
  automation_status: string | null;
}

function detectPlatform(hit: HitRow): Platform {
  const src = `${hit.source ?? ""} ${hit.source_type ?? ""} ${hit.permalink ?? ""} ${hit.canonical_url ?? ""}`.toLowerCase();
  if (src.includes("youtube") || src.includes("youtu.be")) return "YouTube";
  if (src.includes("instagram")) return "Instagram";
  if (src.includes("facebook")) return "Facebook";
  if (src.includes("tiktok")) return "TikTok";
  if (src.includes("twitter") || src.includes("x.com")) return "X";
  if (src.includes("reddit")) return "Reddit";
  if (src.includes("news") || src.includes("portal") || src.includes("publisher")) return "News";
  if (src.includes("blog") || src.includes("medium")) return "Blog";
  return "Other";
}

function platformIcon(p: Platform) {
  switch (p) {
    case "YouTube": return Youtube;
    case "Instagram": return Instagram;
    case "Facebook": return Facebook;
    case "TikTok": return Music2;
    case "Reddit": return MessageCircle;
    case "News": return Newspaper;
    default: return Globe;
  }
}

const DMCA_BASES = ["Original video", "Original photo", "Original audio", "Trademark", "Other"] as const;
type DmcaBasis = (typeof DMCA_BASES)[number];

const REPORT_TYPES: Record<Platform, string[]> = {
  YouTube: ["Copyright", "Impersonation", "Privacy", "Harassment", "Deepfake", "Trademark"],
  Instagram: ["Copyright", "Fake Account", "Impersonation", "Harassment", "Trademark"],
  Facebook: ["Copyright", "Fake Profile", "Impersonation", "Trademark"],
  TikTok: ["Copyright", "Impersonation", "Trademark"],
  X: ["Impersonation", "Trademark", "Harassment"],
  Reddit: ["Copyright", "Impersonation", "Harassment"],
  News: ["Defamation", "Right of Reply", "Correction Request"],
  Blog: ["Copyright", "Defamation", "Correction Request"],
  Other: ["Copyright", "Impersonation", "Trademark", "Harassment"],
};

function EnforcementPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const authz = useAuthorization();
  const generateFn = useServerFn(generateEnforcementPackages);
  const signFn = useServerFn(signPackageUrl);

  const [selected, setSelected] = useState<string[]>([]);
  const [openModal, setOpenModal] = useState<Method | null>(null);
  const [automationTarget, setAutomationTarget] = useState<EnforcementRow | null>(null);

  const hitsQuery = useQuery({
    queryKey: ["enforcement_eligible_hits", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<HitRow[]> => {
      const { data, error } = await supabase
        .from("scan_hits")
        .select("id,title,permalink,canonical_url,source,source_type,risk_type,severity,threat_score,reach,source_metadata")
        .order("threat_score", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as HitRow[];
    },
  });

  const requestsQuery = useQuery({
    queryKey: ["enforcement_requests", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<EnforcementRow[]> => {
      const { data, error } = await supabase
        .from("enforcement_requests")
        .select("id,scan_hit_id,platform,method,status,submission_status,target_url,submitted_at,responded_at,created_at,evidence_pdf_path,authorization_pdf_path,platform_complaint_pdf_path,package_generated_at,automation_job_id,automation_status")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as EnforcementRow[];
    },
  });

  const actionsQuery = useQuery({
    queryKey: ["enforcement_actions_recent", userId],
    enabled: ready && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enforcement_actions")
        .select("id,action_type,target_url,platform,submission_status,created_at,generated_files")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const legalQuery = useQuery({
    queryKey: ["legal_cases_count", userId],
    enabled: ready && !!userId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("legal_cases")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const requests = requestsQuery.data ?? [];
  const hits = hitsQuery.data ?? [];
  const auditLog = actionsQuery.data ?? [];

  const selectedHits = useMemo(() => hits.filter((h) => selected.includes(h.id)), [hits, selected]);
  const selectedPlatforms = useMemo(() => Array.from(new Set(selectedHits.map(detectPlatform))), [selectedHits]);

  const metrics = useMemo(() => {
    const submitted = requests.filter((r) => r.submission_status && !["draft", "queued"].includes(r.submission_status.toLowerCase())).length;
    const removed = requests.filter((r) => ["removed", "accepted"].includes((r.submission_status ?? "").toLowerCase())).length;
    const responseTimes = requests
      .filter((r) => r.submitted_at && r.responded_at)
      .map((r) => new Date(r.responded_at!).getTime() - new Date(r.submitted_at!).getTime());
    const avgResponseHrs = responseTimes.length
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length / 3_600_000)
      : null;
    return {
      total: requests.length,
      submitted,
      removed,
      successRate: submitted ? Math.round((removed / submitted) * 100) : null,
      avgResponseHrs,
      legal: legalQuery.data ?? 0,
    };
  }, [requests, legalQuery.data]);

  const openPackage = async (path: string | null) => {
    if (!path) return;
    try {
      const { url } = await signFn({ data: { path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open package");
    }
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const clearSelection = () => setSelected([]);
  const canAct = authz.canRequestEnforcement && selected.length > 0;
  const loading = !ready || hitsQuery.isLoading || requestsQuery.isLoading;

  const handleSubmit = async (opts: {
    method: Method;
    basis?: DmcaBasis;
    reportType?: string;
    stage?: string;
    notes?: string;
    evidenceFlags: { screenshots: boolean; urls: boolean; timestamps: boolean; authorization: boolean };
    dryRun: boolean;
    submissionStatus: "draft" | "ready" | "submitted";
  }) => {
    if (!userId || selectedHits.length === 0) return;
    const toastId = toast.loading(`Recording ${selectedHits.length} ${opts.method.toLowerCase()} request(s)…`);
    try {
      for (const hit of selectedHits) {
        const platform = detectPlatform(hit);
        const targetUrl = hit.canonical_url ?? hit.permalink ?? "";

        const { data: req, error: reqErr } = await supabase
          .from("enforcement_requests")
          .insert({
            user_id: userId,
            scan_hit_id: hit.id,
            platform,
            method: opts.method,
            target_url: targetUrl,
            status: opts.submissionStatus === "submitted" ? "Sent" : "Queued",
            submission_status: opts.submissionStatus,
            submitted_at: opts.submissionStatus === "submitted" ? new Date().toISOString() : null,
          } as never)
          .select("id")
          .single();
        if (reqErr || !req) throw reqErr ?? new Error("Failed to create request");
        const reqId = (req as { id: string }).id;

        await supabase.from("enforcement_targets").insert({
          user_id: userId,
          enforcement_request_id: reqId,
          scan_hit_id: hit.id,
          platform,
          target_url: targetUrl,
          metadata: (hit.source_metadata ?? {}) as never,
        } as never);

        const evidenceRows = Object.entries(opts.evidenceFlags)
          .filter(([, v]) => v)
          .map(([k]) => ({
            user_id: userId,
            enforcement_request_id: reqId,
            evidence_type: k,
            reference: targetUrl,
            payload: {} as never,
          }));
        if (evidenceRows.length) await supabase.from("enforcement_evidence").insert(evidenceRows as never);

        await supabase.from("enforcement_status_history").insert({
          user_id: userId,
          enforcement_request_id: reqId,
          from_status: null,
          to_status: opts.submissionStatus,
          note: `Created via ${opts.method}`,
        } as never);

        if (opts.method === "DMCA") {
          await supabase.from("dmca_submissions").insert({
            user_id: userId,
            enforcement_request_id: reqId,
            platform,
            copyright_basis: opts.basis ?? "Other",
            submission_status: opts.submissionStatus,
            submitted_at: opts.submissionStatus === "submitted" ? new Date().toISOString() : null,
          } as never);
        } else if (opts.method === "Platform Report") {
          await supabase.from("platform_reports").insert({
            user_id: userId,
            enforcement_request_id: reqId,
            platform,
            report_type: opts.reportType ?? "Other",
            submission_status: opts.submissionStatus,
            submitted_at: opts.submissionStatus === "submitted" ? new Date().toISOString() : null,
            form_payload: { evidence: opts.evidenceFlags } as never,
          } as never);
        } else if (opts.method === "Legal Notice") {
          await supabase.from("legal_cases").insert({
            user_id: userId,
            enforcement_request_id: reqId,
            stage: opts.stage ?? "Legal Review",
            notes: opts.notes ?? null,
          } as never);
        }

        await supabase.from("enforcement_actions").insert({
          user_id: userId,
          enforcement_request_id: reqId,
          action_type: opts.method,
          target_url: targetUrl,
          platform,
          actor_id: userId,
          submission_status: opts.submissionStatus,
          payload: {
            basis: opts.basis,
            reportType: opts.reportType,
            stage: opts.stage,
            evidence: opts.evidenceFlags,
          } as never,
        } as never);
      }

      if (!opts.dryRun) {
        toast.loading(`Generating ${selectedHits.length * 3} PDF package(s)…`, { id: toastId });
        await generateFn({ data: { scanHitIds: selected, method: opts.method, dryRun: false } });
      }

      toast.success(`${selectedHits.length} ${opts.method} request(s) recorded`, { id: toastId });
      setSelected([]);
      setOpenModal(null);
      qc.invalidateQueries({ queryKey: ["enforcement_requests", userId] });
      qc.invalidateQueries({ queryKey: ["enforcement_actions_recent", userId] });
      qc.invalidateQueries({ queryKey: ["legal_cases_count", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit", { id: toastId });
    }
  };

  return (
    <div className="space-y-5">
      {!authz.canRequestEnforcement && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3">
          <ShieldAlert className="size-5 text-amber-700" />
          <div className="flex-1 text-sm text-amber-900">
            Enforcement actions are disabled. Your current authorization level does not include enforcement requests.
          </div>
          <Button asChild size="sm" variant="outline"><Link to="/onboarding">Update authorization</Link></Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="TAKEDOWNS SENT" value={metrics.submitted} sub={metrics.total ? `${metrics.total} tracked` : "None yet"} accent="oklch(0.65 0.18 240)" />
        <StatCard label="SUCCESS RATE" value={metrics.successRate === null ? "—" : `${metrics.successRate}%`} sub={metrics.submitted ? `${metrics.removed} removed` : "No submissions"} accent="oklch(0.68 0.16 155)" />
        <StatCard label="AVG RESPONSE" value={metrics.avgResponseHrs === null ? "—" : `${metrics.avgResponseHrs}h`} sub="Submitted → responded" accent="oklch(0.55 0.22 295)" />
        <StatCard label="LEGAL ESCALATIONS" value={metrics.legal} sub="Active cases" accent="oklch(0.63 0.24 25)" />
      </div>

      {/* Selection banner */}
      <div className={`rounded-2xl border p-4 flex items-center gap-3 ${selected.length ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30"}`}>
        <div className="flex-1">
          <div className="text-sm font-semibold">{selected.length} selected</div>
          <div className="text-xs text-muted-foreground">
            {selected.length === 0
              ? "Select one or more eligible findings below to enable enforcement actions."
              : `Platforms detected: ${selectedPlatforms.join(", ") || "Other"}`}
          </div>
        </div>
        {selected.length > 0 && (
          <button onClick={clearSelection} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <X className="size-3" /> Clear
          </button>
        )}
      </div>

      <PageCard title="QUICK ACTIONS" sub="Real workflow — creates database records, audit trail and PDF packages">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QuickAction
            icon={Send}
            title="Send DMCA takedown"
            sub={canAct ? `${selectedHits.length} finding(s) · ${selectedPlatforms.join(" · ")}` : "Select findings to enable"}
            tone="oklch(0.55 0.22 295)"
            disabled={!canAct}
            onClick={() => setOpenModal("DMCA")}
          />
          <QuickAction
            icon={FileText}
            title="File platform report"
            sub={canAct ? `Auto-detected: ${selectedPlatforms[0] ?? "Platform"}` : "Select findings to enable"}
            tone="oklch(0.65 0.18 240)"
            disabled={!canAct}
            onClick={() => setOpenModal("Platform Report")}
          />
          <QuickAction
            icon={Scale}
            title="Escalate to legal"
            sub={canAct ? `Builds legal case + evidence bundle` : "Select findings to enable"}
            tone="oklch(0.63 0.24 25)"
            disabled={!canAct}
            onClick={() => setOpenModal("Legal Notice")}
          />
        </div>
      </PageCard>

      <PageCard title="ELIGIBLE THREATS" sub="Select findings to enforce against">
        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading findings…
          </div>
        ) : hits.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No findings available. <Link to="/scan" className="text-primary font-semibold">Run a scan</Link> to detect threats you can enforce against.
          </div>
        ) : (
          <div className="space-y-2">
            {hits.map((h) => {
              const platform = detectPlatform(h);
              const Icon = platformIcon(platform);
              const meta = (h.source_metadata ?? {}) as Record<string, unknown>;
              const isYouTube = platform === "YouTube";
              return (
                <label key={h.id} className="flex items-start gap-3 p-3 border border-border rounded-xl cursor-pointer hover:bg-accent/30">
                  <input type="checkbox" checked={selected.includes(h.id)} onChange={() => toggle(h.id)} className="size-4 accent-primary mt-1" />
                  <div className="size-8 rounded-lg grid place-items-center bg-muted shrink-0 mt-0.5">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{h.title || h.permalink || "Untitled finding"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                      <span>{platform}</span>
                      <span>{h.risk_type ?? "Uncategorised"}</span>
                      <span>Score {h.threat_score ?? "—"}</span>
                      {h.reach ? <span>Reach {h.reach.toLocaleString()}</span> : null}
                    </div>
                    {isYouTube && (
                      <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                        {typeof meta.channel_name === "string" && <span>Channel: {meta.channel_name}</span>}
                        {typeof meta.subscribers === "number" && <span>Subs: {(meta.subscribers as number).toLocaleString()}</span>}
                        {typeof meta.views === "number" && <span>Views: {(meta.views as number).toLocaleString()}</span>}
                      </div>
                    )}
                  </div>
                  {(h.canonical_url || h.permalink) && (
                    <a
                      href={(h.canonical_url ?? h.permalink)!}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                    >
                      <ExternalLink className="size-3" /> Open
                    </a>
                  )}
                  <span className="text-xs text-muted-foreground">{h.severity ?? "—"}</span>
                </label>
              );
            })}
          </div>
        )}
      </PageCard>

      <PageCard title="ENFORCEMENT HISTORY" sub={`${requests.length} request(s) tracked`}>
        {requestsQuery.isLoading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : requests.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No enforcement actions available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2.5 pr-4 font-medium">Platform</th>
                  <th className="py-2.5 pr-4 font-medium">Method</th>
                  <th className="py-2.5 pr-4 font-medium">Target</th>
                  <th className="py-2.5 pr-4 font-medium">Status</th>
                  <th className="py-2.5 pr-4 font-medium">Packages</th>
                  <th className="py-2.5 pr-4 font-medium">Automation</th>
                  <th className="py-2.5 pr-4 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const isYT = (r.platform ?? "").toLowerCase().includes("youtube");
                  const packagesReady = !!r.evidence_pdf_path && !!r.authorization_pdf_path;
                  return (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-accent/30">
                    <td className="py-3 pr-4">{r.platform ?? "—"}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{r.method}</td>
                    <td className="py-3 pr-4 truncate max-w-[240px]">
                      {r.target_url ? <a href={r.target_url} target="_blank" rel="noreferrer" className="text-primary underline text-xs">{r.target_url}</a> : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="py-3 pr-4"><Pill color={statusColor(r.submission_status || r.status)}>{r.submission_status || r.status}</Pill></td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <PackageBtn label="Evidence" path={r.evidence_pdf_path} onOpen={openPackage} />
                        <PackageBtn label="Authorization" path={r.authorization_pdf_path} onOpen={openPackage} />
                        <PackageBtn label="Complaint" path={r.platform_complaint_pdf_path} onOpen={openPackage} />
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      {isYT && packagesReady ? (
                        <button
                          onClick={() => setAutomationTarget(r)}
                          className="inline-flex items-center gap-1.5 text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-accent"
                          title="Run browser automation"
                        >
                          <Bot className="size-3.5" />
                          {r.automation_status ?? (r.automation_job_id ? "View" : "Automate")}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {!isYT ? "Manual only" : "Generate package first"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageCard>

      {automationTarget && (
        <AutomationDrawer
          enforcementRequestId={automationTarget.id}
          platform={automationTarget.platform}
          method={automationTarget.method}
          existingJobId={automationTarget.automation_job_id}
          onClose={() => setAutomationTarget(null)}
        />
      )}

      <PageCard title="AUDIT LOG" sub="Every enforcement action is logged with actor, target, platform and files">
        {actionsQuery.isLoading ? (
          <div className="py-8 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : auditLog.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No actions recorded yet.</div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {auditLog.map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-xs border-b border-border/50 py-2">
                <Clock className="size-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0 w-32">{new Date(a.created_at).toLocaleString()}</span>
                <span className="font-medium shrink-0 w-24">{a.action_type}</span>
                <span className="text-muted-foreground shrink-0 w-20">{a.platform ?? "—"}</span>
                <span className="truncate flex-1 text-muted-foreground">{a.target_url ?? "—"}</span>
                <Pill color={statusColor(a.submission_status ?? "")}>{a.submission_status ?? "—"}</Pill>
              </div>
            ))}
          </div>
        )}
      </PageCard>

      {openModal === "DMCA" && (
        <DmcaModal
          selectedHits={selectedHits}
          onClose={() => setOpenModal(null)}
          onSubmit={(basis, evidenceFlags, submissionStatus) =>
            handleSubmit({ method: "DMCA", basis, evidenceFlags, submissionStatus, dryRun: submissionStatus === "draft" })
          }
        />
      )}
      {openModal === "Platform Report" && (
        <ReportModal
          selectedHits={selectedHits}
          onClose={() => setOpenModal(null)}
          onSubmit={(reportType, evidenceFlags, submissionStatus) =>
            handleSubmit({ method: "Platform Report", reportType, evidenceFlags, submissionStatus, dryRun: submissionStatus === "draft" })
          }
        />
      )}
      {openModal === "Legal Notice" && (
        <LegalModal
          selectedHits={selectedHits}
          onClose={() => setOpenModal(null)}
          onSubmit={(stage, notes, evidenceFlags) =>
            handleSubmit({ method: "Legal Notice", stage, notes, evidenceFlags, submissionStatus: "submitted", dryRun: false })
          }
        />
      )}
    </div>
  );
}

function QuickAction({
  icon: Icon, title, sub, tone, disabled, onClick,
}: { icon: typeof Send; title: string; sub: string; tone: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="border border-border rounded-xl p-4 text-left hover:bg-accent/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <div className="size-10 rounded-xl grid place-items-center mb-3" style={{ background: `color-mix(in oklab, ${tone} 14%, white)`, color: tone }}>
        <Icon className="size-5" />
      </div>
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </button>
  );
}

function PackageBtn({ label, path, onOpen }: { label: string; path: string | null; onOpen: (p: string | null) => void }) {
  if (!path) return <span className="text-[10px] text-muted-foreground/60">{label}: —</span>;
  return (
    <button
      onClick={() => onOpen(path)}
      className="text-[10px] px-2 py-1 rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
    >
      <Download className="size-3" /> {label}
    </button>
  );
}

function statusColor(s: string): string {
  const k = s.toLowerCase();
  if (k === "approved" || k === "removed" || k === "accepted") return "oklch(0.68 0.16 155)";
  if (k === "sent" || k === "submitted") return "oklch(0.65 0.18 240)";
  if (k === "queued" || k === "draft" || k === "ready") return "oklch(0.75 0.16 70)";
  if (k === "rejected") return "oklch(0.63 0.24 25)";
  return "oklch(0.55 0.03 275)";
}

/* ---------------- Modals ---------------- */

function ModalShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-background rounded-2xl border border-border w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="font-semibold">{title}</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-5" /></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        <div className="p-4 border-t border-border flex items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function TargetList({ hits }: { hits: HitRow[] }) {
  return (
    <div className="space-y-1.5 max-h-48 overflow-y-auto border border-border rounded-lg p-2 bg-muted/30">
      {hits.map((h) => (
        <div key={h.id} className="text-xs flex items-center gap-2">
          <CheckCircle2 className="size-3 text-primary shrink-0" />
          <span className="truncate flex-1">{h.title || h.permalink || h.canonical_url || "Untitled"}</span>
          <span className="text-muted-foreground shrink-0">{detectPlatform(h)}</span>
        </div>
      ))}
    </div>
  );
}

function EvidenceCheckboxes({ value, onChange }: { value: { screenshots: boolean; urls: boolean; timestamps: boolean; authorization: boolean }; onChange: (v: typeof value) => void }) {
  const opts = [
    { k: "screenshots", label: "Screenshots" },
    { k: "urls", label: "URLs" },
    { k: "timestamps", label: "Timestamps" },
    { k: "authorization", label: "Authorization PDF" },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2">
      {opts.map((o) => (
        <label key={o.k} className="flex items-center gap-2 text-sm border border-border rounded-lg px-3 py-2 cursor-pointer hover:bg-accent/30">
          <input
            type="checkbox"
            checked={value[o.k]}
            onChange={(e) => onChange({ ...value, [o.k]: e.target.checked })}
            className="accent-primary"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function DmcaModal({
  selectedHits, onClose, onSubmit,
}: {
  selectedHits: HitRow[];
  onClose: () => void;
  onSubmit: (basis: DmcaBasis, evidenceFlags: { screenshots: boolean; urls: boolean; timestamps: boolean; authorization: boolean }, submissionStatus: "draft" | "ready" | "submitted") => Promise<void>;
}) {
  const [basis, setBasis] = useState<DmcaBasis>("Original video");
  const [evidence, setEvidence] = useState({ screenshots: true, urls: true, timestamps: true, authorization: true });
  const [busy, setBusy] = useState(false);

  const run = async (status: "draft" | "ready" | "submitted") => {
    setBusy(true);
    try { await onSubmit(basis, evidence, status); } finally { setBusy(false); }
  };

  const platform = selectedHits[0] ? detectPlatform(selectedHits[0]) : "Other";
  const title = platform === "YouTube" ? "YouTube Copyright Takedown" : `${platform} DMCA Takedown`;

  return (
    <ModalShell
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => run("draft")} disabled={busy}>Save draft</Button>
          <Button variant="outline" size="sm" onClick={() => run("ready")} disabled={busy}>Generate DMCA package</Button>
          <Button size="sm" onClick={() => run("submitted")} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Submit"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">SELECTED VIDEOS / TARGETS</div>
          <TargetList hits={selectedHits} />
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">COPYRIGHT BASIS</div>
          <div className="space-y-1.5">
            {DMCA_BASES.map((b) => (
              <label key={b} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="basis" value={b} checked={basis === b} onChange={() => setBasis(b)} className="accent-primary" />
                {b}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">EVIDENCE TO ATTACH</div>
          <EvidenceCheckboxes value={evidence} onChange={setEvidence} />
        </div>
      </div>
    </ModalShell>
  );
}

function ReportModal({
  selectedHits, onClose, onSubmit,
}: {
  selectedHits: HitRow[];
  onClose: () => void;
  onSubmit: (reportType: string, evidenceFlags: { screenshots: boolean; urls: boolean; timestamps: boolean; authorization: boolean }, submissionStatus: "draft" | "ready" | "submitted") => Promise<void>;
}) {
  const platform: Platform = selectedHits[0] ? detectPlatform(selectedHits[0]) : "Other";
  const options = REPORT_TYPES[platform];
  const [reportType, setReportType] = useState(options[0]);
  const [evidence, setEvidence] = useState({ screenshots: true, urls: true, timestamps: false, authorization: true });
  const [busy, setBusy] = useState(false);

  const run = async (status: "draft" | "ready" | "submitted") => {
    setBusy(true);
    try { await onSubmit(reportType, evidence, status); } finally { setBusy(false); }
  };

  return (
    <ModalShell
      title={`${platform} Platform Report`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => run("draft")} disabled={busy}>Save draft</Button>
          <Button size="sm" onClick={() => run("submitted")} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "File report"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">TARGETS ({selectedHits.length})</div>
          <TargetList hits={selectedHits} />
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">REPORT CATEGORY</div>
          <div className="grid grid-cols-2 gap-1.5">
            {options.map((o) => (
              <label key={o} className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-2 cursor-pointer ${reportType === o ? "border-primary bg-primary/5" : "border-border hover:bg-accent/30"}`}>
                <input type="radio" name="rt" value={o} checked={reportType === o} onChange={() => setReportType(o)} className="accent-primary" />
                {o}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">EVIDENCE TO ATTACH</div>
          <EvidenceCheckboxes value={evidence} onChange={setEvidence} />
        </div>
      </div>
    </ModalShell>
  );
}

const LEGAL_STAGES = ["Legal Review", "Attorney Review", "Court Preparation", "Filed"] as const;

function LegalModal({
  selectedHits, onClose, onSubmit,
}: {
  selectedHits: HitRow[];
  onClose: () => void;
  onSubmit: (stage: string, notes: string, evidenceFlags: { screenshots: boolean; urls: boolean; timestamps: boolean; authorization: boolean }) => Promise<void>;
}) {
  const [stage, setStage] = useState<string>(LEGAL_STAGES[0]);
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState({ screenshots: true, urls: true, timestamps: true, authorization: true });
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try { await onSubmit(stage, notes, evidence); } finally { setBusy(false); }
  };

  return (
    <ModalShell
      title="Escalate to Legal"
      onClose={onClose}
      footer={
        <Button size="sm" onClick={run} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Create legal case"}
        </Button>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">EVIDENCE BUNDLE ({selectedHits.length} finding(s))</div>
          <TargetList hits={selectedHits} />
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">CASE STAGE</div>
          <div className="grid grid-cols-2 gap-1.5">
            {LEGAL_STAGES.map((s) => (
              <label key={s} className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-2 cursor-pointer ${stage === s ? "border-primary bg-primary/5" : "border-border hover:bg-accent/30"}`}>
                <input type="radio" name="st" value={s} checked={stage === s} onChange={() => setStage(s)} className="accent-primary" />
                {s}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">EVIDENCE TO INCLUDE</div>
          <EvidenceCheckboxes value={evidence} onChange={setEvidence} />
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">CASE NOTES</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Timeline, threat analysis, requested remedy…"
            className="w-full text-sm border border-border rounded-lg p-2.5 bg-background"
          />
        </div>
      </div>
    </ModalShell>
  );
}
