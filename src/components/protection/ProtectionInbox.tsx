import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  ImageOff,
  Loader2,
  Play,
  Radio,
  ScanLine,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getProtectionInbox } from "@/lib/protection/inbox.functions";
import { supabase } from "@/integrations/supabase/client";
import { startYoutubeRemovalScan } from "@/lib/youtube-removal/removal.functions";
import type { InboxBucket, InboxItem } from "@/lib/protection/inbox";
import type { InboxRemovalRow } from "@/lib/protection/inbox.functions";
import {
  signRemovalEvidenceUrl,
  signRemovalThumbnailUrl,
} from "@/lib/enforcement-packages.functions";

const STALE_MS = 12 * 60 * 60 * 1000;

function formatIndiaDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function DashboardRemovalThumbnail({ row }: { row: InboxRemovalRow }) {
  const signThumbnail = useServerFn(signRemovalThumbnailUrl);
  const hasThumbnail = row.thumbnailPath !== null;
  const thumbnail = useQuery({
    queryKey: ["removal-thumbnail", row.id],
    enabled: hasThumbnail,
    staleTime: 8 * 60 * 1000,
    retry: 1,
    queryFn: () => signThumbnail({ data: { requestId: row.id } }),
  });

  if (!hasThumbnail) {
    return (
      <div className="grid h-20 w-16 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
        <ImageOff className="size-4" aria-label="No thumbnail available" />
      </div>
    );
  }

  if (thumbnail.isLoading) {
    return <div className="h-20 w-16 shrink-0 animate-pulse rounded-md bg-muted" aria-label="Loading thumbnail" />;
  }

  if (!thumbnail.data?.url) {
    return (
      <div className="grid h-20 w-16 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
        <ImageOff className="size-4" aria-label="Thumbnail unavailable" />
      </div>
    );
  }

  return (
    <a
      href={row.targetUrl ?? thumbnail.data.url}
      target="_blank"
      rel="noreferrer"
      className={`removal-thumbnail group ${row.removedAt ? "is-removed" : ""}`}
      aria-label={`Open ${row.platform} removal evidence`}
    >
      <img
        src={thumbnail.data.url}
        alt={`${row.platform} removal thumbnail`}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <span className="absolute inset-0 grid place-items-center bg-foreground/20 opacity-0 transition-opacity group-hover:opacity-100">
        <Play className="size-4 fill-background text-background" aria-hidden="true" />
      </span>
      {row.removedAt ? (
        <span className="removal-thumbnail__verified" aria-hidden="true">
          <Check className="size-3" /> Removed
        </span>
      ) : null}
    </a>
  );
}

function DashboardRemovalDetails({ row }: { row: InboxRemovalRow }) {
  const submittedAt = row.firstVideoSubmittedAt ?? row.submittedAt;
  const isPending = row.status === "Sent";
  const isComplete = Boolean(row.removedAt) || row.status === "Approved";
  const stages = [
    { label: "Evidence captured", icon: ScanLine, done: true },
    { label: "Integrity sealed", icon: Fingerprint, done: true },
    { label: "Submitted to Meta", icon: Send, done: Boolean(submittedAt) },
    { label: isComplete ? "Meta confirmed" : "Meta reply", icon: isComplete ? Check : Radio, done: isComplete },
  ];

  return (
    <div className="removal-intelligence min-w-0 flex-1">
      <div className="removal-intelligence__header">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground">
            <Bot className="size-3.5 text-primary" aria-hidden="true" />
            Eterna autonomous case · {row.id.slice(0, 8)}
          </div>
          <p className="truncate font-mono text-sm font-semibold">
            {row.targetUrl ? (
              <a href={row.targetUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {row.targetUrl}
              </a>
            ) : (
              "Removal request"
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{row.platform} · {row.method}</p>
        </div>
        <div className={`removal-intelligence__platform-state ${isPending ? "is-live" : ""}`}>
          <span aria-hidden="true" />
          {isPending ? "META REPLY PENDING" : isComplete ? "META CONFIRMED" : row.status.toUpperCase()}
        </div>
      </div>

      <div className="removal-intelligence__grid">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const active = !stage.done && isPending;
          return (
            <div key={stage.label} className={`removal-intelligence__stage ${stage.done ? "is-done" : ""} ${active ? "is-active" : ""}`}>
              <div className="removal-intelligence__stage-icon"><Icon className="size-3.5" /></div>
              <div>
                <span>0{index + 1}</span>
                <strong>{stage.label}</strong>
                <small>{stage.done ? "Complete" : active ? "Listening for response" : "Not yet recorded"}</small>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div className="removal-intelligence__metric">
          <span>Submitted</span>
          <strong>{submittedAt ? `${formatIndiaDateTime(submittedAt)} IST` : "Date unavailable"}</strong>
        </div>
        <div className="removal-intelligence__metric">
          <span>Initial outcome</span>
          <strong>{row.escalatedToManualTeam ? "Rejected · manually escalated" : "Platform review"}</strong>
        </div>
        <div className="removal-intelligence__metric">
          <span>Final outcome</span>
          <strong>{row.removedAt ? `${row.removedVideoCount ?? 0} video${row.removedVideoCount === 1 ? "" : "s"} removed` : "Response not received"}</strong>
        </div>
      </div>

      {isPending ? (
        <div className="removal-intelligence__listener" role="status">
          <div className="removal-intelligence__signal" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div>
            <strong><Clock3 className="size-3.5" /> Meta response monitor active</strong>
            <span>Eterna is tracking this submission. The case will update when a verified platform reply is recorded.</span>
          </div>
        </div>
      ) : null}

      {isComplete && row.removedAt ? (
        <div className="removal-intelligence__success" role="status">
          <div className="removal-intelligence__success-mark" aria-hidden="true">
            <span /><ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <strong>Video removal verified</strong>
            <span>
              Platform response recorded {formatIndiaDateTime(row.removedAt)} IST · Evidence remains preserved
            </span>
          </div>
          <div className="removal-intelligence__success-wave" aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i />
          </div>
        </div>
      ) : null}

      {row.reportNumber ? (
        <p className="removal-intelligence__report">
          <FileCheck2 className="size-3.5 text-primary" /> Meta Intellectual Property Report <strong className="font-mono text-foreground">#{row.reportNumber}</strong>
        </p>
      ) : null}
      {row.evidenceAttachments.length > 0 ? (
        <div className="removal-intelligence__evidence">
          <div className="removal-intelligence__evidence-heading">
            <p><ScanLine className="size-3.5 text-primary" /> Autocapture evidence · {row.evidenceAttachments.length} attachment{row.evidenceAttachments.length === 1 ? "" : "s"}</p>
            <span><Fingerprint className="size-3" /> Access controlled · integrity preserved</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {row.evidenceAttachments.map((attachment, index) => (
              <DashboardEvidenceAttachment
                key={attachment.path}
                row={row}
                attachment={attachment}
                index={index}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DashboardEvidenceAttachment({
  row,
  attachment,
  index,
}: {
  row: InboxRemovalRow;
  attachment: InboxRemovalRow["evidenceAttachments"][number];
  index: number;
}) {
  const signEvidence = useServerFn(signRemovalEvidenceUrl);
  const evidence = useQuery({
    queryKey: ["removal-evidence", row.id, index],
    staleTime: 8 * 60 * 1000,
    retry: 1,
    queryFn: () => signEvidence({ data: { requestId: row.id, attachmentIndex: index } }),
  });

  if (evidence.isLoading) {
    return <div className="aspect-[4/3] animate-pulse rounded-md bg-muted" aria-label={`Loading ${attachment.label}`} />;
  }

  if (!evidence.data?.url) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-md border bg-muted text-muted-foreground">
        <ImageOff className="size-4" aria-label={`${attachment.label} unavailable`} />
      </div>
    );
  }

  return (
    <a
      href={evidence.data.url}
      target="_blank"
      rel="noreferrer"
      className="removal-evidence-tile group"
      aria-label={`Open ${attachment.label}`}
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={evidence.data.url}
          alt={attachment.label}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <span className="removal-evidence-tile__scan" aria-hidden="true" />
        <span className="removal-evidence-tile__corners" aria-hidden="true" />
      </div>
      <span className="flex min-h-10 items-center justify-between gap-1 px-2 py-1.5 text-[10px] font-medium leading-tight">
        <span>{attachment.label}</span>
        <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </span>
    </a>
  );
}

const SECTIONS: { bucket: InboxBucket; title: string; dot: string; hint: string }[] = [
  {
    bucket: "POSSIBLE_REMOVAL",
    title: "Possible removal actions",
    dot: "bg-destructive",
    hint: "Strongest evidence. Any send still passes the existing authorization, verification and pre-send gates.",
  },
  {
    bucket: "NEEDS_REVIEW",
    title: "Need review",
    dot: "bg-amber-500",
    hint: "Inconclusive analysis or policy requires a human decision before anything can proceed.",
  },
  {
    bucket: "MONITORING",
    title: "Legitimate / monitoring",
    dot: "bg-emerald-500",
    hint: "Normal appearances and low-risk coverage. Monitored, not treated as threats.",
  },
];

/**
 * Automated protection inbox. Discovery, analysis, prioritisation and case
 * preparation are performed by the existing autopilot pipeline — this view only
 * displays and explains the results. It never triggers enforcement.
 */
export function ProtectionInbox() {
  const fetchInbox = useServerFn(getProtectionInbox);
  const startScan = useServerFn(startYoutubeRemovalScan);
  const kicked = useRef(false);
  const [open, setOpen] = useState<Record<InboxBucket, boolean>>({
    POSSIBLE_REMOVAL: true,
    NEEDS_REVIEW: true,
    MONITORING: false,
  });
  const [selected, setSelected] = useState<InboxItem | null>(null);

  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const inboxQuery = useQuery({
    queryKey: ["protection-inbox"],
    queryFn: () => fetchInbox(),
    enabled: hasSession,
    refetchInterval: hasSession ? 60_000 : false,
    retry: (count, err) =>
      !String((err as Error)?.message ?? "").includes("Unauthorized") && count < 2,
  });

  const data = inboxQuery.data;

  // Automatic discovery: if no recent discovery run exists, kick the existing
  // scan pipeline once so the customer never has to hunt for content.
  useEffect(() => {
    if (!data || kicked.current) return;
    if (data.discovery.running) return;
    const last = data.discovery.lastScanAt ? Date.parse(data.discovery.lastScanAt) : 0;
    if (last && Date.now() - last < STALE_MS) return;
    kicked.current = true;
    void startScan({ data: {} })
      .then(() => inboxQuery.refetch())
      .catch(() => undefined);
  }, [data, startScan, inboxQuery]);

  const summary = data?.summary ?? {
    analyzed: 0,
    possibleRemoval: 0,
    needsReview: 0,
    monitoring: 0,
    removalsInProgress: 0,
  };
  const items = data?.items ?? [];
  const removals = data?.removals ?? [];

  return (
    <Card className="card-surface">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> Eterna Protection
          </span>
          {inboxQuery.isFetching || data?.discovery.running ? (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Discovering &amp; analysing
            </span>
          ) : null}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {summary.analyzed} item{summary.analyzed === 1 ? "" : "s"} discovered and analysed
          automatically. No manual searching required.
          {removals.length > 0
            ? ` ${removals.length} removal request${removals.length === 1 ? "" : "s"} submitted, ${summary.removalsInProgress} awaiting the platform.`
            : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <SummaryTile
            dot="bg-destructive"
            value={summary.possibleRemoval}
            label="Possible removal actions"
          />
          <SummaryTile dot="bg-amber-500" value={summary.needsReview} label="Need review" />
          <SummaryTile
            dot="bg-emerald-500"
            value={summary.monitoring}
            label="Legitimate / monitoring"
          />
          <SummaryTile
            dot="bg-sky-500"
            value={removals.length}
            label="Removals submitted"
          />
        </div>

        {removals.length > 0 ? (
          <div className="rounded-lg border">
            <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-sky-500" />
              Removal requests in progress
              <Badge variant="secondary">{removals.length}</Badge>
            </div>
            <div className="divide-y border-t">
              {removals.map((r) => (
                <div key={r.id} className="flex items-start gap-3 px-3 py-4">
                  <DashboardRemovalThumbnail row={r} />
                  <DashboardRemovalDetails row={r} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {summary.analyzed === 0 && removals.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
            Automated discovery is running. Interviews, podcasts, appearances, videos and Shorts are
            found and analysed for you — results appear here as soon as the pipeline completes.
          </p>
        ) : null}


        {SECTIONS.map((section) => {
          const sectionItems = items.filter((i) => i.bucket === section.bucket);
          if (sectionItems.length === 0) return null;
          const isOpen = open[section.bucket];
          return (
            <div key={section.bucket} className="rounded-lg border">
              <button
                type="button"
                onClick={() => setOpen((s) => ({ ...s, [section.bucket]: !s[section.bucket] }))}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`size-2 rounded-full ${section.dot}`} />
                  {section.title}
                  <Badge variant="secondary">{sectionItems.length}</Badge>
                </span>
                {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </button>
              {isOpen ? (
                <div className="space-y-2 border-t p-3">
                  <p className="text-xs text-muted-foreground">{section.hint}</p>
                  {sectionItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card/50 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{item.title ?? item.url}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.channelTitle ?? "Unknown channel"}
                          {item.caseStatusText ? ` · case ${item.caseStatusText}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={item.bucket === "POSSIBLE_REMOVAL" ? "destructive" : "outline"}
                        >
                          {item.label}
                        </Badge>
                        <Button size="sm" variant="outline" onClick={() => setSelected(item)}>
                          Why?
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>

      <Dialog open={Boolean(selected)} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{selected?.title ?? "Case detail"}</DialogTitle>
            <DialogDescription>{selected?.label}</DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {selected.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Meta label="Risk" value={selected.riskLevel ?? "—"} />
                <Meta label="Subject match" value={selected.subjectStatus ?? "—"} />
                <Meta label="Channel type" value={selected.channelClass ?? "—"} />
                <Meta
                  label="Evidence package"
                  value={selected.evidenceVerified ? "complete" : "incomplete"}
                />
                <Meta label="Enforcement case" value={selected.caseStatusText ?? "none yet"} />
                <Meta
                  label="Your input needed"
                  value={
                    selected.userAction === "NONE"
                      ? "no"
                      : selected.userAction.toLowerCase().replace("_", " ")
                  }
                />
              </dl>
              <Button asChild size="sm" variant="outline">
                <a href={selected.url} target="_blank" rel="noreferrer">
                  Open source <ExternalLink className="ml-1 size-3" />
                </a>
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SummaryTile({ dot, value, label }: { dot: string; value: number; label: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${dot}`} />
        <span className="text-lg font-semibold">{value}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
