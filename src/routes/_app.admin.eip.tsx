import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminGuard } from "@/components/AdminGuard";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssetsTable, useEipData } from "@/components/eip/EipWorkspace";
import { JobResult } from "@/components/eip/EipParts";
import { useSession } from "@/hooks/use-session";
import { eipDb, isActive, type EipJob } from "@/lib/eip/eip-data";
import { isRetryableSystemError } from "@/lib/eip/engine-contract";

export const Route = createFileRoute("/_app/admin/eip")({
  head: () => ({ meta: [{ title: "EIP Operations — Eterna Sentinel" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <AdminGuard>
      <EipOps />
    </AdminGuard>
  ),
});

function EipOps() {
  const data = useEipData("all");
  const { session } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState<EipJob | null>(null);
  const access = useQuery({
    queryKey: ["eip-access-all"],
    queryFn: async () => {
      const { data, error } = await eipDb.from("eip_account_access").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { user_id: string; enabled: boolean; requested_at: string | null }[];
    },
  });
  const engine = useQuery({
    queryKey: ["eip-engine-status"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await eipDb.from("eip_engine_status").select("*").eq("id", 1).maybeSingle();
      return data as Record<string, string | boolean | null> | null;
    },
  });
  const logs = useQuery({
    queryKey: ["eip-ops-log"],
    queryFn: async () => {
      const { data } = await eipDb.from("eip_ops_log").select("*").order("created_at", { ascending: false }).limit(20);
      return (data ?? []) as { id: number; job_id: string | null; error_code: string; detail: string | null; created_at: string }[];
    },
  });
  const [newUser, setNewUser] = useState("");
  const jobs = data.data?.jobs ?? [];
  const evals = data.data?.evaluations ?? [];
  const count = (s: string) => jobs.filter((j) => j.status === s).length;
  const staleCutoff = Date.now() - 10 * 60_000;
  const active = jobs.filter((j) => isActive(j.status) && j.status !== "QUEUED");
  const stale = active.filter((j) => !j.heartbeat_at || Date.parse(j.heartbeat_at) < staleCutoff).length;
  const e = engine.data;
  const engineLabel: Record<string, string> = {
    OPERATIONAL: "Operational", UNAVAILABLE: "Unavailable", VERSION_MISMATCH: "Version mismatch",
    CONFIG_INTEGRITY_FAILURE: "Config integrity failure", DISABLED: "Disabled (not configured)", NOT_CONFIGURED: "Not configured",
  };

  const setEnabled = async (user_id: string, enabled: boolean) => {
    const { error } = await eipDb
      .from("eip_account_access")
      .upsert({ user_id, enabled, updated_by: session?.user.id, updated_at: new Date().toISOString() });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["eip-access-all"] });
  };
  const retry = async (j: EipJob) => {
    const { error } = await eipDb.from("eip_jobs").update({ status: "QUEUED" }).eq("id", j.id);
    if (error) return toast.error(error.message);
    toast.success("Job re-queued");
    qc.invalidateQueries({ queryKey: ["eip"] });
  };
  const reeval = async (j: EipJob) => {
    const { error } = await eipDb.from("eip_reevaluation_requests").insert({ job_id: j.id, requested_by: session!.user.id });
    if (error) return toast.error(error.message);
    toast.success("Re-evaluation queued");
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] tracking-[0.25em] font-semibold text-primary uppercase">Admin</div>
        <h2 className="font-display text-2xl font-bold mt-1">EIP Operations</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Results are written only by the EIP engine. Admins can retry system errors and request re-evaluation, but
          cannot change a technical result.
        </p>
      </div>
      <PageCard title="EIP Engine">
        <dl className="grid grid-cols-1 sm:grid-cols-[220px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {([
            ["Status", engineLabel[String(e?.status ?? "NOT_CONFIGURED")] ?? String(e?.status)],
            ["Error", e?.error_code],
            ["Production engine version", e?.engine_version],
            ["Expected engine version", e?.expected_engine_version],
            ["Research base version", e?.research_base_version],
            ["Config SHA-256", e?.config_sha256],
            ["Models loaded", e?.models_loaded == null ? null : e.models_loaded ? "Yes" : "No"],
            ["Last successful health check", e?.last_ok_at && new Date(String(e.last_ok_at)).toLocaleString()],
            ["Worker heartbeat", e?.worker_heartbeat_at && new Date(String(e.worker_heartbeat_at)).toLocaleString()],
          ] as const).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all">{v ? String(v) : "—"}</dd>
            </div>
          ))}
        </dl>
      </PageCard>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Pending" value={count("QUEUED")} />
        <StatCard label="Active" value={active.length} />
        <StatCard label="Stale" value={stale} accent="#D99A1E" />
        <StatCard label="Pass" value={count("PASS")} accent="#16A34A" />
        <StatCard label="Limited" value={count("LIMITED")} accent="#D99A1E" />
        <StatCard label="Fail" value={count("FAIL")} accent="#DC2626" />
        <StatCard label="System errors" value={count("SYSTEM_ERROR")} accent="#64748B" />
        <StatCard label="Evaluations" value={evals.length} accent="#64748B" />
      </div>

      <AssetsTable jobs={jobs} onOpen={setOpen} onReeval={reeval} showClient />

      <PageCard title="Operations log">
        {(logs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No engine or worker errors recorded.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {logs.data!.map((l) => (
              <li key={l.id} className="py-2 flex flex-wrap gap-x-3">
                <span className="font-mono text-xs">{new Date(l.created_at).toLocaleString()}</span>
                <span className="font-semibold">{l.error_code}</span>
                <span className="text-muted-foreground">{l.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </PageCard>

      <PageCard title="Account access">
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
            placeholder="User ID to enable"
            className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <Button disabled={!newUser.trim()} onClick={() => setEnabled(newUser.trim(), true).then(() => setNewUser(""))}>
            Enable EIP
          </Button>
        </div>
        {(access.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No access records or requests yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {access.data!.map((a) => (
              <li key={a.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-mono text-xs truncate">{a.user_id}</div>
                  {a.requested_at && !a.enabled && (
                    <div className="text-xs text-warning">Requested {new Date(a.requested_at).toLocaleString()}</div>
                  )}
                </div>
                <Switch checked={a.enabled} onCheckedChange={(v) => setEnabled(a.user_id, v)} />
              </li>
            ))}
          </ul>
        )}
      </PageCard>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{open?.image_name}</DialogTitle>
          </DialogHeader>
          {open && (
            <>
              <JobResult
                job={open}
                evaluations={evals.filter((e) => e.job_id === open.id)}
                onReevaluate={() => reeval(open)}
                onRetry={isRetryableSystemError(open.error_code) ? () => retry(open).then(() => setOpen(null)) : undefined}
              />
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Manifest</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-3">
                  {JSON.stringify({ ...open, storage_path: undefined, protected_storage_path: undefined }, null, 2)}
                </pre>
              </details>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
