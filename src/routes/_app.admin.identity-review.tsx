import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, UserSearch, ImageOff, ShieldCheck } from "lucide-react";
import { AdminGuard } from "@/components/AdminGuard";
import {
  listCustomersWithPendingIdentityReview,
  listIdentityCandidateClustersForReview,
  confirmIdentityCandidateCluster,
  rejectIdentityCandidateCluster,
} from "@/lib/protection/identity-bootstrap.functions";

export const Route = createFileRoute("/_app/admin/identity-review")({
  head: () => ({ meta: [{ title: "Identity Review · Eterna Admin" }] }),
  component: () => (
    <AdminGuard>
      <IdentityReviewPage />
    </AdminGuard>
  ),
});

function IdentityReviewPage() {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const qc = useQueryClient();

  const listCustomersFn = useServerFn(listCustomersWithPendingIdentityReview);
  const customersQ = useQuery({
    queryKey: ["identity-review-customers"],
    queryFn: () => listCustomersFn(),
  });

  const listClustersFn = useServerFn(listIdentityCandidateClustersForReview);
  const clustersQ = useQuery({
    queryKey: ["identity-review-clusters", selectedUserId],
    queryFn: () => listClustersFn({ data: { targetUserId: selectedUserId! } }),
    enabled: !!selectedUserId,
  });

  const confirmFn = useServerFn(confirmIdentityCandidateCluster);
  const rejectFn = useServerFn(rejectIdentityCandidateCluster);

  const confirmMut = useMutation({
    mutationFn: (clusterId: string) =>
      confirmFn({ data: { targetUserId: selectedUserId!, clusterId } }),
    onSuccess: () => {
      toast.success(
        "Identity confirmed — reference face created and screenshots are being re-processed.",
      );
      qc.invalidateQueries({ queryKey: ["identity-review-clusters", selectedUserId] });
      qc.invalidateQueries({ queryKey: ["identity-review-customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: (clusterId: string) =>
      rejectFn({ data: { targetUserId: selectedUserId!, clusterId } }),
    onSuccess: () => {
      toast.success("Marked as not this person.");
      qc.invalidateQueries({ queryKey: ["identity-review-clusters", selectedUserId] });
      qc.invalidateQueries({ queryKey: ["identity-review-customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedCustomer = customersQ.data?.find((c) => c.userId === selectedUserId);
  const pendingClusters = (clustersQ.data ?? []).filter((c) => c.status === "PENDING");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-white">Identity Review</h1>
          <p className="text-sm text-muted-foreground">
            Candidate faces extracted from a customer's own protected screenshots, grouped by
            recurring appearance. Confirming a cluster establishes it as that customer's trusted
            identity reference — this cannot be automated and requires your explicit judgment.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-md p-4 space-y-1 h-fit">
          <div className="text-[10px] tracking-[0.22em] font-bold text-primary/80 uppercase mb-3 flex items-center gap-2">
            <UserSearch className="size-3.5" /> Awaiting Review
          </div>
          {customersQ.isLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2 p-2">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          ) : !customersQ.data || customersQ.data.length === 0 ? (
            <div className="text-sm text-white/40 p-2">No customers awaiting identity review.</div>
          ) : (
            customersQ.data.map((c) => (
              <button
                key={c.userId}
                onClick={() => setSelectedUserId(c.userId)}
                className={`w-full text-left rounded-xl px-3 py-2.5 transition-colors ${
                  selectedUserId === c.userId
                    ? "bg-primary/15 border border-primary/30"
                    : "hover:bg-white/5 border border-transparent"
                }`}
              >
                <div className="text-sm text-white/90 truncate">{c.displayName}</div>
                <div className="text-[11px] text-white/40">
                  {c.pendingClusterCount} cluster{c.pendingClusterCount === 1 ? "" : "s"} pending
                </div>
              </button>
            ))
          )}
        </div>

        <div className="space-y-4">
          {!selectedUserId ? (
            <div className="border border-dashed border-white/20 rounded-xl p-16 text-center text-white/40 text-sm">
              Select a customer to review their candidate identity faces.
            </div>
          ) : clustersQ.isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : clustersQ.error ? (
            <div className="text-danger text-sm">
              Failed to load: {(clustersQ.error as Error).message}
            </div>
          ) : pendingClusters.length === 0 ? (
            <div className="border border-dashed border-white/20 rounded-xl p-16 text-center text-white/40 text-sm">
              No pending clusters left for {selectedCustomer?.displayName ?? "this customer"}.
            </div>
          ) : (
            <>
              <div className="text-sm text-white/70">
                Confirm {selectedCustomer?.displayName ?? "this customer"}'s identity — select the
                cluster that shows the protected person. Only confirm a cluster you can visually
                verify is the correct individual.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {pendingClusters.map((cluster) => (
                  <div
                    key={cluster.id}
                    className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden"
                  >
                    <div className="grid grid-cols-4 gap-px bg-white/10">
                      {cluster.exampleTileSignedUrls.length > 0 ? (
                        cluster.exampleTileSignedUrls.slice(0, 4).map((url, i) => (
                          <div
                            key={i}
                            className="aspect-square bg-black/40 flex items-center justify-center overflow-hidden"
                          >
                            <img
                              src={url}
                              alt={`Candidate face ${i + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))
                      ) : (
                        <div className="col-span-4 aspect-[4/1] bg-black/40 flex items-center justify-center">
                          <ImageOff className="size-5 text-white/20" />
                        </div>
                      )}
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="text-xs text-white/60">
                        Appears in {cluster.tileCount} screenshot tile
                        {cluster.tileCount === 1 ? "" : "s"}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => confirmMut.mutate(cluster.id)}
                          disabled={confirmMut.isPending || rejectMut.isPending}
                          className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="size-3.5" /> Confirm identity
                        </button>
                        <button
                          onClick={() => rejectMut.mutate(cluster.id)}
                          disabled={confirmMut.isPending || rejectMut.isPending}
                          className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-white/5 text-white/60 border border-white/15 hover:bg-white/10 transition-colors disabled:opacity-50"
                        >
                          <XCircle className="size-3.5" /> Not this person
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
