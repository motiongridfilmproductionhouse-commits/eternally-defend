import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { FileText, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({ meta: [{ title: "Reports — Eterna AI" }] }),
  component: ReportsPage,
});

interface ReportRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  pdf_url: string | null;
  findings_count: number;
  created_at: string;
}

const KINDS = [
  "Executive Summary",
  "Monthly Protection Summary",
  "Legal Enforcement Log",
  "Deepfake Intelligence Digest",
];

const statusColor: Record<string, string> = {
  Draft: "oklch(0.75 0.16 70)",
  Generating: "oklch(0.65 0.18 240)",
  Ready: "oklch(0.68 0.16 155)",
  Failed: "oklch(0.63 0.24 25)",
};

function ReportsPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>(KINDS[0]);

  const reportsQuery = useQuery({
    queryKey: ["generated_reports", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<ReportRow[]> => {
      const { data, error } = await supabase
        .from("generated_reports")
        .select("id,name,kind,status,pdf_url,findings_count,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReportRow[];
    },
  });

  const findingsCountQuery = useQuery({
    queryKey: ["scan_hits_count", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase.from("scan_hits").select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not signed in");
      if (!name.trim()) throw new Error("Report name required");
      const findings = findingsCountQuery.data ?? 0;
      const { error } = await supabase.from("generated_reports").insert({
        user_id: userId,
        name: name.trim(),
        kind,
        status: findings > 0 ? "Draft" : "Draft",
        findings_count: findings,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Report queued");
      setName("");
      qc.invalidateQueries({ queryKey: ["generated_reports", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reports = reportsQuery.data ?? [];
  const loading = !ready || reportsQuery.isLoading;

  const stats = {
    total: reports.length,
    ready: reports.filter((r) => r.status === "Ready").length,
    evidence: reports.reduce((a, r) => a + (r.findings_count ?? 0), 0),
    drafts: reports.filter((r) => r.status === "Draft").length,
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="REPORTS GENERATED" value={stats.total} sub={stats.total === 0 ? "No reports yet" : "All time"} />
        <StatCard label="READY TO DOWNLOAD" value={stats.ready} sub="PDFs available" accent="oklch(0.68 0.16 155)" />
        <StatCard label="EVIDENCE ITEMS" value={stats.evidence} sub="Findings across reports" accent="oklch(0.65 0.18 240)" />
        <StatCard label="DRAFTS" value={stats.drafts} sub="Awaiting generation" accent="oklch(0.75 0.16 70)" />
      </div>

      <PageCard title="NEW REPORT" sub="Snapshot the current findings">
        <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="flex flex-col md:flex-row gap-2">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name (e.g. Q3 Executive Brief)" className="flex-1 text-sm px-3 py-2 rounded-md border border-border bg-card" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="text-sm px-3 py-2 rounded-md border border-border bg-card">
            {KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <button type="submit" disabled={createMut.isPending} className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-md text-white" style={{ background: "var(--gradient-brand)" }}>
            <Plus className="size-3.5" /> {createMut.isPending ? "Creating…" : "Create report"}
          </button>
        </form>
        <div className="text-xs text-muted-foreground mt-2">
          Current findings available: <span className="font-semibold">{findingsCountQuery.data ?? 0}</span>
        </div>
      </PageCard>

      <PageCard title="REPORT HISTORY" sub="All generated reports">
        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading reports…
          </div>
        ) : reports.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No reports generated yet. Create your first report above, or <Link to="/scan" className="text-primary font-semibold">run a scan</Link> to build up findings first.
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="flex items-center gap-3 border border-border rounded-xl p-3">
                <div className="size-10 rounded-xl grid place-items-center bg-primary/10 text-primary"><FileText className="size-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.kind} · {r.findings_count} findings · {new Date(r.created_at).toLocaleDateString()}</div>
                </div>
                <Pill color={statusColor[r.status] ?? "oklch(0.55 0.03 275)"}>{r.status}</Pill>
                {r.pdf_url && (
                  <a href={r.pdf_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary underline">Download</a>
                )}
              </div>
            ))}
          </div>
        )}
      </PageCard>
    </div>
  );
}
