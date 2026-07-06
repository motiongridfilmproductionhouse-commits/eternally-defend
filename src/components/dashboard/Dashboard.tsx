import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { StatsRow } from "./StatsRow";
import { ThreatMap } from "./ThreatMap";
import { AIThreatTimeline } from "./AIThreatTimeline";
import { ReputationPulse } from "./ReputationPulse";
import { PlatformIntelligence } from "./PlatformIntelligence";
import { AIExposureIndex } from "./AIExposureIndex";
import { UnauthorizedUsage } from "./UnauthorizedUsage";
import { DeepfakeIntelligence } from "./DeepfakeIntelligence";
import { TopActiveThreats } from "./TopActiveThreats";
import { AIAssistant } from "./AIAssistant";

export default function Dashboard() {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        <div className="flex-1 flex gap-5 px-6 pb-6 min-w-0">
          <div className="flex-1 min-w-0 space-y-5">
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
          <AIAssistant />
        </div>
      </main>
    </div>
  );
}
