import { createFileRoute } from "@tanstack/react-router";
import { CommandCenter } from "@/components/command/CommandCenter";
import { PendingSetupCard } from "@/components/dashboard/PendingSetupCard";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div className="space-y-4">
      <PendingSetupCard />
      <CommandCenter />
    </div>
  );
}
