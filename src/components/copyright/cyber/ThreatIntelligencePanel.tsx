import { AlertTriangle, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import {
  CATEGORY_LABELS,
  SEVERITY_META,
  type ThreatCategoryKey,
  type ThreatResultRow,
  summarizeThreatIntelligence,
} from "@/lib/copyright/threat-results";

const DISTRIBUTION_KEYS: ThreatCategoryKey[] = [
  "streaming",
  "download",
  "cloud_storage",
  "archive",
  "video_reupload",
  "torrent",
  "telegram",
  "mirror",
  "document",
];

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function ThreatIntelligencePanel({ rows }: { rows: ThreatResultRow[] }) {
  const summary = summarizeThreatIntelligence(rows);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-sky-300" />
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Threat Intelligence
        </h4>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Detected Threats", value: summary.detected, icon: AlertTriangle },
          { label: "Critical", value: summary.critical, tone: "text-red-300" },
          { label: "High", value: summary.high, tone: "text-orange-300" },
          { label: "Medium", value: summary.medium, tone: "text-amber-200" },
          { label: "Low", value: summary.low, tone: "text-sky-200" },
          {
            label: "Verified",
            value: summary.verified,
            icon: CheckCircle2,
            tone: "text-emerald-300",
          },
          { label: "Pending Review", value: summary.pendingReview, icon: Clock3 },
          { label: "False Positive", value: summary.falsePositive },
        ].map((item) => (
          <div key={item.label} className="cyber-panel rounded-xl px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">{item.label}</div>
            <div
              className={`mt-1 text-xl font-semibold tabular-nums ${item.tone ?? "text-slate-100"}`}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="cyber-panel rounded-2xl p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Threat Distribution
          </div>
          <ul className="space-y-1.5">
            {DISTRIBUTION_KEYS.map((key) => {
              const count = summary.distribution[key] ?? 0;
              if (!count) return null;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 text-xs text-slate-200"
                >
                  <span>{CATEGORY_LABELS[key]}</span>
                  <span className="tabular-nums text-slate-400">{count}</span>
                </li>
              );
            })}
            {!DISTRIBUTION_KEYS.some((key) => (summary.distribution[key] ?? 0) > 0) && (
              <li className="text-xs text-slate-500">No verified distribution clusters yet.</li>
            )}
          </ul>
        </div>

        <div className="cyber-panel rounded-2xl p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Latest Findings
          </div>
          <ul className="space-y-2">
            {summary.latest.slice(0, 8).map((row) => (
              <li
                key={row.id}
                className="flex items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] tabular-nums text-slate-500">
                      {formatTime(row.lastVerifiedAt)}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${SEVERITY_META[row.severity].badge}`}
                    >
                      {SEVERITY_META[row.severity].label}
                    </span>
                    <span className="text-[10px] text-slate-400">{row.categoryLabel}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs font-medium text-slate-100">
                    {row.domain}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-emerald-300/90">
                  {row.verified ? "Verified" : "Review"}
                </span>
              </li>
            ))}
            {!summary.latest.length && (
              <li className="text-xs text-slate-500">Findings will appear here as they verify.</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default ThreatIntelligencePanel;
