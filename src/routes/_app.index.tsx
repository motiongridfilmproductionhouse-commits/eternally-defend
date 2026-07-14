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
    <div className="min-w-0 space-y-5">
      <StatsRow />
      <ThreatMap />
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
    </div>
  );
}
