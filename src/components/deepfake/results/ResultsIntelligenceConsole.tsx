import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildDomainRows,
  buildFunnelChartData,
  buildNetworkGraph,
  buildOverviewMetrics,
  displayableFindings,
  filterFindings,
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

type Props = {
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
  const [expandedNetwork, setExpandedNetwork] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const visibleFindings = useMemo(
    () => displayableFindings(findings),
    [findings],
  );

  useEffect(() => {
    const next = new Set(visibleFindings.map((finding) => finding.id));
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
  }, [visibleFindings, scanStatus, reduceMotion]);

  const overview = useMemo(
    () => buildOverviewMetrics({ findings: visibleFindings, diagnostics }),
    [visibleFindings, diagnostics],
  );
  const funnel = useMemo(
    () => buildFunnelChartData({ findings: visibleFindings, diagnostics }),
    [visibleFindings, diagnostics],
  );
  const domainRows = useMemo(
    () => buildDomainRows(visibleFindings),
    [visibleFindings],
  );
  const network = useMemo(
    () =>
      buildNetworkGraph({
        findings: visibleFindings,
        centerLabel: targetName,
      }),
    [visibleFindings, targetName],
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

  const pageSize = expandedNetwork ? 24 : 12;
  const paged = useMemo(
    () => paginateFindings(sorted, page, pageSize),
    [sorted, page, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [domainFilter, classificationFilter, search, riskFilter]);

  const selectFinding = (findingId: string) => {
    setSelectedFindingId(findingId);
    const node = cardRefs.current.get(findingId);
    node?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
  };

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
          Scan completed · {visibleFindings.length} saved client-visible finding
          {visibleFindings.length === 1 ? "" : "s"}.
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
          <VerifiedThreatOverview metrics={overview} funnel={funnel} />
          <VerifiedEvidenceNetwork
            graph={network}
            centerThumbnailUrl={artistThumbnailUrl}
            selectedDomain={domainFilter}
            selectedFindingId={selectedFindingId}
            onSelectDomain={setDomainFilter}
            onSelectFinding={selectFinding}
            reduceMotion={reduceMotion}
          />
          <div className="grid gap-4 xl:grid-cols-2">
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
              <VerifiedFindingsTable
                findings={paged.items}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={onSort}
                onSelectFinding={selectFinding}
              />
              {paged.hasMore && (
                <button
                  type="button"
                  className="w-full rounded-md border border-cyan-500/40 py-2 text-[12px] text-cyan-300 hover:bg-cyan-500/10"
                  onClick={() => {
                    setExpandedNetwork(true);
                    setPage((value) => value + 1);
                  }}
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
      ) : (
        <section aria-labelledby="finding-cards-heading" className="space-y-2.5">
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
        </section>
      )}
    </div>
  );
}
