import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSession } from "@/hooks/use-session";
import { getProtectionSummary } from "@/lib/protection-summary.functions";

/**
 * Shared read for the account protection posture. Every surface that shows
 * asset / threat / case / enforcement counts must use this hook so the numbers
 * agree across the header, dashboard and command center.
 */
export function useProtectionSummary() {
  const fn = useServerFn(getProtectionSummary);
  const { session, ready } = useSession();
  return useQuery({
    queryKey: ["protection-summary", session?.user.id ?? "anon"],
    queryFn: () => fn(),
    enabled: ready && !!session,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
