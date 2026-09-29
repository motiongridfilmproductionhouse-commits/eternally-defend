import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ActionDrawer, type ActionTarget } from "@/components/scan/ActionDrawer";
import { getLatestRemovalVerificationRequest } from "@/lib/scan-actions.functions";

const DISMISSED_KEY = "eterna-removal-verification-prompt-dismissed";

export function RemovalVerificationPrompt() {
  const getLatest = useServerFn(getLatestRemovalVerificationRequest);
  const [open, setOpen] = useState(false);
  const requestQuery = useQuery({
    queryKey: ["latest-removal-verification-request"],
    queryFn: () => getLatest(),
    staleTime: 60_000,
  });

  useEffect(() => {
    const requestId = requestQuery.data?.id;
    if (!requestId || typeof window === "undefined") return;
    const dismissed = window.sessionStorage.getItem(DISMISSED_KEY);
    if (dismissed !== requestId) setOpen(true);
  }, [requestQuery.data?.id]);

  const request = requestQuery.data;
  if (!request) return null;

  const target: ActionTarget = {
    id: request.id,
    title: "Removal verification",
    url: request.target_url ?? "",
    source: request.platform ?? "Central System",
    platform: request.platform ?? "Central System",
    threatScore: null,
    evidenceCount: 0,
    status: request.status,
    requestId: request.id,
  };

  return (
    <ActionDrawer
      target={target}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && typeof window !== "undefined") {
          window.sessionStorage.setItem(DISMISSED_KEY, request.id);
        }
      }}
    />
  );
}