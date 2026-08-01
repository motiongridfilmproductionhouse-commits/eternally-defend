import type {
  ClientFinding,
  DomainRow,
  FindingsSortKey,
  RiskLevel,
} from "@/lib/deepfake/results-dashboard";
import {
  evidenceLinkProps,
  findingDomain,
  formatConfidence,
  formatDash,
  formatTimestamp,
} from "@/lib/deepfake/results-dashboard";
import { ExternalLink } from "lucide-react";

export function TopVerifiedDomainsTable({
  rows,
  selectedDomain,
  onSelectDomain,
}: {
  rows: DomainRow[];
  selectedDomain: string | null;
  onSelectDomain: (domain: string | null) => void;
}) {
  return (
    <section className="rounded-xl border border-sky-500/20 bg-[#07111f] p-4 text-slate-200">
      <h3 className="text-sm font-semibold text-white">Top Verified Domains</h3>
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
            <tr className="border-b border-white/10">
              <th className="py-2 pr-3 font-medium">Domain</th>
              <th className="py-2 pr-3 font-medium">Verified pages</th>
              <th className="py-2 pr-3 font-medium">Probable pages</th>
              <th className="py-2 pr-3 font-medium">Highest risk</th>
              <th className="py-2 pr-3 font-medium">Last verified</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  No verified domains yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.domain}
                  className={`border-b border-white/5 ${
                    selectedDomain === row.domain ? "bg-cyan-500/10" : ""
                  }`}
                >
                  <td className="py-2.5 pr-3">
                    <button
                      type="button"
                      className="text-cyan-300 hover:underline"
                      onClick={() =>
                        onSelectDomain(
                          selectedDomain === row.domain ? null : row.domain,
                        )
                      }
                    >
                      {row.domain}
                    </button>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">{row.verified_pages}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{row.probable_pages}</td>
                  <td className="py-2.5 pr-3">{formatDash(row.highest_risk)}</td>
                  <td className="py-2.5 pr-3">{formatTimestamp(row.last_verified)}</td>
                  <td className="py-2.5 capitalize">{row.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-2 md:hidden">
        {rows.map((row) => (
          <li
            key={row.domain}
            className="rounded-lg border border-white/10 bg-black/20 p-3"
          >
            <button
              type="button"
              className="text-sm font-medium text-cyan-300"
              onClick={() =>
                onSelectDomain(
                  selectedDomain === row.domain ? null : row.domain,
                )
              }
            >
              {row.domain}
            </button>
            <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-slate-400">
              <span>Verified {row.verified_pages}</span>
              <span>Probable {row.probable_pages}</span>
              <span>Risk {formatDash(row.highest_risk)}</span>
              <span>{formatTimestamp(row.last_verified)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function VerifiedFindingsTable({
  findings,
  sortKey,
  sortDirection,
  onSort,
  onSelectFinding,
}: {
  findings: ClientFinding[];
  sortKey: FindingsSortKey;
  sortDirection: "asc" | "desc";
  onSort: (key: FindingsSortKey) => void;
  onSelectFinding: (id: string) => void;
}) {
  const header = (
    key: FindingsSortKey,
    label: string,
  ) => (
    <th className="py-2 pr-3 font-medium">
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-cyan-300"
        onClick={() => onSort(key)}
      >
        {label}
        {sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <section className="rounded-xl border border-sky-500/20 bg-[#07111f] p-4 text-slate-200">
      <h3 className="text-sm font-semibold text-white">Verified Findings</h3>
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
            <tr className="border-b border-white/10">
              {header("classification", "Classification")}
              {header("title", "Finding title")}
              {header("domain", "Domain")}
              {header("identity", "Identity confidence")}
              {header("synthetic", "Synthetic-media confidence")}
              {header("http", "HTTP status")}
              <th className="py-2 font-medium">Evidence action</th>
            </tr>
          </thead>
          <tbody>
            {findings.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  No verified findings match the current filters.
                </td>
              </tr>
            ) : (
              findings.map((finding) => {
                const evidence = evidenceLinkProps(finding);
                return (
                  <tr key={finding.id} className="border-b border-white/5">
                    <td className="py-2.5 pr-3">
                      {(finding.finding_classification ?? "—").replace(/_/g, " ")}
                    </td>
                    <td className="py-2.5 pr-3">
                      <button
                        type="button"
                        className="text-left text-slate-100 hover:text-cyan-300"
                        onClick={() => onSelectFinding(finding.id)}
                      >
                        {finding.page_title || "Verified evidence page"}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3">{findingDomain(finding)}</td>
                    <td className="py-2.5 pr-3">
                      {formatConfidence(finding.identity_confidence)}
                    </td>
                    <td className="py-2.5 pr-3">
                      {formatConfidence(finding.synthetic_media_confidence)}
                    </td>
                    <td className="py-2.5 pr-3">
                      {formatDash(finding.http_status)}
                    </td>
                    <td className="py-2.5">
                      {evidence.kind === "link" ? (
                        <a
                          href={evidence.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-cyan-300 hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExternalLink className="size-3" aria-hidden />
                          Open
                        </a>
                      ) : (
                        <span className="text-slate-500">Unavailable</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-2 md:hidden">
        {findings.map((finding) => {
          const evidence = evidenceLinkProps(finding);
          return (
            <li
              key={finding.id}
              className="rounded-lg border border-white/10 bg-black/20 p-3"
            >
              <button
                type="button"
                className="text-left text-sm font-medium text-white"
                onClick={() => onSelectFinding(finding.id)}
              >
                {finding.page_title || "Verified evidence page"}
              </button>
              <div className="mt-1 text-[11px] text-slate-400">
                {(finding.finding_classification ?? "—").replace(/_/g, " ")} ·{" "}
                {findingDomain(finding)}
              </div>
              {evidence.kind === "link" ? (
                <a
                  href={evidence.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-cyan-300"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ExternalLink className="size-3" /> Open verified evidence page
                </a>
              ) : (
                <p className="mt-2 text-[11px] text-slate-500">
                  Evidence URL unavailable.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ResultsFilterBar({
  search,
  onSearchChange,
  classificationFilter,
  onClassificationChange,
  domainFilter,
  domains,
  onDomainChange,
  riskFilter,
  onRiskChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  classificationFilter: "ALL" | "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE";
  onClassificationChange: (
    value: "ALL" | "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE",
  ) => void;
  domainFilter: string | null;
  domains: string[];
  onDomainChange: (value: string | null) => void;
  riskFilter: "ALL" | RiskLevel;
  onRiskChange: (value: "ALL" | RiskLevel) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-sky-500/20 bg-[#07111f] p-3 sm:flex-row sm:flex-wrap sm:items-center">
      <input
        type="search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search saved findings"
        aria-label="Search saved findings"
        className="h-9 min-w-[180px] flex-1 rounded-md border border-white/10 bg-black/30 px-3 text-sm text-slate-100 placeholder:text-slate-500"
      />
      <select
        value={classificationFilter}
        onChange={(event) =>
          onClassificationChange(
            event.target.value as "ALL" | "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE",
          )
        }
        aria-label="Classification filter"
        className="h-9 rounded-md border border-white/10 bg-black/30 px-2 text-[12px] text-slate-100"
      >
        <option value="ALL">All classifications</option>
        <option value="VERIFIED_DEEPFAKE">Verified deepfake</option>
        <option value="PROBABLE_DEEPFAKE">Probable deepfake</option>
      </select>
      <select
        value={domainFilter ?? ""}
        onChange={(event) => onDomainChange(event.target.value || null)}
        aria-label="Domain filter"
        className="h-9 rounded-md border border-white/10 bg-black/30 px-2 text-[12px] text-slate-100"
      >
        <option value="">All domains</option>
        {domains.map((domain) => (
          <option key={domain} value={domain}>
            {domain}
          </option>
        ))}
      </select>
      <select
        value={riskFilter}
        onChange={(event) =>
          onRiskChange(event.target.value as "ALL" | RiskLevel)
        }
        aria-label="Risk filter"
        className="h-9 rounded-md border border-white/10 bg-black/30 px-2 text-[12px] text-slate-100"
      >
        <option value="ALL">All risk</option>
        <option value="CRITICAL">Critical</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
      </select>
    </div>
  );
}
