import { createFileRoute } from "@tanstack/react-router";
import { useData } from "@/lib/data-store";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";

export const Route = createFileRoute("/_app/removals")({
  head: () => ({ meta: [{ title: "Removal Center — Eterna AI" }] }),
  component: RemovalsPage,
});

const statusColor: Record<string, string> = {
  Queued: "oklch(0.75 0.16 70)",
  Sent: "oklch(0.65 0.18 240)",
  Removed: "oklch(0.68 0.16 155)",
  Rejected: "oklch(0.63 0.24 25)",
};

function RemovalsPage() {
  const { removals } = useData();
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="TOTAL SUBMITTED" value={removals.length} sub="Recent removal requests" />
        <StatCard label="REMOVED" value={removals.filter(r=>r.status==="Removed").length} sub="Successfully taken down" accent="oklch(0.68 0.16 155)" />
        <StatCard label="IN FLIGHT" value={removals.filter(r=>r.status==="Sent" || r.status==="Queued").length} sub="Awaiting platform" accent="oklch(0.65 0.18 240)" />
        <StatCard label="REJECTED" value={removals.filter(r=>r.status==="Rejected").length} sub="Escalate to legal" accent="oklch(0.63 0.24 25)" />
      </div>

      <PageCard title="REMOVAL REQUESTS" sub="Live queue and history">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2.5 pr-4 font-medium">ID</th>
                <th className="py-2.5 pr-4 font-medium">URL</th>
                <th className="py-2.5 pr-4 font-medium">Platform</th>
                <th className="py-2.5 pr-4 font-medium">Method</th>
                <th className="py-2.5 pr-4 font-medium">Submitted</th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {removals.map((r) => (
                <tr key={r.id} className="border-b border-border/60 hover:bg-accent/30">
                  <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{r.id}</td>
                  <td className="py-3 pr-4 font-medium text-primary truncate max-w-[280px]">{r.url}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{r.platform}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{r.method}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{r.submitted}</td>
                  <td className="py-3 pr-4"><Pill color={statusColor[r.status]}>{r.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageCard>
    </div>
  );
}
