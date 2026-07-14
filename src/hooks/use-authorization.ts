import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOnboardingState } from "@/lib/onboarding.functions";
import { useSession } from "./use-session";

export type AuthzLevel =
  | "monitoring"
  | "monitoring_evidence"
  | "monitoring_enforcement"
  | "full_protection";

export type AuthzStatus = "pending" | "authorized" | "enterprise_authorized";

export function useAuthorization() {
  const { session, ready } = useSession();
  const fetchState = useServerFn(getOnboardingState);
  const q = useQuery({
    queryKey: ["onboarding-state", session?.user.id ?? "anon"],
    queryFn: () => fetchState(),
    enabled: ready && !!session,
    staleTime: 30_000,
  });

  const profile = q.data?.profile ?? null;
  const level = (profile?.authorization_level ?? null) as AuthzLevel | null;
  const status = (profile?.authorization_status ?? "pending") as AuthzStatus;
  const completed = !!profile?.onboarding_completed;

  const rank: Record<AuthzLevel, number> = {
    monitoring: 1,
    monitoring_evidence: 2,
    monitoring_enforcement: 3,
    full_protection: 4,
  };
  const meets = (min: AuthzLevel) => (level ? rank[level] >= rank[min] : false);

  return {
    loading: q.isLoading,
    profile,
    state: q.data ?? null,
    completed,
    status,
    level,
    canMonitor: completed && meets("monitoring"),
    canCollectEvidence: completed && meets("monitoring_evidence"),
    canRequestEnforcement: completed && meets("monitoring_enforcement"),
    canTakedown: completed && meets("full_protection"),
    refetch: q.refetch,
  };
}
