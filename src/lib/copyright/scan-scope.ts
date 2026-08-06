/**
 * Selected-scan scoping helpers for Copyright Intelligence UI.
 * Prevents global monitor rows / previous-scan findings from appearing as
 * results for the currently selected scan.
 */

export function isScanDetailAligned(opts: {
  selectedScanId: string | null | undefined;
  detailScanId: string | null | undefined;
  isLoading?: boolean;
  isFetching?: boolean;
}): boolean {
  if (!opts.selectedScanId) return false;
  if (opts.isLoading) return false;
  if (!opts.detailScanId) return false;
  return opts.detailScanId === opts.selectedScanId;
}

/** Findings are only renderable when the fetched detail matches the selection. */
export function scopedScanMatches<T>(
  selectedScanId: string | null | undefined,
  detail: { scan?: { id?: string | null } | null; matches?: T[] | null } | null | undefined,
  opts?: { isLoading?: boolean },
): T[] {
  if (
    !isScanDetailAligned({
      selectedScanId,
      detailScanId: detail?.scan?.id,
      isLoading: opts?.isLoading,
    })
  ) {
    return [];
  }
  return detail?.matches ?? [];
}

export function shouldShowAnalysisBanner(opts: {
  scanPending: boolean;
  selectedScanId: string | null | undefined;
  bannerTitle: string | null | undefined;
  selectedScanTitle: string | null | undefined;
}): boolean {
  if (opts.scanPending) return false;
  if (!opts.bannerTitle || !opts.selectedScanId) return false;
  // Banner must belong to the selected scan title when available.
  if (opts.selectedScanTitle && opts.bannerTitle !== opts.selectedScanTitle) {
    return false;
  }
  return true;
}

export interface MonitoredSourceDisplay {
  id: string;
  domain: string;
  url: string;
  tracked_titles?: string[] | null;
  discovered_scan_id?: string | null;
  status?: string | null;
  monitor_enabled?: boolean | null;
  workTitle?: string | null;
  originatingScanId?: string | null;
}

/** Label for the global monitor section — never the selected-scan findings panel. */
export const PREVIOUSLY_MONITORED_SOURCES_LABEL = "Previously monitored sources";

export function monitoredSourceAttribution(source: MonitoredSourceDisplay): {
  workTitle: string;
  originatingScanId: string | null;
} {
  const titles = (source.tracked_titles ?? []).filter(Boolean);
  return {
    workTitle: source.workTitle || titles[0] || "Unknown work",
    originatingScanId: source.originatingScanId ?? source.discovered_scan_id ?? null,
  };
}

/** Active monitored sources for dashboard counters (excludes deactivated). */
export function activeMonitoredSources<
  T extends { status?: string | null; monitor_enabled?: boolean | null },
>(sources: T[]): T[] {
  return sources.filter((s) => s.status === "active" && s.monitor_enabled !== false);
}
