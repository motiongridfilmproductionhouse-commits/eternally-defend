import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Fingerprint, Loader2, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  listPreservedEvidence,
  preserveFindingEvidence,
  type PreservedEvidenceItem,
} from "@/lib/deepfake/preserved-evidence.functions";

export interface PreservedEvidenceTarget {
  findingId?: string | null;
  leadId?: string | null;
  sourcePageUrl?: string | null;
  title?: string | null;
  platform?: string | null;
  caseRef?: string | null;
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n > 1 ? n : n * 100)}%`;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-medium text-foreground break-all text-right">{value}</span>
    </div>
  );
}

export function PreservedEvidenceDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PreservedEvidenceTarget | null;
}) {
  const queryClient = useQueryClient();
  const list = useServerFn(listPreservedEvidence);
  const preserve = useServerFn(preserveFindingEvidence);

  const queryKey = [
    "preserved-evidence",
    target?.findingId ?? null,
    target?.leadId ?? null,
    target?.sourcePageUrl ?? null,
  ];

  const evidence = useQuery({
    queryKey,
    enabled: Boolean(open && target),
    queryFn: () =>
      list({
        data: {
          ...(target?.findingId ? { findingId: target.findingId } : {}),
          ...(!target?.findingId && target?.leadId ? { leadId: target.leadId } : {}),
          ...(!target?.findingId && !target?.leadId && target?.sourcePageUrl
            ? { sourcePageUrl: target.sourcePageUrl }
            : {}),
        },
      }),
  });

  const capture = useMutation({
    mutationFn: () =>
      preserve({
        data: target?.findingId
          ? { findingId: target.findingId }
          : { leadId: target?.leadId as string },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const items = (evidence.data?.items ?? []) as PreservedEvidenceItem[];
  const canCapture = Boolean(target?.findingId || target?.leadId);
  const sourceUnavailable = items.some((i) => i.source_reachable === false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            Preserved evidence
          </DialogTitle>
          <DialogDescription className="text-xs break-all">
            {target?.title || target?.sourcePageUrl || "Internal evidence snapshot"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-secondary/10 p-3 text-[11px] space-y-1">
            <MetaRow
              label="Original source (provenance)"
              value={target?.sourcePageUrl || "Not recorded"}
            />
            <MetaRow label="Platform / domain" value={target?.platform || "—"} />
            <MetaRow label="Case / finding ID" value={target?.caseRef || target?.findingId || target?.leadId || "—"} />
          </div>

          {sourceUnavailable && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="size-4 shrink-0" />
              Original source unavailable — displaying preserved evidence snapshot.
            </div>
          )}

          {evidence.isLoading ? (
            <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading preserved evidence…
            </div>
          ) : items.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed border-border/60 p-6 text-center">
              <p className="text-xs text-muted-foreground">
                No preserved copy stored yet for this finding. Preservation only stores media Eterna
                already captured during discovery and verification.
              </p>
              {canCapture && (
                <Button size="sm" onClick={() => capture.mutate()} disabled={capture.isPending}>
                  {capture.isPending ? (
                    <>
                      <Loader2 className="mr-2 size-3.5 animate-spin" /> Preserving…
                    </>
                  ) : (
                    "Preserve captured evidence"
                  )}
                </Button>
              )}
              {capture.isError && (
                <p className="text-[11px] text-destructive">
                  {(capture.error as Error)?.message ?? "Preservation failed."}
                </p>
              )}
              {capture.isSuccess && capture.data && (
                <p className="text-[11px] text-muted-foreground">
                  {capture.data.preserved} preserved · {capture.data.already_present} already stored ·{" "}
                  {capture.data.skipped} skipped · {capture.data.failed} failed
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((item) => (
                <figure
                  key={item.id}
                  className="overflow-hidden rounded-xl border border-border/60 bg-secondary/10"
                >
                  <img
                    src={item.view_url}
                    alt="Preserved evidence snapshot"
                    loading="lazy"
                    className="h-56 w-full bg-black/40 object-contain"
                  />
                  <figcaption className="space-y-0.5 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="uppercase text-[9px]">
                        {item.media_kind}
                      </Badge>
                      <Badge variant="outline" className="uppercase text-[9px]">
                        {item.evidence_status.replace(/_/g, " ")}
                      </Badge>
                      {item.frame_index !== null && (
                        <Badge variant="outline" className="text-[9px]">
                          frame {item.frame_index}
                          {item.frame_timestamp_seconds !== null
                            ? ` · ${item.frame_timestamp_seconds}s`
                            : ""}
                        </Badge>
                      )}
                    </div>
                    <MetaRow label="Source URL" value={item.source_media_url || item.source_page_url} />
                    <MetaRow
                      label="Captured"
                      value={new Date(item.capture_timestamp).toLocaleString()}
                    />
                    <MetaRow label="Platform" value={item.platform_domain || "—"} />
                    <MetaRow label="Identity / face match" value={pct(item.face_similarity)} />
                    <MetaRow label="Identity confidence" value={pct(item.identity_confidence)} />
                    <MetaRow label="Synthetic confidence" value={pct(item.synthetic_confidence)} />
                    <MetaRow
                      label="Finding / case ID"
                      value={item.finding_id || item.lead_id || "—"}
                    />
                    {item.sha256 && (
                      <MetaRow
                        label="SHA-256"
                        value={
                          <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                            <Fingerprint className="size-3" />
                            {item.sha256.slice(0, 24)}…
                          </span>
                        }
                      />
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          {items.length > 0 && canCapture && (
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <p className="text-[10px] text-muted-foreground">
                Snapshots are stored inside Eterna and only visible to your account.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => capture.mutate()}
                disabled={capture.isPending}
              >
                {capture.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-3.5 animate-spin" /> Refreshing…
                  </>
                ) : (
                  "Preserve any new media"
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PreservedEvidenceDialog;
