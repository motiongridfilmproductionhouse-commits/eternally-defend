/**
 * Enforcement Automation drawer: enqueue a browser-automation job for a
 * given enforcement request, then poll its status + audit events until the
 * worker reports `review_ready`, and let the operator confirm the final
 * platform submission.
 *
 * Automatic submission never happens from the browser here — the human
 * operator clicks Submit inside the live worker session, then confirms in
 * this drawer, which marks the enforcement request `Sent` on the server.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, X, PlayCircle, ExternalLink, ShieldCheck, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import {
  enqueueAutomationJob,
  getAutomationJob,
  cancelAutomationJob,
  markHumanSubmitted,
} from "@/lib/automation/jobs.functions";

type Adapter = "youtube_copyright" | "youtube_community";

interface Props {
  enforcementRequestId: string;
  platform: string | null;
  method: string;
  existingJobId: string | null;
  onClose: () => void;
}

const statusTone: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700 border-slate-200",
  running: "bg-blue-50 text-blue-700 border-blue-200",
  review_ready: "bg-amber-50 text-amber-800 border-amber-200",
  submitted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

export function AutomationDrawer({ enforcementRequestId, platform, method, existingJobId, onClose }: Props) {
  const qc = useQueryClient();
  const enqueue = useServerFn(enqueueAutomationJob);
  const getJob = useServerFn(getAutomationJob);
  const cancel = useServerFn(cancelAutomationJob);
  const mark = useServerFn(markHumanSubmitted);

  const [jobId, setJobId] = useState<string | null>(existingJobId);
  const [adapter, setAdapter] = useState<Adapter>(
    method.toLowerCase().includes("dmca") || method.toLowerCase().includes("copyright")
      ? "youtube_copyright"
      : "youtube_community",
  );

  const isYouTube = (platform ?? "").toLowerCase().includes("youtube");

  const jobQuery = useQuery({
    queryKey: ["automation_job", jobId],
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = (q.state.data as { job?: { status?: string } } | undefined)?.job?.status;
      return s && (s === "submitted" || s === "failed" || s === "cancelled") ? false : 3000;
    },
    queryFn: () => (jobId ? getJob({ data: { jobId } }) : Promise.resolve(null)),
  });

  const startMut = useMutation({
    mutationFn: () => enqueue({ data: { enforcementRequestId, adapter } }),
    onSuccess: (res) => {
      setJobId(res.jobId);
      toast.success(res.alreadyRunning ? "Attached to running automation job" : "Automation job queued");
      qc.invalidateQueries({ queryKey: ["enforcement_requests"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start automation"),
  });

  const cancelMut = useMutation({
    mutationFn: () => (jobId ? cancel({ data: { jobId } }) : Promise.resolve(null)),
    onSuccess: () => {
      toast.info("Automation cancelled");
      qc.invalidateQueries({ queryKey: ["automation_job", jobId] });
      qc.invalidateQueries({ queryKey: ["enforcement_requests"] });
    },
  });

  const submitMut = useMutation({
    mutationFn: (notes: string) => (jobId ? mark({ data: { jobId, notes } }) : Promise.resolve(null)),
    onSuccess: () => {
      toast.success("Marked as submitted — enforcement request updated");
      qc.invalidateQueries({ queryKey: ["automation_job", jobId] });
      qc.invalidateQueries({ queryKey: ["enforcement_requests"] });
    },
  });

  const job = jobQuery.data?.job as
    | {
        id: string;
        status: string;
        adapter: string;
        review_summary_json: Record<string, unknown> | null;
        cdp_ws_url: string | null;
        cdp_expires_at: string | null;
        error_json: Record<string, unknown> | null;
        started_at: string | null;
      }
    | undefined;
  const events = (jobQuery.data?.events ?? []) as Array<{
    id: string;
    event: string;
    result: string | null;
    created_at: string;
    payload_json: Record<string, unknown>;
  }>;

  const reviewSummary = useMemo(() => {
    if (!job?.review_summary_json) return null;
    return job.review_summary_json as {
      client?: string;
      original?: string;
      match?: string;
      evidence?: string[];
      validation?: { ok: boolean; issues?: string[] };
      timestamp?: string;
    };
  }, [job]);

  const [notes, setNotes] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white border-l border-border h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-border p-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Enforcement automation</div>
            <div className="font-semibold text-sm">YouTube · {method}</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded"><X className="size-4" /></button>
        </div>

        <div className="p-4 space-y-5">
          {!isYouTube && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm flex gap-2">
              <AlertTriangle className="size-4 mt-0.5" />
              Browser automation is currently available for YouTube only. Other platforms remain manual.
            </div>
          )}

          {!jobId && isYouTube && (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1.5">ADAPTER</div>
                <div className="grid grid-cols-1 gap-2">
                  <label className={`border rounded-lg p-3 cursor-pointer ${adapter === "youtube_copyright" ? "border-primary bg-primary/5" : "border-border"}`}>
                    <input type="radio" name="adapter" value="youtube_copyright" checked={adapter === "youtube_copyright"} onChange={() => setAdapter("youtube_copyright")} className="mr-2" />
                    <span className="text-sm font-medium">YouTube Copyright Complaint</span>
                    <div className="text-xs text-muted-foreground pl-6 mt-0.5">Fills the official copyright removal form, uploads evidence, stops at Review.</div>
                  </label>
                  <label className={`border rounded-lg p-3 cursor-pointer ${adapter === "youtube_community" ? "border-primary bg-primary/5" : "border-border"}`}>
                    <input type="radio" name="adapter" value="youtube_community" checked={adapter === "youtube_community"} onChange={() => setAdapter("youtube_community")} className="mr-2" />
                    <span className="text-sm font-medium">YouTube Community Guideline Report</span>
                    <div className="text-xs text-muted-foreground pl-6 mt-0.5">Reports the video via the in-player Report menu with the selected category.</div>
                  </label>
                </div>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900">
                Automation uses the client's stored YouTube session. No credentials are sent to the browser; the external worker service handles the flow and stops at the platform's Review screen for a human to submit.
              </div>
              <Button onClick={() => startMut.mutate()} disabled={startMut.isPending} className="w-full">
                {startMut.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : <PlayCircle className="size-4 mr-2" />}
                Start automation
              </Button>
            </div>
          )}

          {jobId && (
            <>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded-full border ${statusTone[job?.status ?? "queued"] ?? statusTone.queued}`}>
                  {job?.status ?? "queued"}
                </span>
                {job?.started_at && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="size-3" /> Started {new Date(job.started_at).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {job?.error_json && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <div className="font-semibold flex items-center gap-1"><AlertTriangle className="size-4" /> Automation error</div>
                  <pre className="text-xs mt-2 whitespace-pre-wrap">{JSON.stringify(job.error_json, null, 2)}</pre>
                </div>
              )}

              {reviewSummary && (
                <div className="rounded-xl border border-border p-3 space-y-2 bg-slate-50/60">
                  <div className="text-xs font-semibold text-muted-foreground">REVIEW SUMMARY</div>
                  {reviewSummary.client && <div className="text-sm"><b>Client:</b> {reviewSummary.client}</div>}
                  {reviewSummary.original && <div className="text-sm"><b>Original work:</b> {reviewSummary.original}</div>}
                  {reviewSummary.match && <div className="text-sm"><b>Detected match:</b> {reviewSummary.match}</div>}
                  {reviewSummary.evidence && (
                    <div className="text-sm">
                      <b>Evidence included:</b>
                      <ul className="list-disc ml-5 mt-1 text-xs text-muted-foreground">
                        {reviewSummary.evidence.map((e) => <li key={e}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                  {reviewSummary.validation && (
                    <div className={`text-xs rounded px-2 py-1 inline-flex items-center gap-1 ${reviewSummary.validation.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {reviewSummary.validation.ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                      {reviewSummary.validation.ok ? "All required fields validated" : `${reviewSummary.validation.issues?.length ?? 0} issue(s)`}
                    </div>
                  )}
                </div>
              )}

              {job?.cdp_ws_url && job.status === "review_ready" && (
                <a href={job.cdp_ws_url} target="_blank" rel="noreferrer" className="block rounded-xl border border-primary/40 bg-primary/5 p-3 hover:bg-primary/10">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <ExternalLink className="size-4" /> Open live browser session
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Session expires {job.cdp_expires_at ? new Date(job.cdp_expires_at).toLocaleTimeString() : "shortly"}. Click Submit inside the browser, then confirm below.
                  </div>
                </a>
              )}

              <div className="rounded-xl border border-border p-3 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">TIMELINE</div>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {events.length === 0 && <div className="text-xs text-muted-foreground">No events yet…</div>}
                  {events.map((e) => (
                    <div key={e.id} className="text-xs flex gap-2 items-baseline">
                      <span className="text-muted-foreground tabular-nums">{new Date(e.created_at).toLocaleTimeString()}</span>
                      <span className="font-mono">{e.event}</span>
                      {e.result && <span className={e.result === "ok" ? "text-emerald-700" : "text-red-700"}>{e.result}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {(job?.status === "review_ready" || job?.status === "running") && (
                <div className="space-y-2">
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Submission notes (optional)…" rows={2} className="w-full text-xs border border-border rounded-lg p-2 bg-background" />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => submitMut.mutate(notes)} disabled={submitMut.isPending} className="flex-1">
                      <ShieldCheck className="size-4 mr-1" /> Mark as submitted
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
