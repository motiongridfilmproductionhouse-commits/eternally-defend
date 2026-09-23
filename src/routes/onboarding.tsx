import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getProgress } from "@/lib/onboarding/progress.functions";
import { getMyPreEnrollmentSummary } from "@/lib/prospect/client-package.functions";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { ExitOnboardingButton } from "@/components/onboarding/ExitOnboardingButton";
import { Loader2 } from "lucide-react";

// Demo bypass — same constants as _app.tsx (module-level, tree-shaken in prod when false)
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const DEMO_USER_EMAIL = (import.meta.env.VITE_DEMO_USER_EMAIL ?? "").trim().toLowerCase();

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Onboarding — Eterna Sentinel" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Demo bypass: send demo account straight to the dashboard.
    if (DEMO_MODE && DEMO_USER_EMAIL && data.user.email?.toLowerCase() === DEMO_USER_EMAIL) {
      throw redirect({ to: "/dashboard" });
    }

    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_completed")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (profile?.onboarding_completed)
      throw redirect({ to: "/dashboard", search: { onboarding: "complete" } as never });
    return { user: data.user };
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const fetchProgress = useServerFn(getProgress);
  const q = useQuery({ queryKey: ["onboarding-progress"], queryFn: () => fetchProgress() });
  const fetchPreEnrollment = useServerFn(getMyPreEnrollmentSummary);
  const pre = useQuery({
    queryKey: ["pre-enrollment-summary"],
    queryFn: () => fetchPreEnrollment(),
    enabled: !q.isLoading,
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-[#050A18] text-white/70 text-sm gap-2">
        <ExitOnboardingButton />
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading secure onboarding…
        </div>
      </div>
    );
  }

  return (
    <>
      <ExitOnboardingButton />
      {pre.data?.delivered ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-40 w-[min(560px,calc(100%-32px))] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0B1224]/95 px-4 py-3 text-xs leading-relaxed text-white/75 shadow-lg"
        >
          Your profile was pre-filled from Eterna&apos;s pre-enrollment review — please check and
          confirm each detail.
          {pre.data.findings.length
            ? ` ${pre.data.findings.length} verified finding${pre.data.findings.length === 1 ? "" : "s"} will be available for your review.`
            : ""}
        </div>
      ) : null}
      <OnboardingWizard initialProgress={q.data ?? null} />
    </>
  );
}
