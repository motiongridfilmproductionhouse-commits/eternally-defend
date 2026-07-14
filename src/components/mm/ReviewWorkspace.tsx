/**
 * Full human-review workspace for a single timeline finding.
 * Replaces the earlier 3-button confirm/false-positive/radar flow.
 *
 * Every change writes:
 *   - timestamp_findings.human_review_status / severity / reviewer_notes /
 *     reviewer_id / reviewed_at   (via reviewFinding server fn)
 *   - finding_review_history      (append-only audit log)
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reviewFinding, getFindingHistory } from "@/lib/mm/review.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Flag, History, Languages, Radar, ScrollText } from "lucide-react";

const STATUSES = [
  { value: "unreviewed", label: "Unreviewed" },
  { value: "confirmed", label: "Confirmed" },
  { value: "false_positive", label: "False positive" },
  { value: "needs_context", label: "Needs context" },
  { value: "escalated", label: "Escalated" },
  { value: "legally_reviewed", label: "Legally reviewed" },
  { value: "resolved", label: "Resolved" },
] as const;

const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

export function ReviewWorkspace({ finding, open, onClose, onSaved }: {
  finding: any; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const reviewFn = useServerFn(reviewFinding);
  const historyFn = useServerFn(getFindingHistory);

  const [status, setStatus] = useState<string>(finding?.human_review_status ?? "unreviewed");
  const [severity, setSeverity] = useState<string>(finding?.severity ?? "medium");
  const [notes, setNotes] = useState<string>(finding?.reviewer_notes ?? "");
  const [entityConfirmed, setEntityConfirmed] = useState<boolean | null>(null);
  const [translationApproved, setTranslationApproved] = useState<boolean | null>(null);
  const [transcriptAccurate, setTranscriptAccurate] = useState<boolean | null>(null);

  const history = useQuery({
    queryKey: ["finding-history", finding?.id],
    queryFn: () => historyFn({ data: { findingId: finding.id } }),
    enabled: !!finding?.id && open,
  });

  const save = useMutation({
    mutationFn: (opts: { escalate?: boolean }) => reviewFn({
      data: {
        findingId: finding.id,
        human_review_status: status as any,
        severity: severity as any,
        reviewer_notes: buildNotes({ notes, entityConfirmed, translationApproved, transcriptAccurate }),
        send_to_radar: opts.escalate,
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finding-history", finding.id] });
      qc.invalidateQueries({ queryKey: ["mm-job"] });
      onSaved();
    },
  });

  if (!finding) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="size-4" /> Review finding
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="border border-border rounded-lg p-3 bg-muted/30">
            <div className="font-medium">{finding.title}</div>
            {finding.description && <p className="mt-1 text-xs text-muted-foreground">{finding.description}</p>}
            {finding.transcript_excerpt && (
              <blockquote className="mt-2 text-xs border-l-2 border-border pl-2 italic text-muted-foreground">
                {finding.transcript_excerpt.slice(0, 300)}
              </blockquote>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Review status">
              <select className="w-full border border-border rounded px-2 py-1.5 bg-background text-sm"
                value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select className="w-full border border-border rounded px-2 py-1.5 bg-background text-sm"
                value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Reviewer notes">
            <Textarea rows={3} placeholder="Context, action taken, references…"
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TriToggle label="Entity match" icon={CheckCircle2} value={entityConfirmed} onChange={setEntityConfirmed}
              yes="Confirmed" no="Wrong entity" />
            <TriToggle label="Translation" icon={Languages} value={translationApproved} onChange={setTranslationApproved}
              yes="Approved" no="Rejected" />
            <TriToggle label="Transcript" icon={ScrollText} value={transcriptAccurate} onChange={setTranscriptAccurate}
              yes="Accurate" no="Inaccurate" />
          </div>

          {history.data && (
            <div>
              <div className="text-xs font-medium mb-1.5 flex items-center gap-1"><History className="size-3.5" /> Audit history</div>
              <ol className="space-y-1.5 text-xs max-h-40 overflow-y-auto pr-1">
                {(history.data.history ?? []).length === 0 && <li className="text-muted-foreground">No prior reviews.</li>}
                {(history.data.history ?? []).map((h: any) => (
                  <li key={h.id} className="border border-border rounded p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{h.action}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(h.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {h.from_status} → <b>{h.to_status}</b>
                      {h.to_severity && ` · severity ${h.from_severity ?? "—"} → ${h.to_severity}`}
                    </div>
                    {h.notes && <div className="text-[11px] mt-1">{h.notes}</div>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {save.error && <div className="text-xs text-destructive"><AlertTriangle className="inline size-3 mr-1" />{(save.error as Error).message}</div>}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button onClick={() => save.mutate({})} disabled={save.isPending}>
              <CheckCircle2 className="size-4 mr-2" />{save.isPending ? "Saving…" : "Save review"}
            </Button>
            <Button variant="outline" onClick={() => { setStatus("escalated"); save.mutate({ escalate: true }); }} disabled={save.isPending}>
              <Radar className="size-4 mr-2" />Escalate to Threat Radar
            </Button>
            <Button variant="outline" onClick={() => { setStatus("false_positive"); save.mutate({}); }} disabled={save.isPending}>
              <Flag className="size-4 mr-2" />Mark false positive
            </Button>
            <Button variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: any) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function TriToggle({ label, icon: Icon, value, onChange, yes, no }: any) {
  return (
    <div className="border border-border rounded-lg p-2">
      <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Icon className="size-3" />{label}</div>
      <div className="flex gap-1 mt-1.5">
        <button onClick={() => onChange(true)}
          className={`flex-1 text-[11px] py-1 rounded border ${value === true ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700" : "border-border"}`}>{yes}</button>
        <button onClick={() => onChange(false)}
          className={`flex-1 text-[11px] py-1 rounded border ${value === false ? "bg-red-500/15 border-red-500/40 text-red-700" : "border-border"}`}>{no}</button>
      </div>
    </div>
  );
}

function buildNotes({ notes, entityConfirmed, translationApproved, transcriptAccurate }: any) {
  const tags: string[] = [];
  if (entityConfirmed === true) tags.push("[entity: match confirmed]");
  if (entityConfirmed === false) tags.push("[entity: wrong entity]");
  if (translationApproved === true) tags.push("[translation: approved]");
  if (translationApproved === false) tags.push("[translation: rejected]");
  if (transcriptAccurate === true) tags.push("[transcript: accurate]");
  if (transcriptAccurate === false) tags.push("[transcript: inaccurate]");
  return [notes?.trim(), tags.join(" ")].filter(Boolean).join("\n").slice(0, 3900);
}

export function ReviewStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    unreviewed: "bg-muted text-muted-foreground",
    confirmed: "bg-emerald-500/15 text-emerald-700",
    false_positive: "bg-red-500/15 text-red-600",
    needs_context: "bg-blue-500/15 text-blue-700",
    escalated: "bg-orange-500/15 text-orange-700",
    legally_reviewed: "bg-purple-500/15 text-purple-700",
    resolved: "bg-emerald-500/20 text-emerald-700",
  };
  return <Badge variant="outline" className={`text-[10px] ${styles[status] ?? styles.unreviewed}`}>{status.replace(/_/g, " ")}</Badge>;
}
