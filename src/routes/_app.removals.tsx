import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_app/removals")({
  head: () => ({ meta: [{ title: "Removal Center — Eterna Sentinel" }] }),
  component: RemovalsPage,
});

interface RemovalRow {
  id: string;
  target_url: string | null;
  platform: string;
  method: string;
  status: string;
  submitted_at: string | null;
  responded_at: string | null;
  created_at: string;
  submission_status: string | null;
  automation_status: string | null;
  automation_job_id: string | null;
  authorization_pdf_path: string | null;
  package_generated_at: string | null;
}

const statusColor: Record<string, string> = {
  Queued: "oklch(0.75 0.16 70)",
  Sent: "oklch(0.65 0.18 240)",
  Approved: "oklch(0.68 0.16 155)",
  Rejected: "oklch(0.63 0.24 25)",
  Withdrawn: "oklch(0.55 0.03 275)",
};

/**
 * "Queued" means recorded, not sent. Requests were sitting here for weeks while
 * the UI counted them as "in flight", so queued rows now state plainly that
 * nothing has been submitted, and anything older than a day is marked stalled.
 */
function queuedAgeDays(r: RemovalRow): number {
  return Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000);
}

function isStalled(r: RemovalRow): boolean {
  return r.status === "Queued" && queuedAgeDays(r) >= 1;
}

/**
 * Exact blocking reason for a queued request. "Queued" on its own told the
 * operator nothing about why nothing was moving, so we surface the concrete
 * precondition that is missing.
 */
function blockingReason(r: RemovalRow): string {
  if (r.status !== "Queued") return "";
  if (!r.target_url) return "Blocked: no target URL recorded on the request.";
  if (!r.authorization_pdf_path)
    return "Blocked: no signed client authorization document is attached, so submission is not permitted.";
  if (!r.package_generated_at)
    return "Blocked: the evidence package has not been generated for this request yet.";
  if (!r.automation_job_id)
    return "Blocked: no submission job was ever created for this request — it is a draft record only.";
  if (!r.automation_status || r.automation_status === "queued")
    return "Blocked: submission job created but never claimed by a worker (live submission is disabled).";
  if (r.automation_status === "failed")
    return "Blocked: the submission job failed. Review the automation log before re-queuing.";
  if (r.submission_status && r.submission_status !== "submitted")
    return `Blocked: submission status is "${r.submission_status}" — nothing has been sent to the platform.`;
  return "Blocked: awaiting submission. Nothing has been sent to the platform.";
}

function RemovalsPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;

  const q = useQuery({
    queryKey: ["removals", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<RemovalRow[]> => {
      const { data, error } = await supabase
        .from("enforcement_requests")
        .select(
          "id,target_url,platform,method,status,submitted_at,responded_at,created_at,submission_status,automation_status,automation_job_id,authorization_pdf_path,package_generated_at",
        )
        .neq("method", "Legal Notice")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RemovalRow[];
    },
  });

  const rows = q.data ?? [];
  const loading = !ready || q.isLoading;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="TOTAL RECORDED" value={rows.length} sub="All removal requests" />
        <StatCard
          label="APPROVED"
          value={rows.filter((r) => r.status === "Approved").length}
          sub="Successfully taken down"
          accent="oklch(0.68 0.16 155)"
        />
        <StatCard
          label="IN FLIGHT"
          value={rows.filter((r) => r.status === "Sent").length}
          sub="Submitted, awaiting platform"
          accent="oklch(0.65 0.18 240)"
        />
        <StatCard
          label="QUEUED / NOT SENT"
          value={rows.filter((r) => r.status === "Queued").length}
          sub="Recorded only, never submitted"
          accent="oklch(0.75 0.16 70)"
        />
        <StatCard
          label="REJECTED"
          value={rows.filter((r) => r.status === "Rejected").length}
          sub="Escalate to legal"
          accent="oklch(0.63 0.24 25)"
        />
      </div>

      {rows.some(isStalled) && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
          <div className="font-semibold text-danger">
            {rows.filter(isStalled).length} removal request(s) stalled in the queue
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            These were recorded more than 24 hours ago and have never been submitted to a platform
            or transport. Nothing has been sent on your behalf. Review them in{" "}
            <Link to="/enforcement" className="text-primary font-semibold">
              Enforcement
            </Link>{" "}
            before re-queuing.
          </p>
        </div>
      )}


      <PageCard title="REMOVAL REQUESTS" sub="Live queue and history">
        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No removal requests yet. Queue one from{" "}
            <Link to="/enforcement" className="text-primary font-semibold">
              Enforcement
            </Link>
            .
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2.5 pr-4 font-medium">ID</th>
                  <th className="py-2.5 pr-4 font-medium">URL</th>
                  <th className="py-2.5 pr-4 font-medium">Platform</th>
                  <th className="py-2.5 pr-4 font-medium">Method</th>
                  <th className="py-2.5 pr-4 font-medium">Created</th>
                  <th className="py-2.5 pr-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-accent/30">
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                      {r.id.slice(0, 8)}
                    </td>
                    <td className="py-3 pr-4 font-medium truncate max-w-[280px]">
                      {r.target_url ? (
                        <a
                          className="text-primary"
                          href={r.target_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.target_url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{r.platform}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{r.method}</td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-col items-start gap-1">
                        <Pill color={statusColor[r.status] ?? "oklch(0.55 0.03 275)"}>
                          {r.status}
                        </Pill>
                        {r.status === "Queued" && (
                          <>
                            <span
                              className={`text-[10px] font-semibold ${isStalled(r) ? "text-danger" : "text-muted-foreground"}`}
                            >
                              {isStalled(r) ? `STALLED · ${queuedAgeDays(r)}d` : "NOT SUBMITTED"}
                            </span>
                            <span className="text-[10px] text-muted-foreground max-w-[260px] leading-snug">
                              {blockingReason(r)}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageCard>
    </div>
  );
}
