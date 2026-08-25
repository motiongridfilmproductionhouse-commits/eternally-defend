import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ScanFace, Loader2, UserCheck } from "lucide-react";
import { getFaceReferenceCoverage } from "@/lib/protection/face-reference-coverage.functions";
import {
  getIdentityBootstrapState,
  triggerIdentityCandidateReview,
} from "@/lib/protection/identity-bootstrap.functions";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-lg font-semibold text-white tabular-nums">{value}</div>
      <div className="text-[11px] text-white/50 leading-tight mt-0.5">{label}</div>
    </div>
  );
}

export function FaceReferenceCoveragePanel() {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getFaceReferenceCoverage);
  const q = useQuery({
    queryKey: ["face-reference-coverage"],
    queryFn: () => fetchFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const bootstrapStateFn = useServerFn(getIdentityBootstrapState);
  const bootstrapQ = useQuery({
    queryKey: ["identity-bootstrap-state"],
    queryFn: () => bootstrapStateFn(),
    enabled: q.data ? !q.data.verifiedIdentityActive : false,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const triggerFn = useServerFn(triggerIdentityCandidateReview);
  const triggerMut = useMutation({
    mutationFn: () => triggerFn(),
    onSuccess: (res) => {
      if (res.status === "CANDIDATES_GENERATED") {
        toast.success("Identity candidates found — awaiting Eterna review.");
      } else if (res.status === "NO_USABLE_FACES_FOUND") {
        toast.info("No usable faces were found in your protected screenshots yet.");
      } else if (res.status === "NO_PROTECTED_ASSETS") {
        toast.info("No protected screenshots are available to review yet.");
      }
      qc.invalidateQueries({ queryKey: ["identity-bootstrap-state"] });
      qc.invalidateQueries({ queryKey: ["face-reference-coverage"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-md p-6 flex items-center gap-3 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading face reference coverage…
      </div>
    );
  }
  if (q.error || !q.data) return null;

  const d = q.data;
  const hasAnySecondaryReferences = d.approvedSecondaryReferenceCount > 0;
  const bootstrap = bootstrapQ.data;
  const hasAdminConfirmedAnchor =
    bootstrap?.anchorTier === "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE";

  return (
    <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-md shadow-[0_10px_40px_-15px_oklch(0.2_0.1_260_/_0.4)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ScanFace className="size-4 text-primary" />
          <div className="text-[10px] tracking-[0.22em] font-bold text-primary/80 uppercase">
            Face Reference Coverage
          </div>
        </div>
        <Link
          to="/face-references"
          className="text-xs px-3 py-1.5 rounded-full border border-white/15 text-white/80 hover:bg-white/10 transition-colors"
        >
          View References
        </Link>
      </div>

      {d.verifiedIdentityActive || hasAdminConfirmedAnchor ? (
        hasAnySecondaryReferences ? (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <Stat
              label={
                d.verifiedIdentityActive
                  ? "Verified identity reference"
                  : "Admin-confirmed protected image"
              }
              value={d.verifiedIdentityActive ? d.verifiedReferenceCount : 1}
            />
            <Stat label="Approved secondary references" value={d.approvedSecondaryReferenceCount} />
            <Stat label="Screenshot tiles analyzed" value={d.tilesAnalyzed} />
            <Stat label="Faces detected" value={d.facesDetected} />
            <Stat label="Matched" value={d.matched} />
            <Stat label="Rejected / review" value={d.rejectedOrReview} />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-white/80 flex items-center gap-1.5">
              <UserCheck className="size-3.5 text-emerald-400" />
              {d.verifiedIdentityActive
                ? "Verified identity reference active."
                : "Identity reference active (admin-confirmed from a protected image)."}
            </div>
            <div className="text-sm text-muted-foreground">
              Secondary face references will be built automatically from approved protected
              screenshots.
            </div>
          </div>
        )
      ) : bootstrapQ.isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" /> Checking eligibility…
        </div>
      ) : bootstrap && bootstrap.pendingClusterCount > 0 ? (
        <div className="space-y-2">
          <div className="text-sm text-white/80">Identity confirmation required.</div>
          <div className="text-sm text-muted-foreground">
            {bootstrap.pendingClusterCount} candidate face
            {bootstrap.pendingClusterCount === 1 ? "" : "s"} found in your protected screenshots,
            awaiting confirmation by an Eterna reviewer before they activate as identity references.
          </div>
        </div>
      ) : bootstrap && bootstrap.eligibleProtectedAssetCount > 0 ? (
        <div className="space-y-3">
          <div className="text-sm text-white/80">Identity confirmation required.</div>
          <div className="text-sm text-muted-foreground">
            You have {bootstrap.eligibleProtectedAssetCount} protected screenshot
            {bootstrap.eligibleProtectedAssetCount === 1 ? "" : "s"} that can be reviewed for
            identity faces without redoing Face Liveness.
          </div>
          <button
            onClick={() => triggerMut.mutate()}
            disabled={triggerMut.isPending}
            className="text-xs px-3 py-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {triggerMut.isPending && <Loader2 className="size-3 animate-spin" />}
            Review Identity Faces
          </button>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          Complete Face Protection to enable automatic face reference extraction.
        </div>
      )}
    </div>
  );
}
