import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { ExternalLink, FileCheck2, Loader2, Play, ShieldCheck } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  signRemovalEvidenceUrl,
  signRemovalThumbnailUrl,
} from "@/lib/enforcement-packages.functions";

export const Route = createFileRoute("/_app/removals")({
  head: () => ({
    meta: [
      { title: "Removal Center | Eterna Sentinel" },
      { name: "description", content: "Review authenticated removal requests, outcomes, and private evidence." },
      { property: "og:title", content: "Removal Center | Eterna Sentinel" },
      { property: "og:description", content: "Review authenticated removal requests, outcomes, and private evidence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
  metadata: Record<string, unknown> | null;
}

interface EvidenceAttachment {
  label: string;
  path: string;
  content_type?: string;
}

function metadataText(row: RemovalRow, key: string): string | null {
  const value = row.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function metadataNumber(row: RemovalRow, key: string): number | null {
  const value = row.metadata?.[key];
  return typeof value === "number" ? value : null;
}

function formatIndiaDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function evidenceAttachments(row: RemovalRow): EvidenceAttachment[] {
  const value = row.metadata?.evidence_attachments;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is EvidenceAttachment => {
    if (!item || Array.isArray(item) || typeof item !== "object") return false;
    return typeof item.label === "string" && typeof item.path === "string";
  });
}

function RemovalEvidenceLink({ row, attachment, index }: {
  row: RemovalRow;
  attachment: EvidenceAttachment;
  index: number;
}) {
  const signEvidence = useServerFn(signRemovalEvidenceUrl);
  const evidence = useQuery({
    queryKey: ["removal-evidence", row.id, index],
    staleTime: 8 * 60 * 1000,
    queryFn: () => signEvidence({ data: { requestId: row.id, attachmentIndex: index } }),
  });

  return (
    <a
      href={evidence.data?.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!evidence.data?.url}
      className="group flex min-h-16 items-center gap-3 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:border-primary/40 hover:bg-accent/30 aria-disabled:pointer-events-none aria-disabled:opacity-60"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded bg-primary/10 text-primary">
        {evidence.isLoading ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
      </span>
      <span className="min-w-0 flex-1 text-xs font-medium leading-snug">{attachment.label}</span>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
    </a>
  );
}

function RemovalCaseDetails({ row }: { row: RemovalRow }) {
  const reportNumber = metadataText(row, "intellectual_property_report_number");
  const submittedAt = metadataText(row, "first_video_submitted_at");
  const removedAt = metadataText(row, "removed_at");
  const removedCount = metadataNumber(row, "removed_video_count");
  const attachments = evidenceAttachments(row);
  if (!reportNumber && attachments.length === 0) return null;

  return (
    <tr className="border-b border-border/60 bg-muted/20">
      <td colSpan={7} className="px-3 py-4">
        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground">
              <ShieldCheck className="size-4 text-primary" /> Meta removal outcome
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="border-l-2 border-primary/40 pl-3">
                <div className="text-[10px] uppercase text-muted-foreground">Found and submitted</div>
                <div className="mt-1 text-xs font-medium">{submittedAt ? formatIndiaDateTime(submittedAt) : "—"} IST</div>
              </div>
              <div className="border-l-2 border-danger/40 pl-3">
                <div className="text-[10px] uppercase text-muted-foreground">Automated outcome</div>
                <div className="mt-1 text-xs font-medium">Rejected, escalated to manual team</div>
              </div>
              <div className="border-l-2 border-success/40 pl-3">
                <div className="text-[10px] uppercase text-muted-foreground">Meta confirmed</div>
                <div className="mt-1 text-xs font-medium">{removedAt ? formatIndiaDateTime(removedAt) : "—"} IST</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span><strong className="text-foreground">{removedCount ?? 0}</strong> videos removed</span>
              {reportNumber && <span>IP Report <strong className="font-mono text-foreground">#{reportNumber}</strong></span>}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Private evidence</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {attachments.map((attachment, index) => (
                <RemovalEvidenceLink key={attachment.path} row={row} attachment={attachment} index={index} />
              ))}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
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

function RemovalThumbnail({ row }: { row: RemovalRow }) {
  const signThumbnail = useServerFn(signRemovalThumbnailUrl);
  const hasThumbnail = typeof row.metadata?.thumbnail_path === "string";
  const thumbnail = useQuery({
    queryKey: ["removal-thumbnail", row.id],
    enabled: hasThumbnail,
    staleTime: 8 * 60 * 1000,
    queryFn: () => signThumbnail({ data: { requestId: row.id } }),
  });

  if (!hasThumbnail) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (!thumbnail.data?.url) {
    return <div className="h-16 w-11 animate-pulse rounded bg-muted" aria-label="Loading thumbnail" />;
  }

  return (
    <a
      href={row.target_url ?? thumbnail.data.url}
      target="_blank"
      rel="noreferrer"
      className="group relative block h-16 w-11 overflow-hidden rounded border border-border bg-muted shadow-sm"
      aria-label={`Open ${row.platform} reel`}
    >
      <img
        src={thumbnail.data.url}
        alt={`${row.platform} reel thumbnail`}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <span className="absolute inset-0 grid place-items-center bg-foreground/15 opacity-0 transition-opacity group-hover:opacity-100">
        <Play className="size-4 fill-background text-background" aria-hidden="true" />
      </span>
    </a>
  );
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
          "id,target_url,platform,method,status,submitted_at,responded_at,created_at,submission_status,automation_status,automation_job_id,authorization_pdf_path,package_generated_at,metadata",
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
                  <th className="py-2.5 pr-4 font-medium">Preview</th>
                  <th className="py-2.5 pr-4 font-medium">URL</th>
                  <th className="py-2.5 pr-4 font-medium">Platform</th>
                  <th className="py-2.5 pr-4 font-medium">Method</th>
                  <th className="py-2.5 pr-4 font-medium">Created</th>
                  <th className="py-2.5 pr-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                  <tr className="border-b border-border/60 hover:bg-accent/30">
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                      {r.id.slice(0, 8)}
                    </td>
                    <td className="py-3 pr-4">
                      <RemovalThumbnail row={r} />
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
                  <RemovalCaseDetails row={r} />
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageCard>
    </div>
  );
}
