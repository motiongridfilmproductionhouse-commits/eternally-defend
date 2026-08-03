import { useMemo } from "react";
import { Globe2 } from "lucide-react";
import { countryFlag, countryToMapPoint, type SourceRole } from "@/lib/copyright/domain-intel";

export type ThreatMapNode = {
  id: string;
  domain: string;
  country: string | null;
  role: SourceRole;
  threatScore: number;
  hostingProvider: string | null;
  cdn: string | null;
};

export type ThreatWorldMapProps = {
  nodes: ThreatMapNode[];
};

const ROLE_TONE: Record<SourceRole, string> = {
  Origin: "bg-red-500",
  Mirror: "bg-orange-400",
  "Re-upload": "bg-amber-300",
  "Embedded Player": "bg-sky-400",
};

/** Live world map: each detected source is a glowing node with connection lines. */
export function ThreatWorldMap({ nodes }: ThreatWorldMapProps) {
  const placed = useMemo(
    () =>
      nodes
        .map((node) => {
          const point = countryToMapPoint(node.country);
          return point ? { ...node, ...point } : null;
        })
        .filter((n): n is ThreatMapNode & { x: number; y: number } => n !== null),
    [nodes],
  );

  const origin = placed.find((n) => n.role === "Origin") ?? placed[0] ?? null;

  return (
    <section className="cyber-panel relative overflow-hidden rounded-2xl p-5">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-sky-400/40 bg-sky-500/10">
          <Globe2 className="h-4 w-4 text-sky-300" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Visual threat map</h3>
          <p className="text-[11px] text-sky-300/80">
            {placed.length
              ? `${placed.length} located source${placed.length === 1 ? "" : "s"} · hosting, CDN and mirror relationships`
              : "Awaiting geolocated detections"}
          </p>
        </div>
      </header>

      <div className="relative mt-4 aspect-[2/1] w-full overflow-hidden rounded-xl border border-sky-400/20 bg-slate-950/70">
        <div className="pointer-events-none absolute inset-0 cyber-grid opacity-50" />
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 50"
          preserveAspectRatio="none"
          aria-hidden
        >
          {origin &&
            placed
              .filter((n) => n.id !== origin.id)
              .map((n) => (
                <line
                  key={`line-${n.id}`}
                  x1={origin.x}
                  y1={origin.y / 2}
                  x2={n.x}
                  y2={n.y / 2}
                  stroke="rgba(56,189,248,0.35)"
                  strokeWidth="0.25"
                  strokeDasharray="1.4 1.2"
                  className="cyber-link-line"
                />
              ))}
        </svg>

        {placed.map((node, i) => (
          <div
            key={node.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            <span
              className={`block h-2.5 w-2.5 rounded-full ${ROLE_TONE[node.role]} cyber-node-pulse`}
              style={{ animationDelay: `${(i % 6) * 180}ms` }}
              aria-hidden
            />
            <div className="pointer-events-none absolute left-4 top-[-6px] whitespace-nowrap rounded border border-sky-400/20 bg-slate-900/85 px-1.5 py-0.5 text-[9px] text-slate-200">
              {countryFlag(node.country)} {node.domain} · {node.role}
            </div>
          </div>
        ))}

        {!placed.length && (
          <p className="absolute inset-0 grid place-items-center text-xs text-slate-500">
            Detected sources appear here once hosting geolocation completes.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400">
        {(Object.keys(ROLE_TONE) as SourceRole[]).map((role) => (
          <span key={role} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${ROLE_TONE[role]}`} />
            {role}
          </span>
        ))}
      </div>
    </section>
  );
}

export default ThreatWorldMap;
