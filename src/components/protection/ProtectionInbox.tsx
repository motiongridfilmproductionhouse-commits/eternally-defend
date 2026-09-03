import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
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
import { startYoutubeRemovalScan } from "@/lib/youtube-removal/removal.functions";
import type { InboxBucket, InboxItem } from "@/lib/protection/inbox";

const STALE_MS = 12 * 60 * 60 * 1000;

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

  const inboxQuery = useQuery({
    queryKey: ["protection-inbox"],
    queryFn: () => fetchInbox(),
    refetchInterval: 60_000,
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
  };
  const items = data?.items ?? [];

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
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
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
        </div>

        {summary.analyzed === 0 ? (
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
