import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/dashboard/TopBar";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Onboarding gate — allow the onboarding route and settings (for sign-out).
    const path = location.pathname;
    const allow = path.startsWith("/onboarding") || path.startsWith("/settings");
    if (!allow) {
      const { data: profile } = await supabase
        .from("client_profiles")
        .select("onboarding_completed")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (!profile?.onboarding_completed) {
        throw redirect({ to: "/onboarding" });
      }
    }
    return { user: data.user };
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        <div className="flex-1 px-6 pb-6 min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

