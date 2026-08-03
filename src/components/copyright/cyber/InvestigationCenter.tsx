import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicSuspiciousSource } from "@/lib/copyright/suspicious-sources";
import {
  activityCountersFromStats,
  filterDisplayableActivity,
  parseWebsiteActivity,
  sortActivityNewestFirst,
} from "@/lib/copyright/scan-activity";
import { sourceRole, type DomainIntel } from "@/lib/copyright/domain-intel";
import { CyberRadar } from "@/components/copyright/cyber/CyberRadar";
import { ThreatWorldMap, type ThreatMapNode } from "@/components/copyright/cyber/ThreatWorldMap";
import { InvestigationTimeline } from "@/components/copyright/cyber/InvestigationTimeline";
import { ThreatGauge } from "@/components/copyright/cyber/ThreatGauge";
import { ThreatAlertOverlay } from "@/components/copyright/cyber/ThreatAlertOverlay";
import { DomainIntelCard } from "@/components/copyright/cyber/DomainIntelCard";
import { EvidenceCollectionTicker } from "@/components/copyright/cyber/EvidenceCollectionTicker";

export type InvestigationCenterProps = {
  scanId: string | null;
  scanStatus: string | null;
  scanStartedAt?: string | null;
  workTitle: string;
  stats: Record<string, unknown> | null | undefined;
  sources: PublicSuspiciousSource[];
  onReview?: (matchId: string) => void;
  onDismiss?: (matchId: string) => void;
};

const CONFIRMED_STATES = new Set(["new_confirmed", "historical_reconfirmed"]);

/** Futuristic real-time investigation center for Copyright Intelligence. */
export function InvestigationCenter({
  scanId,
  scanStatus,
  scanStartedAt,
  workTitle,
  stats,
  sources,
  onReview,
  onDismiss,
}: InvestigationCenterProps) {
  const scanning =
    scanStatus === "queued" || scanStatus === "running" || scanStatus === "pending";
  // Radar, timeline and map only ever receive verified distribution findings.
  const events = useMemo(
    () => filterDisplayableActivity(sortActivityNewestFirst(parseWebsiteActivity(stats))),
    [stats],
  );
  const counters = activityCountersFromStats(stats);

  const [soundEnabled, setSoundEnabled] = useState(false);
  const [alertSource, setAlertSource] = useState<PublicSuspiciousSource | null>(null);
  const [intelByUrl, setIntelByUrl] = useState<Record<string, DomainIntel>>({});
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    seenRef.current = null;
    setIntelByUrl({});
    setAlertSource(null);
  }, [scanId]);

  useEffect(() => {
    const confirmed = sources.filter((s) => CONFIRMED_STATES.has(s.source_state));
    // Seed the baseline from the first non-empty payload so already-known
    // findings from a finished scan never trigger a retroactive siren.
    if (seenRef.current === null) {
      if (!confirmed.length && !scanning) return;
      seenRef.current = new Set(confirmed.map((s) => s.id));
      return;
    }
    const fresh = confirmed.find((s) => !seenRef.current!.has(s.id));
    for (const s of confirmed) seenRef.current.add(s.id);
    if (fresh && scanning) setAlertSource(fresh);
  }, [sources, scanning, scanStatus]);

  const collectIntel = useCallback((intel: DomainIntel) => {
    setIntelByUrl((prev) => (prev[intel.url] ? prev : { ...prev, [intel.url]: intel }));
  }, []);

  const mapNodes: ThreatMapNode[] = useMemo(
    () =>
      Object.values(intelByUrl).map((intel) => ({
        id: intel.url,
        domain: intel.domain,
        country: intel.investigation.country,
        role: sourceRole({
          domain: intel.domain,
          embeddedPlayers: intel.investigation.embeddedPlayers,
          downloadLinks: intel.investigation.downloadLinks,
          isMirrorDomain: intel.mirrorDomains.length > 0,
        }),
        threatScore: intel.investigation.threatScore,
        hostingProvider: intel.investigation.hostingProvider,
        cdn: intel.investigation.cdn,
      })),
    [intelByUrl],
  );

  const aggregateThreat = useMemo(() => {
    const scores = [
      ...Object.values(intelByUrl).map((i) => i.investigation.threatScore),
      ...sources.map((s) => s.confidence ?? 0),
    ].filter((n) => n > 0);
    if (!scores.length) return 0;
    return Math.round(Math.max(...scores));
  }, [intelByUrl, sources]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radio className={`h-4 w-4 text-sky-300 ${scanning ? "animate-pulse" : ""}`} />
          <h3 className="text-sm font-semibold">
            Investigation center {workTitle ? `· ${workTitle}` : ""}
          </h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSoundEnabled((s) => !s)}
          aria-pressed={soundEnabled}
        >
          {soundEnabled ? (
            <Volume2 className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <VolumeX className="mr-1.5 h-3.5 w-3.5" />
          )}
          Alert sound {soundEnabled ? "on" : "off"}
        </Button>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <CyberRadar
          events={events}
          scanning={scanning}
          counters={[
            { label: "Sites checked", value: counters.websites_checked },
            { label: "Candidate pages", value: counters.candidate_pages },
            { label: "Potential threats", value: counters.potential_threats },
            { label: "Verified findings", value: counters.verified_findings },
          ]}
        />
        <div className="cyber-panel grid place-items-center rounded-2xl p-5">
          <ThreatGauge
            score={aggregateThreat}
            size={168}
            caption={
              sources.length
                ? `${sources.length} source${sources.length === 1 ? "" : "s"} under investigation`
                : scanning
                  ? "Sweep in progress"
                  : "No active threats"
            }
          />
          <div className="mt-3 w-full">
            <EvidenceCollectionTicker active={scanning} compact />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ThreatWorldMap nodes={mapNodes} />
        <InvestigationTimeline events={events} scanStartedAt={scanStartedAt ?? null} />
      </div>

      <section className="space-y-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Detected sources · domain intelligence
        </h4>
        {!sources.length ? (
          <p className="cyber-panel rounded-2xl p-5 text-xs text-slate-400">
            {scanning
              ? "No unauthorized sources confirmed yet — the radar is still sweeping."
              : "No detected sources for this scan."}
          </p>
        ) : (
          sources.map((source) => (
            <div key={source.id} data-source-anchor={source.id}>
              <DomainIntelCard
                url={source.url}
                domain={source.domain}
                workTitle={workTitle}
                classification={source.detection_type ?? source.classification}
                confidence={source.confidence}
                matchId={source.id}
                firstSeen={source.last_verified_at}
                lastVerified={source.last_verified_at}
                onIntel={collectIntel}
                onMarkResolved={onDismiss}
                onEscalate={onReview}
              />
            </div>
          ))
        )}
      </section>

      <ThreatAlertOverlay
        open={!!alertSource}
        domain={alertSource?.domain ?? alertSource?.url ?? null}
        url={alertSource?.url ?? null}
        workTitle={workTitle}
        riskLabel={
          (alertSource?.confidence ?? 0) >= 90
            ? "Critical Risk"
            : (alertSource?.confidence ?? 0) >= 70
              ? "High Risk"
              : "Elevated Risk"
        }
        soundEnabled={soundEnabled}
        onClose={() => setAlertSource(null)}
        onInvestigate={() => {
          const el = document.querySelector(`[data-source-anchor="${alertSource?.id}"]`);
          setAlertSource(null);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
      />
    </div>
  );
}

export default InvestigationCenter;
