import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageCard, Pill, StatCard } from "@/components/dashboard/PageCard";
import { ArrowLeft, ExternalLink, Gavel, Loader2, ShieldAlert } from "lucide-react";
import { getScanReport } from "@/lib/protection/report.functions";
import { ELIGIBILITY_LABEL, type ReportEligibility, type EnforcementState } from "@/lib/protection/report/types";
import { ENFORCEMENT_STATE_LABEL } from "@/lib/protection/report/enforcement-state";


export const Route = createFileRoute("/_app/reports/$reportId")({
  head: () => ({
    meta: [
      { title: "Scan Report Detail — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Every discovery from this protection scan with evidence, confidence, and removal eligibility.",
      },
      { property: "og:title", content: "Scan Report Detail — Eterna Sentinel" },
      {
        property: "og:description",
        content: "Discovery evidence and removal eligibility for a single protection scan.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScanReportDetail,
});

const ELIGIBILITY_COLOR: Record<ReportEligibility, string> = {
  REMOVAL_ELIGIBLE: "oklch(0.68 0.16 155)",
  REQUIRES_REVIEW: "oklch(0.75 0.16 70)",
  NOT_REMOVAL_ELIGIBLE: "oklch(0.55 0.03 275)",
};

type Filter = "ALL" | ReportEligibility;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "REMOVAL_ELIGIBLE", label: "Eligible" },
  { key: "REQUIRES_REVIEW", label: "Requires review" },
  { key: "NOT_REMOVAL_ELIGIBLE", label: "Not eligible" },
];

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function ScanReportDetail() {
  const { reportId } = Route.useParams();
  const fetchReport = useServerFn(getScanReport);
  const [filter, setFilter] = useState<Filter>("ALL");

  const query = useQuery({
    queryKey: ["scan_report", reportId],
    queryFn: () => fetchReport({ data: { reportId } }),
  });

  const report = query.data?.report;
  const payload = report?.payload ?? null;
  const discoveries = payload?.discoveries ?? [];
  const visible = filter === "ALL" ? discoveries : discoveries.filter((d) => d.eligibility === filter);

  return (
    <div className="space-y-5">
      <Link
        to="/reports"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to scan reports
      </Link>

      {query.isLoading ? (
        <div className="py-16 flex items-center justify-center text-muted-foreground text-sm gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading report…
        </div>
      ) : query.isError || !report ? (
        <div className="py-16 text-center text-sm text-danger">Report not found.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="DISCOVERED" value={report.discovered_count ?? 0} sub="This scan" />
            <StatCard
              label="REMOVAL ELIGIBLE"
              value={report.eligible_count ?? 0}
              sub="Nothing sent automatically"
              accent="oklch(0.68 0.16 155)"
            />
            <StatCard
              label="REQUIRES REVIEW"
              value={report.review_count ?? 0}
              sub="Operator decision needed"
              accent="oklch(0.75 0.16 70)"
            />
            <StatCard
              label="NOT ELIGIBLE"
              value={report.not_eligible_count ?? 0}
              sub="Evidence only"
            />
          </div>

          <PageCard title={report.name.toUpperCase()} sub={payload?.moduleLabel ?? "Scan report"}>
            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Status</div>
                <div className="font-semibold">{payload?.runStatus ?? report.status}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Started</div>
                <div className="font-semibold">{fmt(report.run_started_at)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Completed</div>
                <div className="font-semibold">{fmt(report.run_completed_at)}</div>
              </div>
            </div>
          </PageCard>

          <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-xl p-3">
            <ShieldAlert className="size-4 mt-0.5 text-primary shrink-0" />
            <span>
              Eligibility is an assessment only. Removal requests are never generated or sent from
              this report — enforcement stays behind its own review and pre-send gates.
            </span>
          </div>

          <PageCard title="DISCOVERIES" sub="Source, evidence, confidence and eligibility">
            <div className="flex flex-wrap gap-2 mb-3">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                    filter === f.key
                      ? "border-primary text-primary bg-primary/10"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {f.label}
                  {f.key !== "ALL" && (
                    <span className="ml-1 opacity-70">
                      {discoveries.filter((d) => d.eligibility === f.key).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {discoveries.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                This scan completed with 0 discoveries.
              </div>
            ) : visible.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No discoveries in this category.
              </div>
            ) : (
              <div className="space-y-3">
                {visible.map((d) => (
                  <div key={d.id} className="border border-border rounded-xl p-3 space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold break-words">{d.title}</div>
                        {d.sourceUrl && (
                          <a
                            href={d.sourceUrl}
                            target="_blank"
                            rel="noreferrer nofollow"
                            className="text-xs text-primary inline-flex items-center gap-1 break-all"
                          >
                            {d.sourceUrl} <ExternalLink className="size-3 shrink-0" />
                          </a>
                        )}
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Discovered {fmt(d.discoveredAt)} · {d.confidenceLabel}
                          {d.confidence !== null ? ` · ${d.confidence}/100` : ""} · status {d.status}
                        </div>
                      </div>
                      <Pill color={ELIGIBILITY_COLOR[d.eligibility]}>
                        {ELIGIBILITY_LABEL[d.eligibility]}
                      </Pill>
                    </div>

                    {d.evidence.length > 0 && (
                      <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
                        {d.evidence.map((e, i) => (
                          <li key={i} className="break-words">
                            {e}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="text-[11px] rounded-lg bg-muted/40 p-2 space-y-0.5">
                      {d.eligibilityReasons.map((r, i) => (
                        <div key={i}>{r}</div>
                      ))}
                    </div>

                    {d.enforcement && d.eligibility === "REMOVAL_ELIGIBLE" && (
                      <div className="text-[11px] rounded-lg border border-border p-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <Gavel className="size-3.5 text-primary" />
                          <span className="font-semibold uppercase tracking-wide">Enforcement</span>
                          <Pill color={ENFORCEMENT_COLOR[d.enforcement.state]}>
                            {ENFORCEMENT_STATE_LABEL[d.enforcement.state]}
                          </Pill>
                        </div>
                        <div className="text-muted-foreground">{d.enforcement.detail}</div>
                        <div className="text-muted-foreground">
                          {d.enforcement.basis ? `Basis: ${d.enforcement.basis} · ` : ""}
                          {d.enforcement.route ? `Route: ${d.enforcement.route} · ` : ""}
                          {d.enforcement.queuedAt
                            ? `Started ${fmt(d.enforcement.queuedAt)}`
                            : "Not started"}
                        </div>
                        {d.enforcement.testMode && (
                          <div className="text-warning">
                            Test mode: live sending is disabled, so nothing leaves the platform.
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                ))}
              </div>
            )}
          </PageCard>
        </>
      )}
    </div>
  );
}
