import { createFileRoute } from "@tanstack/react-router";
import { CommandCenter } from "@/components/command/CommandCenter";
import { CelebrityHome } from "@/components/celebrity/CelebrityHome";
import { PendingSetupCard } from "@/components/dashboard/PendingSetupCard";
import { VerifyProfileCard } from "@/components/verification/VerifyProfileCard";
import { ProtectionAutopilotCard } from "@/components/protection/ProtectionAutopilotCard";
import { ProtectionInbox } from "@/components/protection/ProtectionInbox";
import { useVerificationStatus } from "@/hooks/use-verification-status";
import { workspaceModeFor } from "@/lib/workspace/workspace-nav";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { accountType, loading } = useVerificationStatus();
  const mode = workspaceModeFor(accountType);

  if (!loading && mode === "celebrity") {
    return (
      <div className="space-y-4">
        <VerifyProfileCard />
        <ProtectionAutopilotCard />
        <CelebrityHome />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PendingSetupCard />
      <VerifyProfileCard />
      <ProtectionAutopilotCard />
      <CommandCenter />
    </div>
  );
}
