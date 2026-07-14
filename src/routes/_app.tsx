import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/dashboard/TopBar";
import { supabase } from "@/integrations/supabase/client";
import { SidebarLayoutProvider, useSidebarLayout } from "@/lib/layout-context";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_completed")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (!profile?.onboarding_completed) throw redirect({ to: "/onboarding" });

    return { user: data.user };
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <SidebarLayoutProvider>
      <AppShell />
    </SidebarLayoutProvider>
  );
}

function AppShell() {
  const { hidden } = useSidebarLayout();
  return (
    <div className="min-h-screen flex bg-background">
      {!hidden && <Sidebar />}
      <main className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        <div className="flex-1 px-8 pt-8 pb-10 min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
