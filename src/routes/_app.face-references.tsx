import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, ScanFace, ImageOff } from "lucide-react";
import {
  listFaceReferenceDetail,
  reviewFaceReferenceCandidate,
} from "@/lib/protection/face-reference-coverage.functions";

export const Route = createFileRoute("/_app/face-references")({
  head: () => ({ meta: [{ title: "Face References · Eterna AI" }] }),
  component: FaceReferences,
});

const IDENTITY_LABEL: Record<string, string> = {
  MATCHED_PROTECTED_SUBJECT: "Matched",
  PROBABLE_MATCH: "Probable match",
  AMBIGUOUS: "Ambiguous",
  NOT_SUBJECT: "Not the protected subject",
  REQUIRES_HUMAN_REVIEW: "Needs review",
};

const PROMOTION_TONE: Record<string, string> = {
  AUTO_APPROVED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  MANUALLY_APPROVED: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  PENDING_REVIEW: "text-amber-300 bg-amber-500/10 border-amber-500/20",
  REJECTED: "text-white/40 bg-white/5 border-white/10",
  DUPLICATE: "text-white/40 bg-white/5 border-white/10",
};

function FaceReferences() {
  const qc = useQueryClient();
  const listFn = useServerFn(listFaceReferenceDetail);
  const reviewFn = useServerFn(reviewFaceReferenceCandidate);

  const q = useQuery({
    queryKey: ["face-reference-detail"],
    queryFn: () => listFn({ data: { limit: 100 } }),
  });

  const reviewMut = useMutation({
    mutationFn: (v: { tileId: string; decision: "approve" | "reject" }) => reviewFn({ data: v }),
    onSuccess: (res) => {
      toast.success(
        res.decision === "approve" ? "Added as a secondary reference" : "Candidate rejected",
      );
      qc.invalidateQueries({ queryKey: ["face-reference-detail"] });
      qc.invalidateQueries({ queryKey: ["face-reference-coverage"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <ScanFace className="size-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-white">Face References</h1>
          <p className="text-sm text-muted-foreground">
            Secondary face references extracted automatically from your existing protected
            screenshots. Each tile shows exactly where it came from — the original screenshot and
            the extracted crop — so you can see why it was matched, or approve/reject anything still
            pending review.
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : q.error ? (
        <div className="text-danger text-sm">Failed to load: {(q.error as Error).message}</div>
      ) : !q.data || q.data.length === 0 ? (
        <div className="border border-dashed border-white/20 rounded-xl p-10 text-center text-white/50 text-sm">
          No screenshot-derived reference candidates yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {q.data.map((tile) => (
            <div
              key={tile.id}
              className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden"
            >
              <div className="grid grid-cols-2 gap-px bg-white/10">
                <div className="aspect-square bg-black/40 flex items-center justify-center overflow-hidden">
                  {tile.screenshotSignedUrl ? (
                    <img
                      src={tile.screenshotSignedUrl}
                      alt="Original screenshot"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageOff className="size-6 text-white/20" />
                  )}
                </div>
                <div className="aspect-square bg-black/40 flex items-center justify-center overflow-hidden">
                  {tile.tileSignedUrl ? (
                    <img
                      src={tile.tileSignedUrl}
                      alt={`Extracted tile ${tile.tileIndex}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageOff className="size-6 text-white/20" />
                  )}
                </div>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wide ${PROMOTION_TONE[tile.promotionStatus] ?? "text-white/50 bg-white/5 border-white/10"}`}
                  >
                    {tile.promotionStatus.replace(/_/g, " ")}
                  </span>
                  {tile.faceMatchSimilarity !== null && (
                    <span className="text-[11px] text-white/50 tabular-nums">
                      {tile.faceMatchSimilarity.toFixed(0)}% similarity
                    </span>
                  )}
                </div>
                <div className="text-xs text-white/60">
                  {tile.identityStatus
                    ? (IDENTITY_LABEL[tile.identityStatus] ?? tile.identityStatus)
                    : "—"}
                </div>
                <div className="text-[11px] text-white/30">
                  Screenshot-derived · tile #{tile.tileIndex}
                </div>

                {tile.promotionStatus === "PENDING_REVIEW" && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => reviewMut.mutate({ tileId: tile.id, decision: "approve" })}
                      disabled={reviewMut.isPending}
                      className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle2 className="size-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => reviewMut.mutate({ tileId: tile.id, decision: "reject" })}
                      disabled={reviewMut.isPending}
                      className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-white/5 text-white/60 border border-white/15 hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                      <XCircle className="size-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
