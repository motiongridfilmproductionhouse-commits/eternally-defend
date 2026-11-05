import { createFileRoute } from "@tanstack/react-router";
import { CommandCenter } from "@/components/command/CommandCenter";
import { CelebrityHome } from "@/components/celebrity/CelebrityHome";
import { PendingSetupCard } from "@/components/dashboard/PendingSetupCard";
import { VerifyProfileCard } from "@/components/verification/VerifyProfileCard";
import { ProtectionAutopilotCard } from "@/components/protection/ProtectionAutopilotCard";
import { EipDashboardCard } from "@/components/eip/EipDashboardCard";
import { ProtectionInbox } from "@/components/protection/ProtectionInbox";
import { useVerificationStatus } from "@/hooks/use-verification-status";
import { workspaceModeFor } from "@/lib/workspace/workspace-nav";
import { TemporaryRemovalStatus } from "@/components/dashboard/TemporaryRemovalStatus";
import { shouldShowRafmohNotice } from "@/lib/removal-status-notice";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [
    { title: "Protection Dashboard | Eterna Sentinel" },
    { name: "description", content: "Your private Eterna Sentinel protection dashboard and removal status." },
    { property: "og:title", content: "Protection Dashboard | Eterna Sentinel" },
    { property: "og:description", content: "Your private Eterna Sentinel protection workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const showStatusNotice = shouldShowRafmohNotice(user.email);
  const { accountType, loading } = useVerificationStatus();
  const mode = workspaceModeFor(accountType);

  if (!loading && mode === "celebrity") {
    return (
      <div className="space-y-4">
        {showStatusNotice && <TemporaryRemovalStatus />}
        <VerifyProfileCard />
        <ProtectionAutopilotCard />
        <ProtectionInbox />
        <EipDashboardCard />
        <CelebrityHome />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showStatusNotice && <TemporaryRemovalStatus />}
      <PendingSetupCard />
      <VerifyProfileCard />
      <ProtectionAutopilotCard />
      <ProtectionInbox />
      <EipDashboardCard />
      <CommandCenter />
    </div>
  );
}
