import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStaffAccess } from "@/lib/prospect/scan.functions";
import "@/components/staff/staff.css";

/**
 * Staff Pre-Enrollment Intelligence — access boundary.
 * Signed-in session required (client redirect) AND the staff role, which the
 * server checks via is_prospect_staff. Every server function re-checks it and
 * database RLS enforces it a third time.
 */
export const Route = createFileRoute("/staff")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Identity Intelligence — Eterna Staff" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: StaffLayout,
});

function StaffLayout() {
  const access = useServerFn(getStaffAccess);
  const q = useQuery({
    queryKey: ["staff-access"],
    queryFn: () => access(),
    staleTime: 60_000,
    retry: 1,
  });

  if (q.isLoading) return <div className="sx" />;
  if (q.isError || !q.data?.isStaff) {
    return (
      <div className="sx" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <div className="sx-eyebrow">Restricted</div>
          <h1 className="sx-display" style={{ fontSize: 26, margin: "10px 0 8px" }}>
            Staff access required
          </h1>
          <p style={{ color: "var(--sx-muted)", fontSize: 14, lineHeight: 1.6 }}>
            The Identity Intelligence Scan is available to authorised Eterna staff accounts only.
          </p>
          <Link to="/dashboard" className="sx-btn" style={{ marginTop: 16 }}>
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="sx">
      <Outlet />
    </div>
  );
}
