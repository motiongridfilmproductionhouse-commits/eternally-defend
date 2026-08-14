import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RadioTower, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getDiscoveryView,
  listProtectedAssetsForDiscovery,
  startAssetDiscovery,
} from "@/lib/discovery/asset-discovery.functions";
import { promoteCopyrightMatchesToCases } from "@/lib/cases/copyright-case-promotion.functions";
import { DiscoveryJobProgress } from "./DiscoveryJobProgress";
import { DiscoveryCandidateList } from "./DiscoveryCandidateList";
import { candidateState } from "@/lib/discovery/candidate-presentation";

/**
 * Reverse discovery workspace for a registered protected asset.
 *
 * Pipeline surfaced here: Protected asset -> reverse discovery -> candidate
 * verification -> copyright match (pending review) -> case. Nothing on this
 * screen sends a DMCA notice.
 */
export function AssetDiscoveryPanel({ scanId }: { scanId?: string | null }) {
  const qc = useQueryClient();
  const listAssetsFn = useServerFn(listProtectedAssetsForDiscovery);
  const viewFn = useServerFn(getDiscoveryView);
  const startFn = useServerFn(startAssetDiscovery);
  const promoteFn = useServerFn(promoteCopyrightMatchesToCases);

  const [assetId, setAssetId] = useState<string | null>(null);
  const [sendingMatchId, setSendingMatchId] = useState<string | null>(null);

  const assets = useQuery({
    queryKey: ["discovery-protected-assets"],
    queryFn: () => listAssetsFn(),
  });

  const selectedId = assetId ?? assets.data?.[0]?.id ?? null;
  const selected = assets.data?.find((a) => a.id === selectedId) ?? null;

  const view = useQuery({
    queryKey: ["asset-discovery-view", selectedId],
    enabled: !!selectedId,
    queryFn: () => viewFn({ data: { protectedAssetId: selectedId! } }),
    refetchInterval: (q) => {
      const status = q.state.data?.jobs?.[0]?.status;
      return status === "pending" || status === "running" ? 5000 : false;
    },
  });

  const start = useMutation({
    mutationFn: () =>
      startFn({ data: { protectedAssetId: selectedId!, scanId: scanId ?? null } }),
    onSuccess: () => {
      toast.success("Reverse discovery run finished — review candidates below.");
      qc.invalidateQueries({ queryKey: ["asset-discovery-view", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message || "Discovery run failed."),
  });

  const promote = useMutation({
    mutationFn: (matchId: string) => promoteFn({ data: { matchIds: [matchId] } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["protection-summary"] });
      if (res.created > 0) {
        toast.success("Case opened — pending review before any enforcement.");
      } else {
        toast.info("This finding is already attached to a case.");
      }
    },
    onError: (e: Error) => toast.error(e.message || "Failed to open case."),
    onSettled: () => setSendingMatchId(null),
  });

  const candidates = view.data?.candidates ?? [];
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of candidates) {
      const id = candidateState(c).id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [candidates]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border/60 bg-card/50 p-4">
        <label className="min-w-[240px] flex-1 text-xs font-semibold">
          Protected asset
          <select
            value={selectedId ?? ""}
            onChange={(e) => setAssetId(e.target.value || null)}
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {!assets.data?.length && <option value="">No registered protected assets</option>}
            {(assets.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.kind}
                {a.hasFingerprint ? "" : " (no fingerprint)"}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          {selected && (
            <Badge variant="outline" className="text-[10px]">
              {selected.hasFingerprint ? "fingerprinted" : "fingerprint missing"}
            </Badge>
          )}
          <Button
            size="sm"
            disabled={!selectedId || start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RadioTower className="mr-1.5 h-3.5 w-3.5" />
            )}
            Run reverse discovery
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-border/50 bg-background/40 p-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
        Discovery stops at verified visual match and pending review. Findings become cases only when
        you send them, and no takedown notice is ever sent automatically.
      </p>

      <DiscoveryJobProgress job={view.data?.jobs?.[0] ?? null} />

      {!!candidates.length && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {[
            ["candidate", "Candidate"],
            ["verifying", "Verifying"],
            ["verified_match", "Verified visual match"],
            ["no_match", "No match"],
            ["fetch_failed", "Fetch failed"],
          ].map(([id, label]) => (
            <Badge key={id} variant="outline" className="text-[10px]">
              {label}: {stateCounts[id] ?? 0}
            </Badge>
          ))}
        </div>
      )}

      {view.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <DiscoveryCandidateList
          candidates={candidates}
          matches={view.data?.matches ?? []}
          assetName={selected?.name ?? "protected asset"}
          sendingMatchId={sendingMatchId}
          onSendToCase={(matchId) => {
            setSendingMatchId(matchId);
            promote.mutate(matchId);
          }}
        />
      )}
    </div>
  );
}
