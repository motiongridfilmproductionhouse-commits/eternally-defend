import { createFileRoute } from "@tanstack/react-router";
import { CommandCenter } from "@/components/command/CommandCenter";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

function DashboardPage() {
  return <CommandCenter />;
}
