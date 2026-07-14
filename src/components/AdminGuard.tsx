import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUserRoles } from "@/hooks/use-user-roles";
import { ShieldAlert } from "lucide-react";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { ready, isAdmin, session } = useUserRoles();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      navigate({ to: "/auth" });
      return;
    }
    if (!isAdmin) {
      navigate({ to: "/" });
    }
  }, [ready, isAdmin, session, navigate]);

  if (!ready) {
    return <div className="p-8 text-sm text-muted-foreground">Verifying access…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <ShieldAlert className="size-10 mx-auto text-amber-500" />
        <p className="mt-3 text-sm font-semibold">Admin access required</p>
        <p className="mt-1 text-xs text-muted-foreground">Redirecting…</p>
      </div>
    );
  }
  return <>{children}</>;
}
