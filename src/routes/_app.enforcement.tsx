import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { Send, FileText, Scale, ShieldAlert, Loader2, Download } from "lucide-react";
import { useAuthorization } from "@/hooks/use-authorization";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateEnforcementPackages, signPackageUrl } from "@/lib/enforcement-packages.functions";

export const Route = createFileRoute("/_app/enforcement")({
  head: () => ({ meta: [{ title: "Enforcement — Eterna AI" }] }),
  component: EnforcementPage,
});

type Method = "DMCA" | "Platform Report" | "Legal Notice";

interface HitRow {
  id: string;
  title: string | null;
  permalink: string | null;
  canonical_url: string | null;
  source: string;
  source_type: string | null;
  risk_type: string | null;
  severity: string | null;
  threat_score: number | null;
}

interface EnforcementRow {
  id: string;
  scan_hit_id: string | null;
  platform: string;
  method: string;
  status: string;
  target_url: string | null;
  submitted_at: string | null;
  responded_at: string | null;
  created_at: string;
  evidence_pdf_path: string | null;
  authorization_pdf_path: string | null;
  platform_complaint_pdf_path: string | null;
  package_generated_at: string | null;
}

const ACTIONS: { method: Method; icon: typeof Send; title: string; tone: string }[] = [
  { method: "DMCA", icon: Send, title: "Send DMCA takedown", tone: "oklch(0.55 0.22 295)" },
  { method: "Platform Report", icon: FileText, title: "File platform report", tone: "oklch(0.65 0.18 240)" },
  { method: "Legal Notice", icon: Scale, title: "Escalate to legal", tone: "oklch(0.63 0.24 25)" },
];

function EnforcementPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const authz = useAuthorization();
  const generateFn = useServerFn(generateEnforcementPackages);
  const signFn = useServerFn(signPackageUrl);

  const [selected, setSelected] = useState<string[]>([]);

  const hitsQuery = useQuery({
    queryKey: ["enforcement_eligible_hits", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<HitRow[]> => {
      const { data, error } = await supabase
        .from("scan_hits")
        .select("id,title,permalink,canonical_url,source,source_type,risk_type,severity,threat_score")
        .order("threat_score", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as HitRow[];
    },
  });

  const requestsQuery = useQuery({
    queryKey: ["enforcement_requests", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<EnforcementRow[]> => {
      const { data, error } = await supabase
        .from("enforcement_requests")
        .select("id,scan_hit_id,platform,method,status,target_url,submitted_at,responded_at,created_at,evidence_pdf_path,authorization_pdf_path,platform_complaint_pdf_path,package_generated_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as EnforcementRow[];
    },
  });

  const requests = requestsQuery.data ?? [];
  const hits = hitsQuery.data ?? [];

  const metrics = useMemo(() => {
    const submitted = requests.filter((r) => r.status !== "Queued").length;
    const approved = requests.filter((r) => r.status === "Approved").length;
    const legal = requests.filter((r) => r.method === "Legal Notice").length;
    const withPackages = requests.filter((r) => r.package_generated_at).length;
    return {
      total: requests.length,
      submitted,
      successRate: submitted ? Math.round((approved / submitted) * 100) : null,
      packaged: withPackages,
      legal,
    };
  }, [requests]);

  const enforceMut = useMutation({
    mutationFn: async (method: Method) => {
      if (!userId) throw new Error("Not signed in");
      if (selected.length === 0) return { results: [] };
      toast.info(`Building ${selected.length * 3} package(s)…`);
      return await generateFn({ data: { scanHitIds: selected, method, dryRun: false } });
    },
    onSuccess: (res, method) => {
      const ok = res.results.filter((r) => !r.error).length;
      const failed = res.results.length - ok;
      toast.success(`${ok} ${method} package(s) built${failed ? ` · ${failed} failed` : ""}`);
      setSelected([]);
      qc.invalidateQueries({ queryKey: ["enforcement_requests", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openPackage = async (path: string | null) => {
    if (!path) return;
    try {
      const { url } = await signFn({ data: { path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open package");
    }
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const canEnforce = authz.canRequestEnforcement && selected.length > 0 && !enforceMut.isPending;
  const loading = !ready || hitsQuery.isLoading || requestsQuery.isLoading;

  return (
    <div className="space-y-5">
      {!authz.canRequestEnforcement && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-3">
          <ShieldAlert className="size-5 text-amber-700" />
          <div className="flex-1 text-sm text-amber-900">
            Enforcement actions are disabled. Your current authorization level does not include enforcement requests.
          </div>
          <Button asChild size="sm" variant="outline"><Link to="/onboarding">Update authorization</Link></Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="REQUESTS SUBMITTED" value={metrics.submitted} sub={metrics.total === 0 ? "No requests yet" : "All time"} accent="oklch(0.65 0.18 240)" />
        <StatCard label="SUCCESS RATE" value={metrics.successRate === null ? "—" : `${metrics.successRate}%`} sub="Approved / submitted" accent="oklch(0.68 0.16 155)" />
        <StatCard label="PACKAGES GENERATED" value={metrics.packaged} sub="Evidence + auth + complaint" accent="oklch(0.55 0.22 295)" />
        <StatCard label="LEGAL ESCALATIONS" value={metrics.legal} sub="All time" accent="oklch(0.63 0.24 25)" />
      </div>

      <PageCard title="QUICK ACTIONS" sub="Generates Evidence, Authorization, and Platform Complaint packages for each selected finding">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.method}
                onClick={() => canEnforce && enforceMut.mutate(a.method)}
                disabled={!canEnforce}
                className="border border-border rounded-xl p-4 text-left hover:bg-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="size-10 rounded-xl grid place-items-center mb-3" style={{ background: `color-mix(in oklab, ${a.tone} 14%, white)`, color: a.tone }}>
                  {enforceMut.isPending ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
                </div>
                <div className="font-semibold text-sm">{a.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{selected.length} selected · 3 PDFs / finding</div>
              </button>
            );
          })}
        </div>
      </PageCard>

      <PageCard title="ELIGIBLE THREATS" sub="Select findings to enforce against">
        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading findings…
          </div>
        ) : hits.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No findings available. <Link to="/scan" className="text-primary font-semibold">Run a scan</Link> to detect threats you can enforce against.
          </div>
        ) : (
          <div className="space-y-2">
            {hits.map((h) => (
              <label key={h.id} className="flex items-center gap-3 p-3 border border-border rounded-xl cursor-pointer hover:bg-accent/30">
                <input type="checkbox" checked={selected.includes(h.id)} onChange={() => toggle(h.id)} className="size-4 accent-primary" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{h.title || h.permalink || "Untitled finding"}</div>
                  <div className="text-xs text-muted-foreground">{h.source_type || h.source} · {h.risk_type ?? "Uncategorised"} · Score {h.threat_score ?? "—"}</div>
                </div>
                <span className="text-xs text-muted-foreground">{h.severity ?? "—"}</span>
              </label>
            ))}
          </div>
        )}
      </PageCard>

      <PageCard title="ENFORCEMENT HISTORY" sub={`${requests.length} request(s) tracked`}>
        {requestsQuery.isLoading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : requests.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No enforcement actions available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2.5 pr-4 font-medium">Platform</th>
                  <th className="py-2.5 pr-4 font-medium">Method</th>
                  <th className="py-2.5 pr-4 font-medium">Target</th>
                  <th className="py-2.5 pr-4 font-medium">Status</th>
                  <th className="py-2.5 pr-4 font-medium">Packages</th>
                  <th className="py-2.5 pr-4 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-accent/30">
                    <td className="py-3 pr-4">{r.platform}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{r.method}</td>
                    <td className="py-3 pr-4 truncate max-w-[240px]">
                      {r.target_url ? <a href={r.target_url} target="_blank" rel="noreferrer" className="text-primary underline text-xs">{r.target_url}</a> : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="py-3 pr-4"><Pill color={statusColor(r.status)}>{r.status}</Pill></td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <PackageBtn label="Evidence" path={r.evidence_pdf_path} onOpen={openPackage} />
                        <PackageBtn label="Authorization" path={r.authorization_pdf_path} onOpen={openPackage} />
                        <PackageBtn label="Complaint" path={r.platform_complaint_pdf_path} onOpen={openPackage} />
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">{new Date(r.created_at).toLocaleString()}</td>
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

function PackageBtn({ label, path, onOpen }: { label: string; path: string | null; onOpen: (p: string | null) => void }) {
  if (!path) return <span className="text-[10px] text-muted-foreground/60">{label}: —</span>;
  return (
    <button
      onClick={() => onOpen(path)}
      className="text-[10px] px-2 py-1 rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
    >
      <Download className="size-3" /> {label}
    </button>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case "Approved": return "oklch(0.68 0.16 155)";
    case "Sent": return "oklch(0.65 0.18 240)";
    case "Queued": return "oklch(0.75 0.16 70)";
    case "Rejected": return "oklch(0.63 0.24 25)";
    default: return "oklch(0.55 0.03 275)";
  }
}
