import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { severityColor, type Severity } from "@/lib/data-store";
import { Plus, Loader2, ArrowRightLeft, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  listPromotableFindings,
  promoteFindingsToCases,
} from "@/lib/cases/case-promotion.functions";

export const Route = createFileRoute("/_app/cases")({
  head: () => ({ meta: [{ title: "Case Management — Eterna Sentinel" }] }),
  component: CasesPage,
});

type CaseStatus = "Open" | "In Progress" | "Escalated" | "Closed";
type CaseType = "DMCA" | "Legal" | "Platform" | "Investigation";

interface CaseRow {
  id: string;
  subject: string;
  type: CaseType;
  status: CaseStatus;
  priority: Severity;
  assignee: string | null;
  opened_at: string;
}

const STATUSES: CaseStatus[] = ["Open", "In Progress", "Escalated", "Closed"];
const TYPES: CaseType[] = ["DMCA", "Legal", "Platform", "Investigation"];
const PRIORITIES: Severity[] = ["Critical", "High", "Medium", "Low"];

function CasesPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{
    subject: string;
    type: CaseType;
    priority: Severity;
    assignee: string;
  }>({
    subject: "",
    type: "DMCA",
    priority: "Medium",
    assignee: "",
  });

  const casesQuery = useQuery({
    queryKey: ["cases", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<CaseRow[]> => {
      const { data, error } = await supabase
        .from("cases")
        .select("id,subject,type,status,priority,assignee,opened_at")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CaseRow[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not signed in");
      if (!form.subject.trim()) throw new Error("Subject required");
      const { error } = await supabase.from("cases").insert({
        user_id: userId,
        subject: form.subject.trim(),
        type: form.type,
        priority: form.priority,
        assignee: form.assignee.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Case opened");
      setShowForm(false);
      setForm({ subject: "", type: "DMCA", priority: "Medium", assignee: "" });
      qc.invalidateQueries({ queryKey: ["cases", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CaseStatus }) => {
      const patch = { status, closed_at: status === "Closed" ? new Date().toISOString() : null };
      const { error } = await supabase.from("cases").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cases", userId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const cases = casesQuery.data ?? [];
  const loading = !ready || casesQuery.isLoading;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="OPEN CASES"
          value={cases.filter((c) => c.status !== "Closed").length}
          sub="Active workload"
        />
        <StatCard
          label="ESCALATED"
          value={cases.filter((c) => c.status === "Escalated").length}
          sub="With external counsel"
          accent="oklch(0.63 0.24 25)"
        />
        <StatCard
          label="IN PROGRESS"
          value={cases.filter((c) => c.status === "In Progress").length}
          sub="Being worked on"
          accent="oklch(0.75 0.16 70)"
        />
        <StatCard
          label="CLOSED"
          value={cases.filter((c) => c.status === "Closed").length}
          sub="Resolved"
          accent="oklch(0.68 0.16 155)"
        />
      </div>

      <PromoteDetectionsPanel userId={userId} />

      <PageCard
        title="CASE BOARD"
        sub="Kanban across statuses"
        actions={
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-white"
            style={{ background: "var(--gradient-brand)" }}
          >
            <Plus className="size-3.5" /> New Case
          </button>
        }
      >
        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addMut.mutate();
            }}
            className="mb-4 grid grid-cols-1 md:grid-cols-5 gap-2 border border-border rounded-xl p-3 bg-accent/20"
          >
            <input
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Case subject"
              className="md:col-span-2 text-sm px-3 py-2 rounded-md border border-border bg-card"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as CaseType })}
              className="text-sm px-3 py-2 rounded-md border border-border bg-card"
            >
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as Severity })}
              className="text-sm px-3 py-2 rounded-md border border-border bg-card"
            >
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <input
              value={form.assignee}
              onChange={(e) => setForm({ ...form, assignee: e.target.value })}
              placeholder="Assignee"
              className="text-sm px-3 py-2 rounded-md border border-border bg-card"
            />
            <button
              type="submit"
              disabled={addMut.isPending}
              className="md:col-span-5 text-xs font-semibold px-3 py-2 rounded-md text-white"
              style={{ background: "var(--gradient-brand)" }}
            >
              {addMut.isPending ? "Opening…" : "Open case"}
            </button>
          </form>
        )}

        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading cases…
          </div>
        ) : cases.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No active cases. Open your first case from a finding in the{" "}
            <Link to="/threat-radar" className="text-primary font-semibold">
              Threat Radar
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {STATUSES.map((s) => {
              const bucket = cases.filter((c) => c.status === s);
              return (
                <div key={s}>
                  <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">
                    {s.toUpperCase()} · {bucket.length}
                  </div>
                  <div className="space-y-3">
                    {bucket.map((c) => (
                      <div key={c.id} className="border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-mono text-muted-foreground">
                            #{c.id.slice(0, 8)}
                          </div>
                          <Pill color={severityColor(c.priority)}>{c.priority}</Pill>
                        </div>
                        <div className="text-sm font-semibold mt-1">{c.subject}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {c.type}
                          {c.assignee ? ` · ${c.assignee}` : ""}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Opened {new Date(c.opened_at).toLocaleDateString()}
                        </div>
                        <select
                          value={c.status}
                          onChange={(e) =>
                            statusMut.mutate({ id: c.id, status: e.target.value as CaseStatus })
                          }
                          className="mt-2 w-full text-xs px-2 py-1.5 rounded-md border border-border bg-card"
                        >
                          {STATUSES.map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                    {bucket.length === 0 && (
                      <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-xl">
                        No cases
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageCard>
    </div>
  );
}

/**
 * Detection → Case handoff.
 *
 * Detections were piling up in the thousands while the case board stayed empty,
 * because the only path to a case was typing one by hand. This panel surfaces
 * high-severity detections that have no case yet and promotes them with the
 * evidence link (`case_findings`) attached, so every case is traceable back to
 * what opened it. Promotion records case state only — it never sends anything.
 */
function PromoteDetectionsPanel({ userId }: { userId: string | undefined }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPromotableFindings);
  const promoteFn = useServerFn(promoteFindingsToCases);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["promotable-findings", userId],
    enabled: !!userId,
    queryFn: () => listFn(),
  });

  const promote = useMutation({
    mutationFn: async (hitIds: string[]) => promoteFn({ data: { hitIds } }),
    onSuccess: (res) => {
      toast.success(
        res.created > 0
          ? `Opened ${res.created} case(s) from detections`
          : "No new cases — those detections already have cases",
      );
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["cases", userId] });
      qc.invalidateQueries({ queryKey: ["promotable-findings", userId] });
      qc.invalidateQueries({ queryKey: ["protection-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const findings = q.data ?? [];
  if (q.isLoading || findings.length === 0) return null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visible = findings.slice(0, 12);

  return (
    <PageCard
      title="DETECTIONS AWAITING A CASE"
      sub={`${findings.length} high-severity detection(s) with no case attached`}
      actions={
        <button
          onClick={() =>
            promote.mutate(
              selected.size > 0 ? Array.from(selected) : visible.map((f) => f.id),
            )
          }
          disabled={promote.isPending}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-white disabled:opacity-60"
          style={{ background: "var(--gradient-brand)" }}
        >
          {promote.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowRightLeft className="size-3.5" />
          )}
          {selected.size > 0 ? `Open ${selected.size} case(s)` : "Open cases for these"}
        </button>
      }
    >
      <div className="space-y-1.5">
        {visible.map((f) => {
          const url = f.permalink ?? f.canonical_url;
          return (
            <label
              key={f.id}
              className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-2 hover:bg-accent/30 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(f.id)}
                onChange={() => toggle(f.id)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">
                  {f.title ?? "Untitled detection"}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{f.source ?? "Web"}</span>
                  <span>·</span>
                  <span>Score {f.threat_score ?? "—"}</span>
                  {url && (
                    <>
                      <span>·</span>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-primary"
                      >
                        Source <ExternalLink className="size-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>
              <Pill color={severityColor((f.severity ?? "Medium") as Severity)}>
                {f.severity ?? "Medium"}
              </Pill>
            </label>
          );
        })}
        {findings.length > visible.length && (
          <div className="text-[11px] text-muted-foreground pt-1">
            Showing {visible.length} of {findings.length}. Promote in batches to keep cases
            reviewable.
          </div>
        )}
      </div>
    </PageCard>
  );
}
