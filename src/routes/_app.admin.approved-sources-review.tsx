import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminGuard } from "@/components/AdminGuard";
import { PageCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Loader2, ShieldAlert, Youtube } from "lucide-react";
import {
  listReviewQueueForAdmins,
  takedownSourceVideo,
} from "@/lib/protection/sources/admin-takedown.functions";

export const Route = createFileRoute("/_app/admin/approved-sources-review")({
  head: () => ({ meta: [{ title: "Approved Sources Review — Eterna AI Admin" }] }),
  component: () => (
    <AdminGuard>
      <ApprovedSourcesReviewPage />
    </AdminGuard>
  ),
});

interface ReviewQueueVideo {
  id: string;
  user_id: string;
  title: string | null;
  thumbnail_url: string | null;
  url: string | null;
  classification: string | null;
  review_status: string;
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  legitimate_appearance: "Legitimate Appearance",
  verified_deepfake: "Verified Deepfake",
  probable_deepfake: "Probable Deepfake",
  not_subject: "Not the Subject",
  needs_review: "Needs Review",
};

function ApprovedSourcesReviewPage() {
  const fetchQueue = useServerFn(listReviewQueueForAdmins);
  const takedown = useServerFn(takedownSourceVideo);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin_approved_sources_review_queue"],
    queryFn: () => fetchQueue(),
  });

  const [targetVideo, setTargetVideo] = useState<ReviewQueueVideo | null>(null);
  const [reason, setReason] = useState("");

  const takedownMutation = useMutation({
    mutationFn: async () => {
      if (!targetVideo) throw new Error("No video selected.");
      return takedown({ data: { id: targetVideo.id, reason: reason.trim() || undefined } });
    },
    onSuccess: () => {
      toast.success("Takedown requested and logged.");
      setTargetVideo(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["admin_approved_sources_review_queue"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to request takedown");
    },
  });

  const videos = (data ?? []) as ReviewQueueVideo[];

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Approved Sources Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every customer's discovered videos still awaiting a decision. Takedown is the only action
          here that can create an enforcement case — it requires confirmation and is logged.
        </p>
      </div>

      {isLoading ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="size-6 animate-spin text-blue-500" />
        </div>
      ) : videos.length === 0 ? (
        <div className="border border-dashed border-white/20 rounded-xl p-8 text-center text-muted-foreground text-sm">
          Nothing awaiting review right now.
        </div>
      ) : (
        <div className="space-y-3">
          {videos.map((video) => (
            <PageCard key={video.id}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {video.thumbnail_url ? (
                    <img
                      src={video.thumbnail_url}
                      alt=""
                      className="size-12 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="size-12 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                      <Youtube className="size-5 text-red-500" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground truncate">{video.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      Customer: {video.user_id}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {video.classification ? CLASSIFICATION_LABEL[video.classification] : "Pending"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {video.review_status.replace(/_/g, " ")}
                  </Badge>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setTargetVideo(video);
                      setReason("");
                    }}
                  >
                    <ShieldAlert className="size-4 mr-1.5" />
                    Takedown
                  </Button>
                </div>
              </div>
            </PageCard>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!targetVideo}
        onOpenChange={(open) => !takedownMutation.isPending && !open && setTargetVideo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request takedown for "{targetVideo?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates an enforcement case for this customer's account, logged to the audit
              trail with your admin account. It still goes through every existing enforcement
              approval gate — this does not send a takedown notice by itself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Optional reason (visible in the audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={takedownMutation.isPending}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={takedownMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={takedownMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                takedownMutation.mutate();
              }}
            >
              {takedownMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Requesting...
                </>
              ) : (
                "Confirm Takedown"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
