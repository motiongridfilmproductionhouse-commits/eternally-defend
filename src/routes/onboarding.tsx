import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getOnboardingState } from "@/lib/onboarding.functions";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { ShieldHalf, Lock, Zap, FileCheck2 } from "lucide-react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({ meta: [{ title: "Onboarding — Eterna AI" }] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // If already completed, bounce to dashboard.
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
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,420px)_1fr]">
      {/* Brand panel */}
      <aside
        className="relative hidden lg:flex flex-col justify-between p-10 text-white overflow-hidden"
        style={{
          background:
            "radial-gradient(600px 400px at 20% -10%, oklch(0.42 0.18 260 / 0.85), transparent 55%), linear-gradient(160deg, oklch(0.18 0.05 265), oklch(0.13 0.04 265))",
        }}
      >
        <div className="flex items-center gap-3 relative z-10">
          <div className="size-11 rounded-xl grid place-items-center" style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}>
            <ShieldHalf className="size-6" />
          </div>
          <div>
            <div className="font-display font-bold text-lg leading-tight">Eterna AI</div>
            <div className="text-[10px] tracking-[0.24em] text-white/60 font-semibold">SECURITY CLOUD</div>
          </div>
        </div>

        <div className="relative z-10 max-w-sm">
          <h1 className="font-display text-4xl leading-[1.05] font-bold tracking-tight">Set up your protection profile</h1>
          <p className="mt-4 text-white/70 leading-relaxed text-sm">
            A short guided setup so Eterna can defend your identity, likeness and content across the open web with legally-binding authorization.
          </p>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              { icon: Lock, title: "Verified identity", sub: "Cryptographic ownership tied to you" },
              { icon: Zap, title: "AI enforcement", sub: "Automated detection and takedowns" },
              { icon: FileCheck2, title: "Signed authorization", sub: "PDF authorization record on file" },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <li key={f.title} className="flex gap-3">
                  <div className="size-9 rounded-lg grid place-items-center bg-white/8 border border-white/10 shrink-0">
                    <Icon className="size-4 text-brand-glow" />
                  </div>
                  <div>
                    <div className="font-semibold text-white">{f.title}</div>
                    <div className="text-white/60 text-xs">{f.sub}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="relative z-10 text-[11px] text-white/40 tracking-wider uppercase">
          SOC2 · GDPR · Enterprise-grade
        </div>

        {/* ambient glow */}
        <div className="absolute -bottom-24 -right-24 size-96 rounded-full opacity-30 blur-3xl" style={{ background: "var(--gradient-brand)" }} />
      </aside>

      {/* Wizard */}
      <main className="min-h-screen bg-background overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 lg:p-10">
          {q.isLoading || !q.data ? (
            <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground text-sm gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading onboarding…
            </div>
          ) : (
            <OnboardingWizard initial={q.data} />
          )}
        </div>
      </main>
    </div>
  );
}
