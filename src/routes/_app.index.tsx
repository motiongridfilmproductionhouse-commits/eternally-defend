import { createFileRoute } from "@tanstack/react-router";
import { StatsRow } from "@/components/dashboard/StatsRow";
import { ThreatMap } from "@/components/dashboard/ThreatMap";
import { AIThreatTimeline } from "@/components/dashboard/AIThreatTimeline";
import { ReputationPulse } from "@/components/dashboard/ReputationPulse";
import { PlatformIntelligence } from "@/components/dashboard/PlatformIntelligence";
import { AIExposureIndex } from "@/components/dashboard/AIExposureIndex";
import { UnauthorizedUsage } from "@/components/dashboard/UnauthorizedUsage";
import { DeepfakeIntelligence } from "@/components/dashboard/DeepfakeIntelligence";
import { TopActiveThreats } from "@/components/dashboard/TopActiveThreats";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="min-w-0">
      {/* Dark zone — hero stats & global map */}
      <section className="relative dark-zone px-8 pt-8 pb-10 space-y-5">
        <div className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(600px 300px at 15% 0%, rgba(30,123,255,0.18), transparent 60%), radial-gradient(500px 260px at 85% 20%, rgba(168,85,247,0.14), transparent 65%)",
          }}
        />
        <div className="relative space-y-5">
          <StatsRow />
          <ThreatMap />
        </div>
      </section>

      {/* Light zone — analysis & intelligence */}
      <section className="px-8 pt-8 pb-12 space-y-5 bg-background">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <AIThreatTimeline />
          <ReputationPulse />
          <PlatformIntelligence />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          <AIExposureIndex />
          <UnauthorizedUsage />
          <DeepfakeIntelligence />
          <TopActiveThreats />
        </div>
      </section>
    </div>
  );
}
