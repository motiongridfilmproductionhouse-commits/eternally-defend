import { useId, useMemo, useState } from "react";
import {
  boundNetworkGraph,
  type NetworkGraph,
} from "@/lib/deepfake/results-dashboard";

type Props = {
  graph: NetworkGraph;
  centerThumbnailUrl?: string | null;
  selectedDomain: string | null;
  selectedFindingId: string | null;
  onSelectDomain: (domain: string | null) => void;
  onSelectFinding: (findingId: string) => void;
  reduceMotion?: boolean;
};

function nodeColor(classification: "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE") {
  return classification === "VERIFIED_DEEPFAKE" ? "#f87171" : "#fb923c";
}

export function VerifiedEvidenceNetwork({
  graph,
  centerThumbnailUrl,
  selectedDomain,
  selectedFindingId,
  onSelectDomain,
  onSelectFinding,
  reduceMotion = false,
}: Props) {
  const gradientId = useId();
  const [expanded, setExpanded] = useState(false);
  const bounded = useMemo(
    () =>
      boundNetworkGraph(graph, {
        maxDomains: expanded ? 24 : 8,
        maxFindingsPerDomain: expanded ? 12 : 5,
      }),
    [graph, expanded],
  );
  const visible = bounded.visible;
  const width = 640;
  const height = 360;
  const cx = width / 2;
  const cy = height / 2;
  const domainRadius = 118;
  const findingRadius = 168;

  const domainPositions = visible.domains.map((domain, index) => {
    const angle =
      (Math.PI * 2 * index) / Math.max(visible.domains.length, 1) - Math.PI / 2;
    return {
      domain,
      x: cx + Math.cos(angle) * domainRadius,
      y: cy + Math.sin(angle) * domainRadius,
      angle,
    };
  });

  if (graph.totalFindings === 0) {
    return (
      <section className="rounded-xl border border-sky-500/20 bg-[#07111f] p-4 text-slate-200">
        <h3 className="text-sm font-semibold text-white">Verified Evidence Network</h3>
        <p className="mt-2 text-sm text-slate-400">
          Network visualization appears when verified findings are saved.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border border-sky-500/20 bg-[#07111f] p-4 text-slate-200"
      aria-labelledby="evidence-network-heading"
    >
      <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3
            id="evidence-network-heading"
            className="text-sm font-semibold text-white"
          >
            Verified Evidence Network
          </h3>
          <p className="mt-1 text-[12px] text-slate-400">
            Center identity · domain hubs · verified evidence pages only.
          </p>
        </div>
        {(bounded.hiddenDomainCount > 0 || bounded.hiddenFindingCount > 0) && (
          <button
            type="button"
            className="rounded border border-cyan-500/40 px-2.5 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/10"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? "Show fewer nodes"
              : `Show more nodes (${bounded.hiddenFindingCount + bounded.hiddenDomainCount} hidden)`}
          </button>
        )}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mx-auto h-auto w-full max-w-3xl"
          role="img"
          aria-label="Verified evidence network graph"
        >
          <defs>
            <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(56,189,248,0.28)" />
              <stop offset="100%" stopColor="rgba(56,189,248,0)" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={150} fill={`url(#${gradientId})`} />

          {domainPositions.map(({ domain, x, y }) => (
            <g key={`edges-${domain.domain}`}>
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke={
                  selectedDomain === domain.domain
                    ? "rgba(34,211,238,0.7)"
                    : "rgba(148,163,184,0.35)"
                }
                strokeWidth={selectedDomain === domain.domain ? 1.6 : 1}
                className={reduceMotion ? undefined : "transition-all duration-300"}
              />
              {domain.findings.map((finding, findingIndex) => {
                const spread =
                  ((findingIndex - (domain.findings.length - 1) / 2) * 0.22);
                const fx = cx + Math.cos(domainPositions.find((d) => d.domain.domain === domain.domain)!.angle + spread) * findingRadius;
                const fy = cy + Math.sin(domainPositions.find((d) => d.domain.domain === domain.domain)!.angle + spread) * findingRadius;
                return (
                  <line
                    key={`edge-${finding.id}`}
                    x1={x}
                    y1={y}
                    x2={fx}
                    y2={fy}
                    stroke={nodeColor(finding.classification)}
                    strokeOpacity={0.45}
                    strokeWidth={1}
                  />
                );
              })}
            </g>
          ))}

          {/* Center identity */}
          <g>
            <circle
              cx={cx}
              cy={cy}
              r={34}
              fill="#0b1c33"
              stroke="#38bdf8"
              strokeWidth={2}
            />
            {centerThumbnailUrl ? (
              <image
                href={centerThumbnailUrl}
                x={cx - 28}
                y={cy - 28}
                width={56}
                height={56}
                clipPath="circle(28px at 50% 50%)"
                preserveAspectRatio="xMidYMid slice"
              />
            ) : (
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fill="#e2e8f0"
                fontSize={11}
                fontWeight={600}
              >
                ID
              </text>
            )}
            <text
              x={cx}
              y={cy + 52}
              textAnchor="middle"
              fill="#cbd5e1"
              fontSize={11}
            >
              {graph.centerLabel.length > 28
                ? `${graph.centerLabel.slice(0, 28)}…`
                : graph.centerLabel}
            </text>
          </g>

          {domainPositions.map(({ domain, x, y, angle }) => (
            <g key={`domain-${domain.domain}`}>
              <circle
                cx={x}
                cy={y}
                r={selectedDomain === domain.domain ? 18 : 15}
                fill="#10233d"
                stroke={
                  selectedDomain === domain.domain ? "#22d3ee" : "#60a5fa"
                }
                strokeWidth={selectedDomain === domain.domain ? 2 : 1.4}
                className="cursor-pointer"
                onClick={() =>
                  onSelectDomain(
                    selectedDomain === domain.domain ? null : domain.domain,
                  )
                }
                role="button"
                tabIndex={0}
                aria-label={`Filter by domain ${domain.domain}`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectDomain(
                      selectedDomain === domain.domain ? null : domain.domain,
                    );
                  }
                }}
              />
              <text
                x={x}
                y={y + 30}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={9}
              >
                {domain.domain.length > 18
                  ? `${domain.domain.slice(0, 18)}…`
                  : domain.domain}
              </text>
              {domain.findings.map((finding, findingIndex) => {
                const spread =
                  ((findingIndex - (domain.findings.length - 1) / 2) * 0.22);
                const fx = cx + Math.cos(angle + spread) * findingRadius;
                const fy = cy + Math.sin(angle + spread) * findingRadius;
                const selected = selectedFindingId === finding.id;
                return (
                  <g key={finding.id}>
                    <circle
                      cx={fx}
                      cy={fy}
                      r={selected ? 9 : 7}
                      fill={nodeColor(finding.classification)}
                      stroke={selected ? "#fff" : "rgba(255,255,255,0.35)"}
                      strokeWidth={selected ? 2 : 1}
                      className="cursor-pointer"
                      onClick={() => onSelectFinding(finding.id)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open finding ${finding.title}`}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectFinding(finding.id);
                        }
                      }}
                    />
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      {/* Accessible / mobile fallback */}
      <div className="md:hidden">
        <p className="mb-2 text-[11px] text-slate-400">
          Domain list fallback for smaller screens.
        </p>
        <ul className="space-y-2">
          {visible.domains.map((domain) => (
            <li
              key={domain.domain}
              className="rounded-lg border border-white/10 bg-black/20 p-3"
            >
              <button
                type="button"
                className="text-left text-sm font-medium text-cyan-300"
                onClick={() =>
                  onSelectDomain(
                    selectedDomain === domain.domain ? null : domain.domain,
                  )
                }
              >
                {domain.domain}
              </button>
              <div className="mt-1 text-[11px] text-slate-400">
                {domain.verifiedCount} verified · {domain.probableCount} probable
              </div>
              <ul className="mt-2 space-y-1">
                {domain.findings.map((finding) => (
                  <li key={finding.id}>
                    <button
                      type="button"
                      className="text-left text-[12px] text-slate-200 underline-offset-2 hover:underline"
                      onClick={() => onSelectFinding(finding.id)}
                    >
                      {finding.title}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 hidden md:block">
        <details className="rounded border border-white/10 bg-black/20 p-2 text-[12px] text-slate-300">
          <summary className="cursor-pointer text-slate-400">
            Accessible domain and finding list
          </summary>
          <ul className="mt-2 space-y-2">
            {visible.domains.map((domain) => (
              <li key={`a11y-${domain.domain}`}>
                <button
                  type="button"
                  className="font-medium text-cyan-300"
                  onClick={() => onSelectDomain(domain.domain)}
                >
                  {domain.domain}
                </button>
                <ul className="ml-3 mt-1 list-disc space-y-1">
                  {domain.findings.map((finding) => (
                    <li key={`a11y-${finding.id}`}>
                      <button
                        type="button"
                        onClick={() => onSelectFinding(finding.id)}
                        className="text-left hover:underline"
                      >
                        {finding.title} ({finding.classification.replace(/_/g, " ")})
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
