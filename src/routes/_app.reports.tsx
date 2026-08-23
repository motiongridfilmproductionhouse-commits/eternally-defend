import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { FileText, Loader2, ShieldAlert } from "lucide-react";
import { listScanReports } from "@/lib/protection/report.functions";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({
    meta: [
      { title: "Scan Reports — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Every continuous protection scan, what it discovered, and whether each discovery is removal eligible.",
      },
      { property: "og:title", content: "Scan Reports — Eterna Sentinel" },
      {
        property: "og:description",
        content: "Persistent scan history with discovery evidence and removal eligibility.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

const statusColor: Record<string, string> = {
  Generating: "oklch(0.65 0.18 240)",
  Ready: "oklch(0.68 0.16 155)",
  Failed: "oklch(0.63 0.24 25)",
};

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function ReportsPage() {
  const fetchReports = useServerFn(listScanReports);
  const reportsQuery = useQuery({
    queryKey: ["scan_reports"],
    queryFn: () => fetchReports(),
  });

  const reports = reportsQuery.data?.reports ?? [];
  const stats = {
    total: reports.length,
    discovered: reports.reduce((a, r) => a + (r.discovered_count ?? 0), 0),
    eligible: reports.reduce((a, r) => a + (r.eligible_count ?? 0), 0),
    review: reports.reduce((a, r) => a + (r.review_count ?? 0), 0),
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="SCAN REPORTS" value={stats.total} sub="Persistent history" />
        <StatCard
          label="DISCOVERIES"
          value={stats.discovered}
          sub="Across all reports"
          accent="oklch(0.65 0.18 240)"
        />
        <StatCard
          label="REMOVAL ELIGIBLE"
          value={stats.eligible}
          sub="Eligibility only — nothing sent"
          accent="oklch(0.68 0.16 155)"
        />
        <StatCard
          label="REQUIRES REVIEW"
          value={stats.review}
          sub="Awaiting operator decision"
          accent="oklch(0.75 0.16 70)"
        />
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-xl p-3">
        <ShieldAlert className="size-4 mt-0.5 text-primary shrink-0" />
        <span>
          Discovery is separate from enforcement. These reports record what was found and whether it
          would qualify for a removal request — no notice, report, or takedown is ever sent from this
          screen.
        </span>
      </div>

      <PageCard title="SCAN REPORT HISTORY" sub="One report per completed module scan">
        {reportsQuery.isLoading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading scan reports…
          </div>
        ) : reportsQuery.isError ? (
          <div className="py-10 text-center text-sm text-danger">
            Could not load scan reports. Please retry.
          </div>
        ) : reports.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No scan reports yet. Reports appear automatically after each continuous protection sweep,
            or{" "}
            <Link to="/scan" className="text-primary font-semibold">
              run a scan
            </Link>{" "}
            now.
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <Link
                key={r.id}
                to="/reports/$reportId"
                params={{ reportId: r.id }}
                className="flex items-center gap-3 border border-border rounded-xl p-3 hover:border-primary/50 transition-colors"
              >
                <div className="size-10 rounded-xl grid place-items-center bg-primary/10 text-primary">
                  <FileText className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Started {fmt(r.run_started_at)} · Completed {fmt(r.run_completed_at)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.discovered_count ?? 0} discovered · {r.eligible_count ?? 0} eligible ·{" "}
                    {r.review_count ?? 0} review · {r.not_eligible_count ?? 0} not eligible
                  </div>
                </div>
                <Pill color={statusColor[r.status] ?? "oklch(0.55 0.03 275)"}>{r.status}</Pill>
              </Link>
            ))}
          </div>
        )}
      </PageCard>
    </div>
  );
}
