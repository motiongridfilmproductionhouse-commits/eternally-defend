import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/dashboard/TopBar";
import { supabase } from "@/integrations/supabase/client";
import { SidebarLayoutProvider, useSidebarLayout } from "@/lib/layout-context";

// ---------------------------------------------------------------------------
// DEMO MODE — UI/routing bypass (never fakes auth, KYC or legal data).
// Active only when VITE_DEMO_MODE=true AND authenticated email matches
// VITE_DEMO_USER_EMAIL. Remove or set VITE_DEMO_MODE=false to restore prod.
// ---------------------------------------------------------------------------
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const DEMO_USER_EMAIL = (import.meta.env.VITE_DEMO_USER_EMAIL ?? "").trim().toLowerCase();

function isDemoUser(email: string | undefined): boolean {
  return DEMO_MODE && !!DEMO_USER_EMAIL && !!email && email.toLowerCase() === DEMO_USER_EMAIL;
}

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Demo bypass: skip onboarding gate for the designated demo account only.
    if (isDemoUser(data.user.email)) {
      return { user: data.user, demoMode: true };
    }

    const { data: profile } = await supabase
      .from("client_profiles")
      .select("onboarding_completed")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (!profile?.onboarding_completed) throw redirect({ to: "/onboarding" });

    return { user: data.user, demoMode: false };
  },
  component: AppLayout,
  // A single failing panel used to bubble to the root boundary and blank the whole
  // app shell. Errors inside the workspace now render in place with a retry.
  errorComponent: WorkspaceError,
});

function WorkspaceError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="max-w-md w-full rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">This workspace page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground break-words">
          {error?.message || "Unexpected error"}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--gradient-brand)" }}
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

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
