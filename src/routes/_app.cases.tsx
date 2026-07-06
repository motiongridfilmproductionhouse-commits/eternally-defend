import { createFileRoute } from "@tanstack/react-router";
import { useData, severityColor, type Case } from "@/lib/data-store";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";

export const Route = createFileRoute("/_app/cases")({
  head: () => ({ meta: [{ title: "Case Management — Eterna AI" }] }),
  component: CasesPage,
});

const statuses: Case["status"][] = ["Open", "In Progress", "Escalated", "Closed"];

function CasesPage() {
  const { cases, updateCaseStatus } = useData();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="OPEN CASES" value={cases.filter(c=>c.status!=="Closed").length} sub="Active workload" />
        <StatCard label="ESCALATED" value={cases.filter(c=>c.status==="Escalated").length} sub="With external counsel" accent="oklch(0.63 0.24 25)" />
        <StatCard label="IN PROGRESS" value={cases.filter(c=>c.status==="In Progress").length} sub="Being worked on" accent="oklch(0.75 0.16 70)" />
        <StatCard label="CLOSED" value={cases.filter(c=>c.status==="Closed").length} sub="Resolved" accent="oklch(0.68 0.16 155)" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {statuses.map((s) => (
          <PageCard key={s} title={s.toUpperCase()} sub={`${cases.filter(c=>c.status===s).length} cases`}>
            <div className="space-y-3">
              {cases.filter(c=>c.status===s).map((c) => (
                <div key={c.id} className="border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-mono text-muted-foreground">{c.id}</div>
                    <Pill color={severityColor(c.priority)}>{c.priority}</Pill>
                  </div>
                  <div className="text-sm font-semibold mt-1">{c.subject}</div>
                  <div className="text-xs text-muted-foreground mt-1">{c.type} · {c.assignee}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Opened {c.opened}</div>
                  <select value={c.status} onChange={(e)=>updateCaseStatus(c.id, e.target.value as Case["status"])} className="mt-2 w-full text-xs px-2 py-1.5 rounded-md border border-border bg-card">
                    {statuses.map(x=><option key={x}>{x}</option>)}
                  </select>
                </div>
              ))}
              {cases.filter(c=>c.status===s).length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">No cases</div>
              )}
            </div>
          </PageCard>
        ))}
      </div>
    </div>
  );
}
