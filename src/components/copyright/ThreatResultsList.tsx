import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  Globe,
  Layers,
  Search,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicSuspiciousSource } from "@/lib/copyright/suspicious-sources";
import {
  buildThreatResultRows,
  countThreatStatuses,
  faviconUrlFor,
  filterThreatRows,
  groupThreatRowsBySeverity,
  SEVERITY_META,
  THREAT_FILTERS,
  type InspectedSourceInput,
  type ThreatFilterKey,
  type ThreatResultRow,
} from "@/lib/copyright/threat-results";
import { DomainIntelCard } from "@/components/copyright/cyber/DomainIntelCard";

const PAGE_SIZE = 40;

const STATUS_STYLE: Record<ThreatResultRow["status"], string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  offline: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  removed: "border-violet-500/40 bg-violet-500/10 text-violet-300",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-slate-800">
        <Globe className="h-3 w-3 text-slate-400" />
      </span>
    );
  }
  return (
    <img
      src={faviconUrlFor(domain)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      width={20}
      height={20}
      onError={() => setFailed(true)}
      className="h-5 w-5 shrink-0 rounded bg-slate-800 object-contain"
    />
  );
}

function ExpandedDetail({
  row,
  workTitle,
  onReview,
  onDismiss,
}: {
  row: ThreatResultRow;
  workTitle: string;
  onReview?: (matchId: string) => void;
  onDismiss?: (matchId: string) => void;
}) {
  return (
    <div className="space-y-3 border-t border-border/50 bg-background/40 px-3 py-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-2">
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 break-all text-xs text-primary hover:underline"
          >
            {row.url}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          {row.title && <p className="text-xs text-muted-foreground">{row.title}</p>}
          {row.evidenceSummary && (
            <p className="text-xs">
              <span className="font-medium">Why this matched:</span> {row.evidenceSummary}
            </p>
          )}
          {row.reason && <p className="text-xs text-muted-foreground">{row.reason}</p>}
          {row.pageExcerpt && (
            <p className="rounded-md border border-border/50 bg-background/60 p-2 text-[11px] italic text-muted-foreground">
              “{row.pageExcerpt}”
            </p>
          )}
          {row.discoveryQuery && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Search phrase:</span> {row.discoveryQuery}
            </p>
          )}
          {row.additionalUrls.length > 0 && (
            <details className="rounded-md border border-border/50 bg-background/50 p-2">
              <summary className="cursor-pointer text-[11px] font-medium">
                {row.additionalUrls.length} more page
                {row.additionalUrls.length === 1 ? "" : "s"} on this domain
              </summary>
              <ul className="mt-2 space-y-1">
                {row.additionalUrls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-[11px] text-primary hover:underline"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {row.screenshotUrl && (
          <img
            src={row.screenshotUrl}
            alt={`Evidence capture from ${row.domain}`}
            loading="lazy"
            decoding="async"
            className="h-40 w-full rounded-lg border border-border/60 object-cover"
          />
        )}
      </div>

      {/* Domain intelligence, removal routes and actions load only on expand. */}
      <DomainIntelCard
        url={row.url}
        domain={row.domain}
        workTitle={workTitle}
        classification={row.detectionType ?? row.classification}
        confidence={row.confidence}
        matchId={row.id}
        lastVerified={row.lastVerifiedAt}
        onMarkResolved={onDismiss}
        onEscalate={onReview}
      />
    </div>
  );
}

function ResultRow({
  row,
  workTitle,
  onReview,
  onDismiss,
  onInvestigate,
}: {
  row: ThreatResultRow;
  workTitle: string;
  onReview?: (matchId: string) => void;
  onDismiss?: (matchId: string) => void;
  onInvestigate?: (row: ThreatResultRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = SEVERITY_META[row.severity];

  return (
    <li className="overflow-hidden rounded-lg border border-border/60 bg-card/50">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${row.domain}`}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
        <Badge variant="outline" className={`shrink-0 text-[10px] ${meta.badge}`}>
          {meta.label}
        </Badge>

        <Favicon domain={row.domain} />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
          title={row.domain}
        >
          {row.domain}
          {row.findingCount > 1 && (
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
              ×{row.findingCount}
            </span>
          )}
        </button>

        <span className="hidden w-32 shrink-0 truncate text-[11px] text-muted-foreground md:block">
          {row.categoryLabel}
        </span>
        <Badge variant="outline" className={`hidden shrink-0 text-[10px] sm:inline-flex ${STATUS_STYLE[row.status]}`}>
          {row.status === "active" ? "Active" : row.status === "removed" ? "Removed" : "Offline"}
        </Badge>
        <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">
          {row.confidence}%
        </span>
        <span className="hidden w-28 shrink-0 text-right text-[11px] text-muted-foreground lg:block">
          {formatDate(row.lastVerifiedAt)}
        </span>

        <div className="hidden shrink-0 items-center gap-1 xl:flex">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={`Open ${row.domain}`}
            asChild
          >
            <a href={row.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
          {onInvestigate && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Investigate ${row.domain}`}
              onClick={() => onInvestigate(row)}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDismiss && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Dismiss ${row.domain}`}
              onClick={() => onDismiss(row.id)}
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {open && (
        <ExpandedDetail
          row={row}
          workTitle={workTitle}
          onReview={onReview}
          onDismiss={onDismiss}
        />
      )}
    </li>
  );
}

function SeverityGroup({
  severity,
  rows,
  workTitle,
  onReview,
  onDismiss,
  onInvestigate,
}: {
  severity: ThreatResultRow["severity"];
  rows: ThreatResultRow[];
  workTitle: string;
  onReview?: (matchId: string) => void;
  onDismiss?: (matchId: string) => void;
  onInvestigate?: (row: ThreatResultRow) => void;
}) {
  const [open, setOpen] = useState(severity === "critical" || severity === "high");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const meta = SEVERITY_META[severity];
  const shown = rows.slice(0, visible);

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left transition hover:border-primary/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
        <span className="text-sm font-semibold">{meta.group}</span>
        <span className="text-xs text-muted-foreground">({rows.length})</span>
      </button>

      {open && (
        <>
          <ul className="space-y-1.5">
            {shown.map((row) => (
              <ResultRow
                key={row.id}
                row={row}
                workTitle={workTitle}
                onReview={onReview}
                onDismiss={onDismiss}
                onInvestigate={onInvestigate}
              />
            ))}
          </ul>
          {visible < rows.length && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
            >
              Load {Math.min(PAGE_SIZE, rows.length - visible)} more · {rows.length - visible}{" "}
              remaining
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export type ThreatResultsListProps = {
  suspicious: PublicSuspiciousSource[];
  inspected?: InspectedSourceInput[];
  workTitle: string;
  summaryLine?: string | null;
  onReview?: (matchId: string) => void;
  onDismiss?: (matchId: string) => void;
  onInvestigate?: (row: ThreatResultRow) => void;
};

/**
 * Compact, scalable threat results list: one row per unique detected domain,
 * grouped by severity, filterable, with forensic detail expanded on demand.
 */
export function ThreatResultsList({
  suspicious,
  inspected,
  workTitle,
  summaryLine,
  onReview,
  onDismiss,
  onInvestigate,
}: ThreatResultsListProps) {
  const [filter, setFilter] = useState<ThreatFilterKey>("all");
  const [search, setSearch] = useState("");

  const allRows = useMemo(
    () => buildThreatResultRows({ suspicious, inspected }),
    [suspicious, inspected],
  );
  const rows = useMemo(
    () => filterThreatRows(allRows, { filter, search }),
    [allRows, filter, search],
  );
  const groups = useMemo(() => groupThreatRowsBySeverity(rows), [rows]);
  const totals = useMemo(() => countThreatStatuses(allRows), [allRows]);

  return (
    <div className="space-y-3">
      {summaryLine && (
        <p className="rounded-md border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          {summaryLine}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/50 px-2.5 py-1.5 text-xs">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold tabular-nums">{totals.total}</span>
          <span className="text-muted-foreground">domains detected</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {totals.active} active · {totals.offline} offline · {totals.removed} removed
        </span>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search domain, URL or evidence…"
            aria-label="Search detected sources"
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {THREAT_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            aria-pressed={filter === item.key}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              filter === item.key
                ? "border-primary/60 bg-primary/15 text-foreground"
                : "border-border/60 bg-card/40 text-muted-foreground hover:border-primary/30"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!rows.length ? (
        <p className="rounded-lg border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
          No detected sources match this filter.
        </p>
      ) : (
        <div className="space-y-3">
          {groups
            .filter((group) => group.count > 0)
            .map((group) => (
              <SeverityGroup
                key={group.severity}
                severity={group.severity}
                rows={group.rows}
                workTitle={workTitle}
                onReview={onReview}
                onDismiss={onDismiss}
                onInvestigate={onInvestigate}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default ThreatResultsList;
