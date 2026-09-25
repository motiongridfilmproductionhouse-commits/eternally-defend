import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { useSession } from "@/hooks/use-session";
import { useUserRoles } from "@/hooks/use-user-roles";
import {
  eipDb,
  fetchEipAccess,
  fetchEipJobs,
  fetchEvaluations,
  summarize,
  type EipJob,
} from "@/lib/eip/eip-data";
import { EipStatusBadge, JobResult, Thumb } from "./EipParts";
import { ImmunizeWizard } from "./ImmunizeWizard";

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
  const [tab, setTab] = useState<"overview" | "assets">("overview");

  if (access.loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const header = (
    <div className="max-w-3xl">
      <div className="text-[10px] tracking-[0.25em] font-semibold text-primary uppercase">Eterna EIP</div>
      <h2 className="font-display text-2xl font-bold mt-1">Image Immunization</h2>
      <p className="text-sm text-foreground mt-1">Pre-publication identity protection for authorized images.</p>
      <p className="text-sm text-muted-foreground mt-2">
        Prepare authorized images before publication using Eterna Image Immunization, then validate visual quality,
        transformation robustness and identity-protection performance before the protected asset is released.
      </p>
    </div>
  );

  if (!access.enabled) {
    const request = async () => {
      const { error } = await eipDb
        .from("eip_account_access")
        .upsert({ user_id: session!.user.id, enabled: false, requested_at: new Date().toISOString() });
      if (error) return toast.error(error.message);
      toast.success("Access requested — the Eterna team will be in touch.");
      qc.invalidateQueries({ queryKey: ["eip-access"] });
    };
    return (
      <div className="space-y-6">
        {header}
        <PageCard>
          <div className="flex flex-col items-center text-center py-8 gap-3">
            <Lock className="size-7 text-muted-foreground" />
            <p className="font-medium">Image Immunization is not enabled for this account.</p>
            <Button onClick={request} disabled={access.requested}>
              {access.requested ? "Access requested" : "Request Access"}
            </Button>
          </div>
        </PageCard>
      </div>
    );
  }

  const jobs = data.data?.jobs ?? [];
  const evals = data.data?.evaluations ?? [];
  const s = summarize(jobs, evals);
  const current = openJob ? (jobs.find((j) => j.id === openJob.id) ?? openJob) : null;
  const reeval = async (job: EipJob) => {
    const { error } = await eipDb
      .from("eip_reevaluation_requests")
      .insert({ job_id: job.id, requested_by: session!.user.id });
    if (error) return toast.error(error.message);
    toast.success("Re-evaluation requested. The original result is preserved.");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        {header}
        <div className="flex gap-2 shrink-0">
          <Button onClick={() => setWizard(true)}>Immunize New Image</Button>
          <Button variant="outline" onClick={() => setTab("assets")}>View Protected Assets</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Protected Images" value={s.protected} />
        <StatCard label="Processing" value={s.processing} />
        <StatCard label="Limited" value={s.limited} accent="#D99A1E" />
        <StatCard label="Re-evaluation Needed" value={s.needsReeval} accent="#64748B" />
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["overview", "assets"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground"}`}
          >
            {t === "overview" ? "Overview" : "Protected Assets"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <PageCard title="Recent jobs">
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No images have been submitted for immunization yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.slice(0, 5).map((j) => (
                <li key={j.id} className="flex items-center gap-3 py-3">
                  <Thumb path={j.storage_path} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpenJob(j)}>
                    <div className="text-sm font-medium truncate">{j.image_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {j.current_stage ?? new Date(j.created_at).toLocaleString()}
                    </div>
                  </button>
                  <EipStatusBadge status={j.status} />
                </li>
              ))}
            </ul>
          )}
        </PageCard>
      ) : (
        <AssetsTable jobs={jobs} onOpen={setOpenJob} onReeval={reeval} />
      )}

      <Dialog open={wizard} onOpenChange={setWizard}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Immunize New Image</DialogTitle>
          </DialogHeader>
          <ImmunizeWizard
            onCancel={() => setWizard(false)}
            onCreated={(j) => {
              setWizard(false);
              setOpenJob(j);
            }}
          />
        </DialogContent>
      </Dialog>

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
    <PageCard title={showClient ? "Jobs" : "Protected Assets"}>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No EIP assets yet.</p>
      ) : (
        <div className="overflow-x-auto">
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
                  <td className="py-2 pr-3"><Thumb path={j.storage_path} className="size-10" /></td>
                  <td className="py-2 pr-3 max-w-[180px] truncate">{j.image_name}</td>
                  <td className="py-2 pr-3">{showClient ? `${j.user_id.slice(0, 8)} · ` : ""}{j.authorized_identity ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{j.authorization_ref.slice(0, 8)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{new Date(j.created_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-3">{j.engine_version ?? "—"}</td>
                  <td className="py-2 pr-3"><EipStatusBadge status={j.status} /></td>
                  <td className="py-2 pr-3 font-mono text-xs">{j.certificate_id ?? "—"}</td>
                  <td className="py-2 whitespace-nowrap space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => onOpen(j)}>View</Button>
                    {onReeval && ["PASS", "LIMITED", "FAIL"].includes(j.status) && (
                      <Button size="sm" variant="ghost" onClick={() => onReeval(j)}>Re-evaluate</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageCard>
  );
}
