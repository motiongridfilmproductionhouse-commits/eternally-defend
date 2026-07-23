import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, LayoutDashboard, Users, FileText, IndianRupee, Wallet, Megaphone, LogOut } from "lucide-react";

export const Route = createFileRoute("/_partner")({
  ssr: false,
  component: PartnerLayout,
});

const NAV = [
  { to: "/partner", label: "Dashboard", icon: LayoutDashboard },
  { to: "/partner/clients", label: "Clients & Leads", icon: Users },
  { to: "/partner/proposals", label: "Proposals", icon: FileText },
  { to: "/partner/commissions", label: "Commissions", icon: IndianRupee },
  { to: "/partner/payments", label: "Payments", icon: Wallet },
  { to: "/partner/marketing", label: "Marketing", icon: Megaphone },
] as const;

function PartnerLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return navigate({ to: "/auth" });
      const { data: partner } = await supabase.from("partner_profiles").select("partner_id, status").eq("user_id", session.session.user.id).maybeSingle();
      if (!partner || partner.status !== "ACTIVE") return navigate({ to: "/partner-status" });
      setReady(true);
    })();
  }, [navigate]);

  if (!ready) return <div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 w-60 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <Link to="/partner" className="flex items-center gap-2">
            <div className="size-8 rounded-lg grid place-items-center text-white" style={{ background: "linear-gradient(135deg,#1037A6,#1E5EFF)" }}>
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <div className="font-semibold text-sm">Eterna Partner</div>
              <div className="text-[10px] tracking-wider text-slate-400 uppercase">Portal</div>
            </div>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => {
            const active = pathname === n.to || (n.to !== "/partner" && pathname.startsWith(n.to));
            return (
              <Link key={n.to} to={n.to} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${active ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-100"}`}>
                <n.icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}
          className="m-3 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 px-3 py-2"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </aside>
      <main className="ml-60 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
