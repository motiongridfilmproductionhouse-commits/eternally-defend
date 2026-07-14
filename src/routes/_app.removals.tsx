import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_app/removals")({
  head: () => ({ meta: [{ title: "Removal Center — Eterna AI" }] }),
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
}

const statusColor: Record<string, string> = {
  Queued: "oklch(0.75 0.16 70)",
  Sent: "oklch(0.65 0.18 240)",
  Approved: "oklch(0.68 0.16 155)",
  Rejected: "oklch(0.63 0.24 25)",
  Withdrawn: "oklch(0.55 0.03 275)",
};

function RemovalsPage() {
  const { session, ready } = useSession();
  const userId = session?.user.id;

  const q = useQuery({
    queryKey: ["removals", userId],
    enabled: ready && !!userId,
    queryFn: async (): Promise<RemovalRow[]> => {
      const { data, error } = await supabase
        .from("enforcement_requests")
        .select("id,target_url,platform,method,status,submitted_at,responded_at,created_at")
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="TOTAL SUBMITTED" value={rows.length} sub="All removal requests" />
        <StatCard label="APPROVED" value={rows.filter((r) => r.status === "Approved").length} sub="Successfully taken down" accent="oklch(0.68 0.16 155)" />
        <StatCard label="IN FLIGHT" value={rows.filter((r) => r.status === "Sent" || r.status === "Queued").length} sub="Awaiting platform" accent="oklch(0.65 0.18 240)" />
        <StatCard label="REJECTED" value={rows.filter((r) => r.status === "Rejected").length} sub="Escalate to legal" accent="oklch(0.63 0.24 25)" />
      </div>

      <PageCard title="REMOVAL REQUESTS" sub="Live queue and history">
        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No removal requests yet. Queue one from <Link to="/enforcement" className="text-primary font-semibold">Enforcement</Link>.
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
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{r.id.slice(0, 8)}</td>
                    <td className="py-3 pr-4 font-medium truncate max-w-[280px]">
                      {r.target_url ? <a className="text-primary" href={r.target_url} target="_blank" rel="noreferrer">{r.target_url}</a> : "—"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{r.platform}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{r.method}</td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="py-3 pr-4"><Pill color={statusColor[r.status] ?? "oklch(0.55 0.03 275)"}>{r.status}</Pill></td>
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
