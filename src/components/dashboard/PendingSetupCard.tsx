import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Clock, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFaceEnrollment } from "@/lib/onboarding/face-enrollment.functions";

export function PendingSetupCard() {
  const navigate = useNavigate();
  const fetchFace = useServerFn(getFaceEnrollment);
  const { data } = useQuery({
    queryKey: ["face_enrollment_status_pending_widget"],
    queryFn: () => fetchFace(),
  });

  const status = data?.status;
  const isDeferred = status === "DEFERRED";
  const isMissing = status === "NOT_STARTED" || status === "CONSENT_REQUIRED" || status === "CAMERA_PERMISSION_REQUIRED" || status === "LIVENESS_FAILED";

  if (!isDeferred && !isMissing) return null;

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-5 flex items-start gap-4">
      <div className="size-10 rounded-xl bg-amber-500/15 border border-amber-500/30 grid place-items-center shrink-0">
        <Clock className="size-5 text-amber-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold tracking-wider text-amber-300/80 uppercase">Complete Your Protection Setup</div>
        <div className="mt-1 flex items-center gap-2 text-white font-semibold">
          <ShieldCheck className="size-4 text-amber-300" />
          Face Protection Enrollment
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/30">
            {isDeferred ? "Deferred" : "Not Completed"}
          </span>
        </div>
        <p className="mt-1 text-sm text-white/60">
          Deepfake and impersonation detection tied to your face is inactive until you finish enrollment.
        </p>
      </div>
      <Button
        onClick={() => navigate({ to: "/face-protection" })}
        className="bg-amber-500 hover:bg-amber-400 text-black font-semibold border-0 shrink-0"
      >
        Complete Setup <ArrowRight className="size-4 ml-1" />
      </Button>
    </div>
  );
}
