import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUserRoles } from "@/hooks/use-user-roles";
import { ShieldAlert } from "lucide-react";

/** Admins, super admins and staff may issue account invitations. */
export function InviteManagerGuard({ children }: { children: React.ReactNode }) {
  const { ready, isAdmin, isStaff, session } = useUserRoles();
  const navigate = useNavigate();
  const allowed = isAdmin || isStaff;

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      navigate({ to: "/auth" });
      return;
    }
    if (!allowed) navigate({ to: "/dashboard" });
  }, [ready, allowed, session, navigate]);

  if (!ready) {
    return <div className="p-8 text-sm text-muted-foreground">Verifying access…</div>;
  }
  if (!allowed) {
    return (
      <div className="p-8 text-center">
        <ShieldAlert className="size-10 mx-auto text-amber-500" />
        <p className="mt-3 text-sm font-semibold">Access required</p>
        <p className="mt-1 text-xs text-muted-foreground">Redirecting…</p>
      </div>
    );
  }
  return <>{children}</>;
}
