import { useMemo } from "react";
import { Clock } from "lucide-react";
import {
  cleanActivityLabel,
  filterDisplayableActivity,
  type ScanActivityEvent,
} from "@/lib/copyright/scan-activity";

export type TimelineEntry = { time: string; label: string; tone?: "info" | "warn" | "hot" };

export type InvestigationTimelineProps = {
  events: ScanActivityEvent[];
  scanStartedAt?: string | null;
  extra?: TimelineEntry[];
  title?: string;
};

function clock(iso: string | null | undefined): string {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString([], { hour12: false });
}

/** Forensic timeline of an investigation, newest last. */
export function InvestigationTimeline({
  events,
  scanStartedAt,
  extra = [],
  title = "Investigation timeline",
}: InvestigationTimelineProps) {
  const entries = useMemo<TimelineEntry[]>(() => {
    const rows: TimelineEntry[] = [];
    if (scanStartedAt) {
      rows.push({ time: clock(scanStartedAt), label: "Scan Started" });
      rows.push({ time: clock(scanStartedAt), label: "Google Discovery" });
      rows.push({ time: clock(scanStartedAt), label: "Firecrawl Discovery" });
      rows.push({ time: clock(scanStartedAt), label: "Search Expansion" });
      rows.push({ time: clock(scanStartedAt), label: "Candidate Verification" });
    }
    // Only verified illegal distribution events are surfaced; retrieval noise and
    // searched-only platforms stay in the internal log.
    const verified = filterDisplayableActivity(events);
    if (verified.length === 0) {
      rows.push({
        time: clock(scanStartedAt),
        label: "Searching verified piracy websites…",
      });
    }
    for (const e of [...verified].reverse().slice(-14)) {
      rows.push({
        time: clock(e.occurred_at),
        label: `Threat Classification — ${e.hostname}`,
        tone: "hot",
      });
      rows.push({
        time: clock(e.occurred_at),
        label: `Evidence Generated — ${cleanActivityLabel(e)}`,
        tone: "warn",
      });
    }
    if (verified.length) {
      rows.push({
        time: clock(verified[0]?.occurred_at ?? scanStartedAt),
        label: "Risk Scoring",
        tone: "info",
      });
    }
    return [...rows, ...extra];
  }, [events, scanStartedAt, extra]);

  return (
    <section className="cyber-panel rounded-2xl p-5">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-sky-400/40 bg-sky-500/10">
          <Clock className="h-4 w-4 text-sky-300" />
        </div>
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      </header>

      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No forensic events recorded yet.</p>
      ) : (
        <ol className="mt-4 space-y-0 border-l border-sky-400/20 pl-4 font-mono text-[11px]">
          {entries.map((entry, i) => (
            <li key={`${entry.time}-${i}`} className="relative py-1.5">
              <span
                className={`absolute -left-[21px] top-2.5 h-2 w-2 rounded-full ${
                  entry.tone === "hot"
                    ? "bg-red-400 cyber-blip-hot"
                    : entry.tone === "warn"
                      ? "bg-amber-400"
                      : "bg-sky-400/70"
                }`}
                aria-hidden
              />
              <span className="text-sky-300/70">{entry.time}</span>{" "}
              <span
                className={
                  entry.tone === "hot"
                    ? "text-red-300"
                    : entry.tone === "warn"
                      ? "text-amber-200"
                      : "text-slate-300"
                }
              >
                {entry.label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default InvestigationTimeline;
