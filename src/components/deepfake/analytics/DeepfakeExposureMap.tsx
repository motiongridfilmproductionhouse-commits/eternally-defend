import { useMemo, useState } from "react";
import { Globe, MapPin, ShieldAlert, Info, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { ClientFinding } from "@/lib/deepfake/results-dashboard";
import { buildSourceIntelligenceList, type SourceIntelligence } from "@/lib/deepfake/analytics-helpers";
import { Badge } from "@/components/ui/badge";

interface Props {
  findings: ClientFinding[];
  selectedDomain?: string | null;
  onSelectDomain?: (domain: string | null) => void;
}

export function DeepfakeExposureMap({ findings, selectedDomain, onSelectDomain }: Props) {
  const sources = useMemo(() => buildSourceIntelligenceList(findings), [findings]);

  // Group by country/location for map nodes
  const mapNodes = useMemo(() => {
    const nodeMap = new Map<
      string,
      {
        country: string;
        countryName: string;
        countryFlag: string;
        x: number;
        y: number;
        totalFindings: number;
        verifiedCount: number;
        probableCount: number;
        domains: SourceIntelligence[];
      }
    >();

    let unlocatedCount = 0;

    for (const source of sources) {
      if (source.geo.country && source.geo.mapPoint) {
        const key = source.geo.country;
        const existing = nodeMap.get(key) || {
          country: source.geo.country,
          countryName: source.geo.countryName || source.geo.country,
          countryFlag: source.geo.countryFlag,
          x: source.geo.mapPoint.x,
          y: source.geo.mapPoint.y,
          totalFindings: 0,
          verifiedCount: 0,
          probableCount: 0,
          domains: [],
        };

        existing.totalFindings += source.totalFindings;
        existing.verifiedCount += source.verifiedCount;
        existing.probableCount += source.probableCount;
        existing.domains.push(source);
        nodeMap.set(key, existing);
      } else {
        unlocatedCount += source.totalFindings;
      }
    }

    return {
      nodes: Array.from(nodeMap.values()),
      unlocatedCount,
      locatedSourcesCount: Array.from(nodeMap.values()).reduce((acc, n) => acc + n.domains.length, 0),
      totalCountries: nodeMap.size,
    };
  }, [sources]);

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  return (
    <section className="card-surface p-5 rounded-2xl border border-border/80 bg-card text-foreground space-y-4">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl grid place-items-center bg-primary/10 border border-primary/20 text-primary">
            <Globe className="size-5" />
          </div>
          <div>
            <div className="text-[10px] tracking-[0.2em] font-semibold text-muted-foreground uppercase">
              GEOGRAPHIC EXPOSURE MAP
            </div>
            <h3 className="text-sm font-bold text-foreground">Verified Infrastructure & Source Concentration</h3>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs bg-secondary/30 border-border/60">
            {mapNodes.totalCountries} Regions Identified
          </Badge>
          <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
            {mapNodes.locatedSourcesCount} Geolocated Hosts
          </Badge>
          <div className="flex items-center gap-1 border border-border/60 rounded-lg p-0.5 bg-background">
            <button
              onClick={() => setZoomLevel((z) => Math.min(1.8, z + 0.2))}
              className="size-7 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition"
              title="Zoom In"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel((z) => Math.max(1, z - 0.2))}
              className="size-7 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition"
              title="Zoom Out"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="size-7 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition"
              title="Reset Zoom"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* SVG Map Container */}
      <div className="relative aspect-[2.1/1] w-full overflow-hidden rounded-xl border border-border/60 bg-[#07111f]">
        {/* Background Grid Lines */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, #38bdf8 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Dynamic Zooming Wrapper */}
        <div
          className="relative size-full transition-transform duration-300 ease-out"
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: "center center" }}
        >
          {/* Simple Dotted Equirectangular Map Vector Overlay */}
          <svg className="absolute inset-0 size-full opacity-30" viewBox="0 0 100 50" preserveAspectRatio="none">
            {/* World Continent Guides */}
            <path
              fill="none"
              stroke="#38bdf8"
              strokeWidth="0.3"
              strokeDasharray="1 1"
              d="M15 15 Q25 10 35 15 T45 25 T30 40 T15 30 Z M45 12 Q60 10 75 15 T85 28 T65 35 T50 25 Z M78 30 Q85 30 90 38 T82 45 T75 38 Z"
            />
          </svg>

          {/* Interactive Geo Nodes */}
          {mapNodes.nodes.map((node) => {
            const isHovered = hoveredNode === node.country;
            const isSelected = node.domains.some((d) => d.domain === selectedDomain);
            const size = Math.min(28, Math.max(14, 12 + node.totalFindings * 3));

            return (
              <div
                key={node.country}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10 group"
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                onMouseEnter={() => setHoveredNode(node.country)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => {
                  if (onSelectDomain && node.domains.length > 0) {
                    onSelectDomain(node.domains[0].domain);
                  }
                }}
              >
                {/* Glowing Pulse Ring */}
                <span
                  className={`absolute inset-0 rounded-full animate-ping opacity-50 ${
                    isSelected ? "bg-red-500" : "bg-sky-400"
                  }`}
                  style={{ animationDuration: "2.5s" }}
                />

                {/* Main Node Point */}
                <div
                  className={`relative grid place-items-center rounded-full border shadow-lg transition-all duration-200 ${
                    isSelected
                      ? "bg-red-500 border-white text-white scale-125"
                      : isHovered
                        ? "bg-sky-400 border-white text-slate-950 scale-110"
                        : "bg-sky-500/80 border-sky-300/60 text-slate-950"
                  }`}
                  style={{ width: `${size}px`, height: `${size}px` }}
                >
                  <span className="text-[10px] font-black">{node.totalFindings}</span>
                </div>

                {/* Floating Tooltip Card */}
                {(isHovered || isSelected) && (
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 p-2.5 rounded-lg border border-border/80 bg-slate-900/95 text-slate-100 shadow-2xl z-30 pointer-events-none backdrop-blur-md">
                    <div className="flex items-center justify-between gap-1 text-xs font-bold border-b border-border/40 pb-1.5 mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <span>{node.countryFlag}</span> {node.countryName}
                      </span>
                      <Badge variant="outline" className="text-[9px] border-sky-400/40 text-sky-300">
                        {node.totalFindings} Threat{node.totalFindings === 1 ? "" : "s"}
                      </Badge>
                    </div>

                    <div className="space-y-1 text-[11px]">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Verified Deepfakes:</span>
                        <span className="font-semibold text-red-400">{node.verifiedCount}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Probable Deepfakes:</span>
                        <span className="font-semibold text-amber-400">{node.probableCount}</span>
                      </div>
                      <div className="text-[10px] text-sky-300/80 pt-1 border-t border-border/40 space-y-0.5">
                        <div className="truncate font-semibold">
                          Signal: {node.domains[0]?.geo.locationSignal === "VERIFIED_HOST_INFRASTRUCTURE" ? "Verified Host Datacenter" : "TLD Country Namespace Signal"}
                        </div>
                        <div className="truncate opacity-80">
                          Hosts: {node.domains.map((d) => d.domain).join(", ")}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Overlay Info Legend & Empty State */}
        {mapNodes.nodes.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground bg-background/50 backdrop-blur-sm p-4 text-center">
            <div className="space-y-1">
              <Info className="size-6 mx-auto text-muted-foreground/60" />
              <div>No geolocated infrastructure found for qualifying target findings.</div>
              <div className="text-[11px] opacity-75">Geographic exposure maps locations with confirmed host or TLD metadata.</div>
            </div>
          </div>
        ) : (
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 text-[10px] text-muted-foreground bg-slate-900/80 p-2 rounded-lg border border-border/40 backdrop-blur-sm flex-wrap">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-sky-400 animate-pulse" /> Geolocated Host Node
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-red-500" /> Active Selected Filter
              </span>
            </div>

            {mapNodes.unlocatedCount > 0 && (
              <div className="text-muted-foreground flex items-center gap-1">
                <ShieldAlert className="size-3 text-amber-400" />
                <span>{mapNodes.unlocatedCount} findings hosted on obfuscated global CDNs</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
