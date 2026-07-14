import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getOnboardingState } from "@/lib/onboarding.functions";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({ meta: [{ title: "Onboarding — Eterna AI" }] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_completed")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (profile?.onboarding_completed) throw redirect({ to: "/", search: { onboarding: "complete" } as never });
    return { user: data.user };
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const fetchState = useServerFn(getOnboardingState);
  const q = useQuery({ queryKey: ["onboarding-state"], queryFn: () => fetchState() });

  return (
    <div className="min-h-screen bg-background">
      {q.isLoading || !q.data ? (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading onboarding…
        </div>
      ) : (
        <OnboardingWizard initial={q.data} />
      )}
    </div>
  );
}
