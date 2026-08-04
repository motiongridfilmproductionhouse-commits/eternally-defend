import { FileDown, FileText, History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  onGenerateFinal,
  onGenerateInterim,
  onDownloadLatest,
  onDownloadHistory,
}: Props) {
  const busy = generatingFinal || generatingInterim || downloading;
  const latest = history[0] ?? null;
  const canDownload = Boolean(latest?.storageKey);
  const interimUseful =
    scanStatus === "running" ||
    scanStatus === "partial" ||
    findingCount > 0;

  return (
    <section
      id="deepfake-report-action-bar"
      data-testid="deepfake-report-action-bar"
      className="card-surface space-y-3 p-4"
      aria-label="Deepfake report actions"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
            DEEPFAKE THREAT REPORT
          </div>
          <div className="mt-1 text-sm font-semibold">
            Generate or download an evidence report for this identity
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground max-w-2xl">
            Uses saved scan findings, diagnostics, and identity verification
            only. Does not invent URLs, confidence scores, screenshots, or legal
            conclusions.
            {findingCount > 0
              ? ` ${findingCount} client-visible finding${findingCount === 1 ? "" : "s"} available.`
              : " No client-visible findings yet — report can still document diagnostics."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={onGenerateFinal}
            data-testid="generate-deepfake-report"
          >
            {generatingFinal ? (
              <>
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <FileText className="mr-2 size-3.5" />
                Generate Deepfake Report
              </>
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || !interimUseful}
            onClick={onGenerateInterim}
            data-testid="generate-interim-report"
            title={
              interimUseful
                ? "Snapshot current persisted findings while the scan is in progress or partial"
                : "Run or select a scan with progress first"
            }
          >
            {generatingInterim ? (
              <>
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Preparing interim…
              </>
            ) : (
              <>
                <FileText className="mr-2 size-3.5" />
                Generate Interim Report
              </>
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
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
                <Loader2 className="mr-2 size-3.5 animate-spin" />
                Opening PDF…
              </>
            ) : (
              <>
                <FileDown className="mr-2 size-3.5" />
                Download PDF
              </>
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={historyLoading}
            onClick={onToggleHistory}
            data-testid="toggle-report-history"
            aria-expanded={historyOpen}
          >
            <History className="mr-2 size-3.5" />
            Report history
            {history.length > 0 ? ` (${history.length})` : ""}
          </Button>
        </div>
      </div>

      {latest && (
        <div className="text-[11px] text-muted-foreground">
          Latest ready report:{" "}
          <span className="font-medium text-foreground">
            {latest.reportMode === "interim" ? "Interim" : "Final"}
          </span>{" "}
          · {latest.findingsCount} finding
          {latest.findingsCount === 1 ? "" : "s"} ·{" "}
          {formatWhen(latest.generatedAt ?? latest.createdAt)}
        </div>
      )}

      {historyOpen && (
        <div
          className="rounded-lg border border-border/70 bg-secondary/20"
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
                  className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.reportMode === "interim" ? "Interim" : "Final"} ·{" "}
                      {row.findingsCount} finding
                      {row.findingsCount === 1 ? "" : "s"} ·{" "}
                      {formatWhen(row.generatedAt ?? row.createdAt)}
                      {row.reportId ? ` · ${row.reportId}` : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={!row.storageKey || busy}
                    onClick={() => onDownloadHistory(row.id)}
                  >
                    {downloadingHistoryId === row.id ? (
                      <>
                        <Loader2 className="mr-2 size-3.5 animate-spin" />
                        Opening…
                      </>
                    ) : (
                      <>
                        <FileDown className="mr-2 size-3.5" />
                        Download PDF
                      </>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
