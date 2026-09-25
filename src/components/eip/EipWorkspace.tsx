import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Clock3,
  FileImage,
  Fingerprint,
  Image as ImageIcon,
  Lock,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/hooks/use-session";
import { useUserRoles } from "@/hooks/use-user-roles";
import {
  eipDb,
  fetchEipAccess,
  fetchEipJobs,
  fetchEvaluations,
  summarize,
  isActive,
  type EipJob,
} from "@/lib/eip/eip-data";
import { EipStatusBadge, JobResult, Thumb } from "./EipParts";
import { ImmunizeWizard } from "./ImmunizeWizard";
import { EipProcessingOverlay } from "./EipProcessingOverlay";

export function useEipData(scope: "mine" | "all") {
  const { session, ready } = useSession();
  const uid = session?.user.id;
  return useQuery({
    queryKey: ["eip", scope, uid],
    enabled: ready && !!uid,
    refetchInterval: 10_000,
    queryFn: async () => {
      const jobs = await fetchEipJobs(scope === "mine" ? uid : undefined);
      const evaluations = await fetchEvaluations(jobs.map((j) => j.id));
      return { jobs, evaluations };
    },
  });
}

export function useEipAccess() {
  const { session, ready } = useSession();
  const { isAdmin, roles, ready: rolesReady } = useUserRoles();
  const q = useQuery({
    queryKey: ["eip-access", session?.user.id],
    enabled: ready && !!session,
    queryFn: () => fetchEipAccess(session!.user.id),
  });
  const staff = isAdmin || (roles as string[]).includes("staff");
  return {
    loading: q.isLoading || !rolesReady,
    enabled: staff || !!q.data?.enabled,
    requested: !!q.data?.requested_at,
  };
}

export function EipWorkspace() {
  const access = useEipAccess();
  const { session } = useSession();
  const qc = useQueryClient();
  const data = useEipData("mine");
  const [wizard, setWizard] = useState(false);
  const [openJob, setOpenJob] = useState<EipJob | null>(null);
  const [proc, setProcRaw] = useState<{ job: EipJob; file: File | null } | null>(null);
  const setProc = (p: { job: EipJob; file: File | null } | null) => {
    setProcRaw(p);
    try {
      if (p) sessionStorage.setItem("eip-open-job", p.job.id);
      else sessionStorage.removeItem("eip-open-job");
    } catch {}
  };
  const openAny = (j: EipJob) =>
    isActive(j.status) ? setProc({ job: j, file: null }) : setOpenJob(j);
  const restoreJobs = data.data?.jobs;
  useEffect(() => {
    if (proc || !restoreJobs) return;
    let id: string | null = null;
    try {
      id = sessionStorage.getItem("eip-open-job");
    } catch {}
    const j = id ? restoreJobs.find((x) => x.id === id) : undefined;
    if (j) setProcRaw({ job: j, file: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreJobs]);
  const [tab, setTab] = useState<"overview" | "assets">("overview");

  if (access.loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  if (!access.enabled) {
    const request = async () => {
      const { error } = await eipDb.from("eip_account_access").upsert({
        user_id: session!.user.id,
        enabled: false,
        requested_at: new Date().toISOString(),
      });
      if (error) return toast.error(error.message);
      toast.success("Access requested — the Eterna team will be in touch.");
      qc.invalidateQueries({ queryKey: ["eip-access"] });
    };
    return (
      <div className="eip-dashboard">
        <section className="eip-locked-panel">
          <div className="eip-locked-icon">
            <Lock className="size-7" />
          </div>
          <div>
            <p className="eip-kicker">Eterna EIP</p>
            <h2>Image Immunization</h2>
            <p>Image Immunization is not enabled for this account.</p>
          </div>
          <Button onClick={request} disabled={access.requested}>
            {access.requested ? "Access requested" : "Request Access"}
          </Button>
        </section>
      </div>
    );
  }

  const jobs = data.data?.jobs ?? [];
  const evals = data.data?.evaluations ?? [];
  const s = summarize(jobs, evals);
  const current = openJob ? (jobs.find((j) => j.id === openJob.id) ?? openJob) : null;
  const latest = jobs[0] ?? null;
  const activeJob = jobs.find((j) => isActive(j.status)) ?? null;
  const reeval = async (job: EipJob) => {
    const { error } = await eipDb
      .from("eip_reevaluation_requests")
      .insert({ job_id: job.id, requested_by: session!.user.id });
    if (error) return toast.error(error.message);
    toast.success("Re-evaluation requested. The original result is preserved.");
  };

  const metrics = [
    { label: "Protected Images", value: s.protected, icon: ShieldCheck, tone: "success" },
    { label: "Processing", value: s.processing, icon: Activity, tone: "primary" },
    { label: "Limited", value: s.limited, icon: Shield, tone: "warning" },
    { label: "Re-evaluation Needed", value: s.needsReeval, icon: RefreshCw, tone: "muted" },
  ] as const;

  return (
    <div className="eip-dashboard">
      <section className="eip-hero-grid" aria-labelledby="eip-page-title">
        <div className="eip-identity-hero">
          <div className="eip-dot-field" aria-hidden />
          <EipIdentityVisual protectedCount={s.protected} processingCount={s.processing} />
          <div className="eip-hero-copy">
            <p className="eip-kicker">Eterna EIP</p>
            <h2 id="eip-page-title">Image Immunization</h2>
            <p className="eip-hero-lead">Pre-publication identity protection for authorized images.</p>
            <p className="eip-hero-support">
              Prepare authorized images before publication using Eterna Image Immunization, then
              validate visual quality, transformation robustness and identity-protection performance
              before the protected asset is released.
            </p>
            <div className="eip-hero-actions">
              <Button className="eip-primary-action" onClick={() => setWizard(true)}>
                <Sparkles className="size-4" />
                Immunize New Image
              </Button>
              <Button className="eip-secondary-action" variant="outline" onClick={() => setTab("assets")}>
                <FileImage className="size-4" />
                View Protected Assets
              </Button>
            </div>
          </div>
        </div>

        <aside className="eip-right-stack" aria-label="Image Immunization status">
          <div className="eip-signal-panel">
            <div className="eip-signal-panel__head">
              <div>
                <p className="eip-panel-label">Protection readiness</p>
                <strong>{activeJob ? "Active path" : latest ? "Recent path" : "Ready"}</strong>
              </div>
              <span>{activeJob?.status ?? latest?.status ?? "IDLE"}</span>
            </div>
            <EipSignalGraph active={!!activeJob} />
            <div className="eip-signal-readout">
              <div>
                <span>{s.processing}</span>
                <small>Processing</small>
              </div>
              <div>
                <span>{s.protected}</span>
                <small>Validated</small>
              </div>
            </div>
          </div>

          <div className="eip-path-panel">
            <div className="eip-path-card eip-path-card--active">
              <div>
                <p className="eip-panel-label">Today</p>
                <strong>Active path</strong>
              </div>
              <Fingerprint className="size-5" />
            </div>
            <ol className="eip-path-list">
              {[
                { label: "Authorization", value: "Verified", active: false },
                { label: "Engine queue", value: `${s.processing} active`, active: !!activeJob },
                { label: "Latest stage", value: activeJob?.current_stage ?? "Waiting", active: !!activeJob },
              ].map((item) => (
                <li key={item.label} className={item.active ? "is-active" : ""}>
                  <span />
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.value}</small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </section>

      <section className="eip-metric-grid" aria-label="Image Immunization summary">
        {metrics.map((m) => (
          <EipMetricCard key={m.label} {...m} />
        ))}
      </section>

      <section className="eip-work-grid">
        <div className="eip-work-panel">
          <div className="eip-tabs" role="tablist" aria-label="Image Immunization views">
            {(["overview", "assets"] as const).map((t) => (
              <Button
                key={t}
                type="button"
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={tab === t}
                className={`eip-tab ${tab === t ? "is-active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t === "overview" ? "Overview" : "Protected Assets"}
              </Button>
            ))}
          </div>

          {tab === "overview" ? (
            <RecentJobsPanel jobs={jobs} onOpen={openAny} />
          ) : (
            <AssetsTable jobs={jobs} onOpen={openAny} onReeval={reeval} />
          )}
        </div>
      </section>

      <Dialog open={wizard} onOpenChange={setWizard}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Immunize New Image</DialogTitle>
          </DialogHeader>
          <ImmunizeWizard
            onCancel={() => setWizard(false)}
            onCreated={(j, f) => {
              setWizard(false);
              setProc({ job: j, file: f });
            }}
          />
        </DialogContent>
      </Dialog>

      {proc && (
        <EipProcessingOverlay
          job={jobs.find((j) => j.id === proc.job.id) ?? proc.job}
          file={proc.file}
          onClose={() => setProc(null)}
          onViewResult={() => {
            setOpenJob(proc.job);
            setProc(null);
          }}
        />
      )}

      <Dialog open={!!current} onOpenChange={(o) => !o && setOpenJob(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{current?.image_name}</DialogTitle>
          </DialogHeader>
          {current && (
            <JobResult
              job={current}
              evaluations={evals.filter((e) => e.job_id === current.id)}
              onReevaluate={() => reeval(current)}
              onNew={() => {
                setOpenJob(null);
                setWizard(true);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EipIdentityVisual({
  protectedCount,
  processingCount,
}: {
  protectedCount: number;
  processingCount: number;
}) {
  return (
    <div className="eip-identity-visual" aria-hidden="true">
      <div className="eip-head-silhouette">
        <span className="eip-mesh-ring eip-mesh-ring--outer" />
        <span className="eip-mesh-ring eip-mesh-ring--inner" />
        <span className="eip-mesh-profile" />
        <span className="eip-mesh-grid" />
        <span className="eip-scan-orbit eip-scan-orbit--one" />
        <span className="eip-scan-orbit eip-scan-orbit--two" />
        <span className="eip-scan-line" />
      </div>
      <div className="eip-floating-note eip-floating-note--left">
        <span>{protectedCount}</span>
        <small>Protected</small>
      </div>
      <div className="eip-floating-note eip-floating-note--right">
        <span>{processingCount}</span>
        <small>Processing</small>
      </div>
      <div className="eip-mini-control">
        <div>
          <strong>Set protection path</strong>
          <span>Visual quality</span>
        </div>
        <div className="eip-mini-bars">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function EipSignalGraph({ active }: { active: boolean }) {
  return (
    <div className="eip-signal-graph" aria-hidden="true">
      <svg viewBox="0 0 420 250" role="presentation">
        <path className="eip-graph-grid" d="M45 45H380M45 105H380M45 165H380M45 225H380M95 25V225M170 25V225M245 25V225M320 25V225" />
        <path className="eip-graph-fill" d="M45 212 C150 198 250 208 320 82 C348 34 367 26 380 24 L380 225 L45 225 Z" />
        <path className="eip-graph-line eip-graph-line--soft" d="M45 205 C145 192 244 198 316 96 C344 54 360 43 379 37" />
        <path className="eip-graph-line" d="M45 214 C143 202 248 209 324 78 C350 35 365 28 380 25" />
        <circle cx="170" cy="105" r="4" />
        <circle cx="320" cy="82" r="4" />
        <circle className={active ? "is-live" : ""} cx="380" cy="25" r="5" />
      </svg>
      <span className="eip-graph-chip eip-graph-chip--one">Visual quality</span>
      <span className="eip-graph-chip eip-graph-chip--two">Identity guard</span>
    </div>
  );
}

function EipMetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: "success" | "primary" | "warning" | "muted";
}) {
  return (
    <article className={`eip-metric-card is-${tone}`}>
      <div className="eip-metric-card__label">{label}</div>
      <div className="eip-metric-card__body">
        <strong>{value}</strong>
        <span>
          <Icon className="size-5" />
        </span>
      </div>
    </article>
  );
}

function RecentJobsPanel({ jobs, onOpen }: { jobs: EipJob[]; onOpen: (j: EipJob) => void }) {
  return (
    <div className="eip-jobs-panel">
      <div className="eip-panel-heading">
        <div>
          <p className="eip-panel-label">Recent jobs</p>
          <h3>Processing history</h3>
        </div>
        <Clock3 className="size-5" />
      </div>
      {jobs.length === 0 ? (
        <div className="eip-empty-state">
          <ImageIcon className="size-7" />
          <p>No images have been submitted for immunization yet.</p>
        </div>
      ) : (
        <ul className="eip-job-list">
          {jobs.slice(0, 5).map((j) => (
            <li key={j.id}>
              <Button variant="ghost" className="eip-job-row" onClick={() => onOpen(j)}>
                <Thumb path={j.storage_path} className="eip-job-thumb" />
                <span className="eip-job-meta">
                  <strong>{j.image_name}</strong>
                  <small>{j.current_stage ?? new Date(j.created_at).toLocaleString()}</small>
                </span>
                <EipStatusBadge status={j.status} />
                <ArrowRight className="eip-job-arrow size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AssetsTable({
  jobs,
  onOpen,
  onReeval,
  showClient,
}: {
  jobs: EipJob[];
  onOpen: (j: EipJob) => void;
  onReeval?: (j: EipJob) => void;
  showClient?: boolean;
}) {
  return (
    <div className="eip-assets-panel">
      <div className="eip-panel-heading">
        <div>
          <p className="eip-panel-label">{showClient ? "Jobs" : "Protected assets"}</p>
          <h3>{showClient ? "All EIP jobs" : "Asset ledger"}</h3>
        </div>
      </div>
      {jobs.length === 0 ? (
        <div className="eip-empty-state">
          <FileImage className="size-7" />
          <p>No EIP assets yet.</p>
        </div>
      ) : (
        <div className="eip-table-wrap">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-2 pr-3"></th>
                <th className="py-2 pr-3">Image</th>
                <th className="py-2 pr-3">{showClient ? "Client / identity" : "Identity"}</th>
                <th className="py-2 pr-3">Authorization</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">EIP version</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Certificate</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="py-2 pr-3">
                    <Thumb path={j.storage_path} className="size-10" />
                  </td>
                  <td className="py-2 pr-3 max-w-[180px] truncate">{j.image_name}</td>
                  <td className="py-2 pr-3">
                    {showClient ? `${j.user_id.slice(0, 8)} · ` : ""}
                    {j.authorized_identity ?? "—"}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{j.authorization_ref.slice(0, 8)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {new Date(j.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-3">{j.engine_version ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <EipStatusBadge status={j.status} />
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{j.certificate_id ?? "—"}</td>
                  <td className="py-2 whitespace-nowrap space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => onOpen(j)}>
                      View
                    </Button>
                    {onReeval && ["PASS", "LIMITED", "FAIL"].includes(j.status) && (
                      <Button size="sm" variant="ghost" onClick={() => onReeval(j)}>
                        Re-evaluate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
