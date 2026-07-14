import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOnboardingState } from "@/lib/onboarding.functions";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const Route = createFileRoute("/_app/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding — Eterna AI" }] }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const fetchState = useServerFn(getOnboardingState);
  const q = useQuery({ queryKey: ["onboarding-state"], queryFn: () => fetchState() });
  if (q.isLoading || !q.data) return <div className="p-10 text-sm text-muted-foreground">Loading onboarding…</div>;
  return <OnboardingWizard initial={q.data} />;
}
