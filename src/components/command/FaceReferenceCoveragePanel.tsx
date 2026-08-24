import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ScanFace, Loader2 } from "lucide-react";
import { getFaceReferenceCoverage } from "@/lib/protection/face-reference-coverage.functions";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-lg font-semibold text-white tabular-nums">{value}</div>
      <div className="text-[11px] text-white/50 leading-tight mt-0.5">{label}</div>
    </div>
  );
}

export function FaceReferenceCoveragePanel() {
  const fetchFn = useServerFn(getFaceReferenceCoverage);
  const q = useQuery({
    queryKey: ["face-reference-coverage"],
    queryFn: () => fetchFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
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

      {!d.verifiedIdentityActive ? (
        <div className="text-sm text-muted-foreground">
          Complete Face Protection to enable automatic face reference extraction.
        </div>
      ) : !hasAnySecondaryReferences ? (
        <div className="space-y-2">
          <div className="text-sm text-white/80">Verified identity reference active.</div>
          <div className="text-sm text-muted-foreground">
            Secondary face references will be built automatically from approved protected
            screenshots.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <Stat label="Verified identity reference" value={d.verifiedReferenceCount} />
          <Stat label="Approved secondary references" value={d.approvedSecondaryReferenceCount} />
          <Stat label="Screenshot tiles analyzed" value={d.tilesAnalyzed} />
          <Stat label="Faces detected" value={d.facesDetected} />
          <Stat label="Matched" value={d.matched} />
          <Stat label="Rejected / review" value={d.rejectedOrReview} />
        </div>
      )}
    </div>
  );
}
