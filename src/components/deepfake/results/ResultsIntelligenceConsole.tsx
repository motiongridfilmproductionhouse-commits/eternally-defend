import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDomainRows,
  buildFunnelChartData,
  buildNetworkGraph,
  buildOverviewMetrics,
  displayableFindings,
  filterFindings,
  findingDomain,
  paginateFindings,
  sortFindings,
  type ClientFinding,
  type FindingsSortKey,
  type RiskLevel,
} from "@/lib/deepfake/results-dashboard";
import { VerifiedThreatOverview } from "./VerifiedThreatOverview";
import { VerifiedEvidenceNetwork } from "./VerifiedEvidenceNetwork";
import {
  ResultsFilterBar,
  TopVerifiedDomainsTable,
  VerifiedFindingsTable,
} from "./IntelligenceTables";
import { IntelligenceFindingCard } from "./IntelligenceFindingCard";
import { ResultsConsoleErrorBoundary } from "./ResultsConsoleErrorBoundary";

type Props = {
  scanId: string;
  scanStatus: string;
  targetName: string;
  artistThumbnailUrl?: string | null;
  findings: ClientFinding[];
  discoveries?: Array<{
    page_url?: string | null;
    canonical_url?: string | null;
    thumbnail_url?: string | null;
    image_url?: string | null;
  }>;
  diagnostics?: Record<string, number> | null;
  riskFilter: "ALL" | RiskLevel;
  onRiskFilterChange: (value: "ALL" | RiskLevel) => void;
  onUpdateFinding: (
    findingId: string,
    status: "reviewed" | "dismissed" | "queued_takedown",
  ) => void;
  pending: boolean;
  emptyMessage?: string;
};

export function ResultsIntelligenceConsole({
  scanId,
  scanStatus,
  targetName,
  artistThumbnailUrl,
  findings,
  discoveries = [],
  diagnostics,
  riskFilter,
  onRiskFilterChange,
  onUpdateFinding,
  pending,
  emptyMessage,
}: Props) {
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [classificationFilter, setClassificationFilter] = useState<
    "ALL" | "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE"
  >("ALL");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<FindingsSortKey>("risk");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const seededScanRef = useRef<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Reset local console state when the selected scan changes.
  useEffect(() => {
    setDomainFilter(null);
    setClassificationFilter("ALL");
    setSearch("");
    setSortKey("risk");
    setSortDirection("desc");
    setPage(1);
    setSelectedFindingId(null);
    setNewIds(new Set());
    knownIdsRef.current = new Set();
    seededScanRef.current = null;
    cardRefs.current.clear();
  }, [scanId]);

  const visibleFindings = useMemo(
    () => displayableFindings(findings),
    [findings],
  );

  useEffect(() => {
    const next = new Set(visibleFindings.map((finding) => finding.id));
    if (seededScanRef.current !== scanId) {
      // First observation of this scan: seed without pulsing the backlog.
      knownIdsRef.current = next;
      seededScanRef.current = scanId;
      setNewIds(new Set());
      return;
    }

    const newcomers = new Set<string>();
    for (const id of next) {
      if (!knownIdsRef.current.has(id)) newcomers.add(id);
    }
    knownIdsRef.current = next;
    if (newcomers.size && scanStatus === "running") {
      setNewIds(newcomers);
      if (!reduceMotion) {
        const timer = window.setTimeout(() => setNewIds(new Set()), 4_000);
        return () => window.clearTimeout(timer);
      }
    }
    return undefined;
  }, [visibleFindings, scanStatus, reduceMotion, scanId]);

  // Overview/network/cards share risk + classification so counts stay aligned.
  const scopedFindings = useMemo(
    () =>
      filterFindings({
        findings: visibleFindings,
        riskFilter,
        classificationFilter,
      }),
    [visibleFindings, riskFilter, classificationFilter],
  );

  const overview = useMemo(
    () => buildOverviewMetrics({ findings: scopedFindings, diagnostics }),
    [scopedFindings, diagnostics],
  );
  const funnel = useMemo(
    () => buildFunnelChartData({ findings: scopedFindings, diagnostics }),
    [scopedFindings, diagnostics],
  );
  const networkFindings = scopedFindings;

  const domainRows = useMemo(
    () => buildDomainRows(networkFindings),
    [networkFindings],
  );
  const network = useMemo(
    () =>
      buildNetworkGraph({
        findings: networkFindings,
        centerLabel: targetName,
      }),
    [networkFindings, targetName],
  );

  const filtered = useMemo(
    () =>
      filterFindings({
        findings: visibleFindings,
        riskFilter,
        domainFilter,
        classificationFilter,
        search,
      }),
    [
      visibleFindings,
      riskFilter,
      domainFilter,
      classificationFilter,
      search,
    ],
  );

  const sorted = useMemo(
    () => sortFindings(filtered, sortKey, sortDirection),
    [filtered, sortKey, sortDirection],
  );

  const pageSize = 12;
  const paged = useMemo(
    () => paginateFindings(sorted, page, pageSize),
    [sorted, page],
  );

  useEffect(() => {
    setPage(1);
  }, [domainFilter, classificationFilter, search, riskFilter]);

  // Drop a stale domain filter when risk/classification no longer includes it.
  useEffect(() => {
    if (!domainFilter) return;
    const stillPresent = networkFindings.some(
      (finding) => findingDomain(finding) === domainFilter,
    );
    if (!stillPresent) {
      setDomainFilter(null);
    }
  }, [domainFilter, networkFindings]);

  // Clear selection when filters hide the selected finding.
  useEffect(() => {
    if (!selectedFindingId) return;
    if (!sorted.some((finding) => finding.id === selectedFindingId)) {
      setSelectedFindingId(null);
    }
  }, [selectedFindingId, sorted]);

  const selectFinding = (
    findingId: string,
    options?: { syncDomain?: boolean },
  ) => {
    const target = networkFindings.find((item) => item.id === findingId);
    if (!target) return;
    setSelectedFindingId(findingId);
    if (options?.syncDomain) {
      setDomainFilter(findingDomain(target));
      setSearch("");
      setPage(1);
    }
  };

  // After domain filter settles, load enough cumulative pages to mount the card.
  useEffect(() => {
    if (!selectedFindingId) return;
    const index = sorted.findIndex((item) => item.id === selectedFindingId);
    if (index < 0) return;
    const neededPage = Math.floor(index / pageSize) + 1;
    if (page < neededPage) {
      setPage(neededPage);
    }
  }, [selectedFindingId, sorted, page, pageSize]);

  useEffect(() => {
    if (!selectedFindingId) return;
    const node = cardRefs.current.get(selectedFindingId);
    if (!node) return;
    node.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
  }, [selectedFindingId, paged.items, reduceMotion]);

  const onSort = (key: FindingsSortKey) => {
    if (sortKey === key) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("desc");
  };

  const showOverview = visibleFindings.length > 0;

  return (
    <div className="space-y-4" data-testid="results-intelligence-console">
      {scanStatus === "completed" && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-300">
          Scan completed · {scopedFindings.length} finding
          {scopedFindings.length === 1 ? "" : "s"}
          {scopedFindings.length !== visibleFindings.length
            ? ` shown (${visibleFindings.length} saved total)`
            : " saved"}
          .
        </div>
      )}
      {scanStatus === "partial" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
          Verified progress saved. Continue remains available above.
        </div>
      )}
      {scanStatus === "running" && (
        <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[12px] text-cyan-300">
          Live sweep in progress — persisted findings stay visible below.
        </div>
      )}

      {showOverview && (
        <>
          <ResultsConsoleErrorBoundary
            label="VerifiedThreatOverview"
            fallback={
              <div
                className="rounded-xl border border-sky-500/25 bg-[#07111f] p-4 text-sm text-slate-300"
                data-testid="verified-threat-overview-fallback"
              >
                Verified Threat Overview unavailable — {overview.client_visible}{" "}
                client-visible finding
                {overview.client_visible === 1 ? "" : "s"} still listed below.
              </div>
            }
          >
            <VerifiedThreatOverview metrics={overview} funnel={funnel} />
          </ResultsConsoleErrorBoundary>
          <ResultsConsoleErrorBoundary
            label="VerifiedEvidenceNetwork"
            fallback={
              <div
                className="rounded-xl border border-sky-500/20 bg-[#07111f] p-4 text-sm text-slate-300"
                data-testid="evidence-network-fallback"
              >
                Evidence Network unavailable — domain and finding tables remain
                below.
              </div>
            }
          >
            <VerifiedEvidenceNetwork
              graph={network}
              centerThumbnailUrl={artistThumbnailUrl}
              selectedDomain={domainFilter}
              selectedFindingId={selectedFindingId}
              onSelectDomain={setDomainFilter}
              onSelectFinding={(findingId) =>
                selectFinding(findingId, { syncDomain: true })
              }
              reduceMotion={reduceMotion}
              emptyMessage={
                visibleFindings.length > 0
                  ? "No verified nodes match the current risk or classification filters."
                  : undefined
              }
            />
          </ResultsConsoleErrorBoundary>
          <div
            className="grid gap-4 xl:grid-cols-2"
            data-testid="intelligence-tables"
          >
            <TopVerifiedDomainsTable
              rows={domainRows}
              selectedDomain={domainFilter}
              onSelectDomain={setDomainFilter}
            />
            <div className="space-y-3">
              <ResultsFilterBar
                search={search}
                onSearchChange={setSearch}
                classificationFilter={classificationFilter}
                onClassificationChange={setClassificationFilter}
                domainFilter={domainFilter}
                domains={domainRows.map((row) => row.domain)}
                onDomainChange={setDomainFilter}
                riskFilter={riskFilter}
                onRiskChange={onRiskFilterChange}
              />
              <div className="text-[11px] text-slate-500">
                Table + cards share pagination · showing {paged.items.length} of{" "}
                {sorted.length}
              </div>
              <VerifiedFindingsTable
                findings={paged.items}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                onSelectFinding={(findingId) => selectFinding(findingId)}
              />
              {paged.hasMore && (
                <button
                  type="button"
                  className="w-full rounded-md border border-cyan-500/40 py-2 text-[12px] text-cyan-300 hover:bg-cyan-500/10"
                  onClick={() => setPage((value) => value + 1)}
                >
                  Load more findings
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {!showOverview ? (
        <div className="rounded-xl border border-sky-500/20 bg-[#07111f] p-10 text-center text-sm text-slate-400">
          {emptyMessage || "No client-visible verified findings yet."}
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-sky-500/20 bg-[#07111f] p-10 text-center text-sm text-slate-400">
          {riskFilter !== "ALL" &&
          !domainFilter &&
          classificationFilter === "ALL" &&
          !search.trim()
            ? emptyMessage || "No findings at this risk level."
            : "No findings match the current filters."}
        </div>
      ) : (
        <section
          aria-labelledby="finding-cards-heading"
          className="space-y-2.5"
          data-testid="intelligence-finding-cards"
        >
          <div className="flex items-center justify-between gap-2">
            <h3
              id="finding-cards-heading"
              className="text-sm font-semibold text-slate-100"
            >
              Finding cards
            </h3>
            <span className="text-[11px] text-slate-500">
              Showing {paged.items.length} of {sorted.length}
            </span>
          </div>
          <ul className="space-y-2.5">
            {paged.items.map((finding) => (
              <li key={finding.id}>
                <IntelligenceFindingCard
                  finding={finding}
                  discoveries={discoveries}
                  pending={pending}
                  isNew={newIds.has(finding.id)}
                  reduceMotion={reduceMotion}
                  selected={selectedFindingId === finding.id}
                  cardRef={(node) => {
                    if (node) cardRefs.current.set(finding.id, node);
                    else cardRefs.current.delete(finding.id);
                  }}
                  onUpdate={(status) => onUpdateFinding(finding.id, status)}
                />
              </li>
            ))}
          </ul>
          {paged.hasMore && (
            <button
              type="button"
              className="w-full rounded-md border border-cyan-500/40 py-2 text-[12px] text-cyan-300 hover:bg-cyan-500/10"
              onClick={() => setPage((value) => value + 1)}
            >
              Load more findings
            </button>
          )}
        </section>
      )}
    </div>
  );
}
