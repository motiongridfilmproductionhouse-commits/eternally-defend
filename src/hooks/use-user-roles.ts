import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";

export type AppRole = "admin" | "super_admin" | "analyst" | "user";

export function useUserRoles() {
  const { session, ready: sessionReady } = useSession();
  const [roles, setRoles] = useState<AppRole[] | null>(null);

  useEffect(() => {
    if (!sessionReady) return;
    if (!session) {
      setRoles([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .then(({ data }) => {
        if (cancelled) return;
        setRoles(((data ?? []) as Array<{ role: AppRole }>).map((r) => r.role));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionReady, session]);

  const ready = sessionReady && roles !== null;
  const isAdmin = (roles ?? []).some((r) => r === "admin" || r === "super_admin");
  const isSuperAdmin = (roles ?? []).some((r) => r === "super_admin");
  return { roles: roles ?? [], ready, isAdmin, isSuperAdmin, session };
}
