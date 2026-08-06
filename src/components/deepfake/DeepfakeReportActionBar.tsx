import { FileDown, FileText, History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canGenerateInterimReport } from "@/lib/deepfake/report-ui";

export type DeepfakeReportHistoryRow = {
  id: string;
  name: string;
  status: string;
  findingsCount: number;
  createdAt: string;
  reportId: string | null;
  scanId: string | null;
  profileId: string | null;
  reportMode: "final" | "interim" | null;
  fileName: string | null;
  storageKey: string | null;
  generatedAt: string | null;
};

type Props = {
  scanStatus: string | null | undefined;
  findingCount: number;
  history: DeepfakeReportHistoryRow[];
  historyLoading?: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
  generatingFinal?: boolean;
  generatingInterim?: boolean;
  downloading?: boolean;
  downloadingHistoryId?: string | null;
  /** True when a Ready report exists (history or just-generated). */
  canDownload?: boolean;
  onGenerateFinal: () => void;
  onGenerateInterim: () => void;
  onDownloadLatest: () => void;
  onDownloadHistory: (historyId: string) => void;
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/** Interim is available for any non-failed scan that has progress or findings. */
export { canGenerateInterimReport } from "@/lib/deepfake/report-ui";

/**
 * Persistent report action card for Deepfake Intelligence results.
 * Always stacks: report info on top, action buttons below — never a
 * side-by-side flex row that collapses the description in the sidebar layout.
 */
export function DeepfakeReportActionBar({
  scanStatus,
  findingCount,
  history,
  historyLoading = false,
  historyOpen,
  onToggleHistory,
  generatingFinal = false,
  generatingInterim = false,
  downloading = false,
  downloadingHistoryId = null,
  canDownload: canDownloadProp,
  onGenerateFinal,
  onGenerateInterim,
  onDownloadLatest,
  onDownloadHistory,
}: Props) {
  const busy = generatingFinal || generatingInterim || downloading;
  const latest = history[0] ?? null;
  const canDownload =
    typeof canDownloadProp === "boolean" ? canDownloadProp : Boolean(latest?.storageKey);
  const interimEnabled = canGenerateInterimReport({
    scanStatus,
    findingCount,
  });

  return (
    <section
      id="deepfake-report-action-bar"
      data-testid="deepfake-report-action-bar"
      className="card-surface w-full min-w-0 overflow-hidden p-4"
      aria-label="Deepfake report actions"
    >
      <div className="flex w-full min-w-0 flex-col gap-4">
        {/* Report information — full width, never a shrinking side column */}
        <div className="w-full min-w-0 space-y-1">
          <div className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
            DEEPFAKE THREAT REPORT
          </div>
          <div className="text-sm font-semibold break-words">
            Generate or download an evidence report for this identity
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground break-words">
            Uses saved scan findings, diagnostics, and identity verification only. Does not invent
            URLs, confidence scores, screenshots, or legal conclusions.
            {findingCount > 0
              ? ` ${findingCount} client-visible finding${findingCount === 1 ? "" : "s"} available.`
              : " No client-visible findings yet — report can still document diagnostics."}
          </p>
          {latest ? (
            <div className="pt-1 text-[11px] text-muted-foreground break-words">
              Latest ready report:{" "}
              <span className="font-medium text-foreground">
                {latest.reportMode === "interim" ? "Interim" : "Final"}
              </span>{" "}
              · {latest.findingsCount} finding
              {latest.findingsCount === 1 ? "" : "s"} ·{" "}
              {formatWhen(latest.generatedAt ?? latest.createdAt)}
            </div>
          ) : null}
        </div>

        {/* Action buttons — own row under the copy; wrap inside the card */}
        <div
          className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"
          data-testid="deepfake-report-actions"
        >
          <Button
            type="button"
            size="sm"
            className="w-full justify-center"
            disabled={busy}
            onClick={onGenerateFinal}
            data-testid="generate-deepfake-report"
          >
            {generatingFinal ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <FileText className="size-3.5" />
                Generate Deepfake Report
              </>
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full justify-center"
            disabled={busy || !interimEnabled}
            onClick={onGenerateInterim}
            data-testid="generate-interim-report"
            title={
              interimEnabled
                ? "Snapshot current persisted findings (including partial scans)"
                : "Select a running, partial, or completed scan first"
            }
          >
            {generatingInterim ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Preparing interim…
              </>
            ) : (
              <>
                <FileText className="size-3.5" />
                Generate Interim Report
              </>
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full justify-center"
            disabled={busy || !canDownload}
            onClick={onDownloadLatest}
            data-testid="download-deepfake-pdf"
            title={
              canDownload
                ? `Download ${latest?.fileName ?? "latest PDF"}`
                : "Generate a report first"
            }
          >
            {downloading && !downloadingHistoryId ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Opening PDF…
              </>
            ) : (
              <>
                <FileDown className="size-3.5" />
                Download PDF
              </>
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full justify-center border border-border/60"
            disabled={historyLoading}
            onClick={onToggleHistory}
            data-testid="toggle-report-history"
            aria-expanded={historyOpen}
          >
            <History className="size-3.5" />
            Report history
            {history.length > 0 ? ` (${history.length})` : ""}
          </Button>
        </div>

        {historyOpen ? (
          <div
            className="w-full min-w-0 rounded-lg border border-border/70 bg-secondary/20"
            data-testid="deepfake-report-history"
          >
            {historyLoading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading report history…
              </div>
            ) : history.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                No reports generated for this identity/scan yet.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {history.map((row) => (
                  <li
                    key={row.id}
                    className="flex min-w-0 flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{row.name}</div>
                      <div className="text-[11px] text-muted-foreground break-words">
                        {row.reportMode === "interim" ? "Interim" : "Final"} · {row.findingsCount}{" "}
                        finding
                        {row.findingsCount === 1 ? "" : "s"} ·{" "}
                        {formatWhen(row.generatedAt ?? row.createdAt)}
                        {row.reportId ? ` · ${row.reportId}` : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full shrink-0 sm:w-auto"
                      disabled={!row.storageKey || busy}
                      onClick={() => onDownloadHistory(row.id)}
                    >
                      {downloadingHistoryId === row.id ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          Opening…
                        </>
                      ) : (
                        <>
                          <FileDown className="size-3.5" />
                          Download PDF
                        </>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
