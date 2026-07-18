import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { ShieldCheck, ArrowRight, Info } from "lucide-react";
import { getFaceEnrollment } from "@/lib/onboarding/face-enrollment.functions";
import { useSession } from "@/hooks/use-session";

// Demo mode: hide setup prompts completely so they don't clutter the demo dashboard.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const DEMO_USER_EMAIL = (import.meta.env.VITE_DEMO_USER_EMAIL ?? "").trim().toLowerCase();

export function PendingSetupCard() {
  const navigate = useNavigate();
  const { session } = useSession();
  const fetchFace = useServerFn(getFaceEnrollment);
  const { data } = useQuery({
    queryKey: ["face_enrollment_status_pending_widget"],
    queryFn: () => fetchFace(),
  });

  const status = data?.status;
  const isDeferred = status === "DEFERRED";
  const isMissing = status === "NOT_STARTED" || status === "CONSENT_REQUIRED" || status === "CAMERA_PERMISSION_REQUIRED" || status === "LIVENESS_FAILED";

  // Completely suppress for demo account — clean dashboard for presentation.
  const isDemoUser = DEMO_MODE && DEMO_USER_EMAIL && session?.user?.email?.toLowerCase() === DEMO_USER_EMAIL;
  if (isDemoUser) return null;

  if (!isDeferred && !isMissing) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-blue-200/60 bg-blue-50/50 dark:border-blue-500/20 dark:bg-blue-950/20 px-4 py-3">
      <div className="size-7 rounded-lg bg-blue-100 dark:bg-blue-900/40 grid place-items-center shrink-0">
        <Info className="size-4 text-blue-500" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Face Protection enrollment pending</span>
        <span className="text-xs text-blue-600/70 dark:text-blue-400/70 ml-2">
          {isDeferred ? "Deferred — finish when ready." : "Not completed — deepfake detection is inactive."}
        </span>
      </div>
      <button
        onClick={() => navigate({ to: "/face-protection" })}
        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition whitespace-nowrap"
      >
        <ShieldCheck className="size-3.5" />
        Complete setup
        <ArrowRight className="size-3" />
      </button>
    </div>
  );
}
