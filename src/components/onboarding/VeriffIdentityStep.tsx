import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { createVeriffSession, syncVeriffStatus } from "@/lib/onboarding/kyc.functions";

function CheckCircle2({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

type KycRow = {
  verification_status?: string | null;
  veriff_session_id?: string | null;
  session_url?: string | null;
} | null;

export function VeriffIdentityStep({
  kyc,
  onRefetch,
  onBack,
  onNext,
}: {
  kyc: KycRow;
  onRefetch: () => Promise<unknown> | void;
  onBack: () => void;
  onNext: () => void;
}) {
  const createSession = useServerFn(createVeriffSession);
  const syncStatus = useServerFn(syncVeriffStatus);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const status = kyc?.verification_status ?? "NOT_STARTED";
  const isTerminal = status === "APPROVED" || status === "DECLINED" || status === "EXPIRED";

  useEffect(() => {
    if (!kyc?.veriff_session_id || isTerminal) return;
    let cancelled = false;
    const run = async () => {
      try {
        await syncStatus();
        if (!cancelled) await onRefetch();
      } catch {
        /* ignore polling failures */
      }
    };
    void run();
    const id = setInterval(run, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [kyc?.veriff_session_id, isTerminal, syncStatus, onRefetch]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const { session_url, error } = await createSession();
      if (error || !session_url) {
        toast.error(error ?? "Failed to start verification");
        return;
      }
      window.open(session_url, "_blank", "noopener,noreferrer");
      toast.success("Verification session created. Please complete it in the new tab.");
      await onRefetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start verification");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      const res = await syncStatus();
      await onRefetch();
      if (res?.verification_status === "APPROVED") toast.success("Identity verified");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh status");
    } finally {
      setSyncing(false);
    }
  };

  const getStatusDisplay = () => {
    switch (status) {
      case "APPROVED":
        return { color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Approved" };
      case "DECLINED":
        return { color: "text-red-400", bg: "bg-red-500/10", label: "Declined" };
      case "RESUBMISSION_REQUIRED":
        return { color: "text-orange-400", bg: "bg-orange-500/10", label: "Resubmission Required" };
      case "MANUAL_REVIEW":
        return { color: "text-yellow-400", bg: "bg-yellow-500/10", label: "Manual Review" };
      case "EXPIRED":
        return { color: "text-zinc-400", bg: "bg-zinc-500/10", label: "Expired" };
      case "SESSION_CREATED":
      case "VERIFICATION_OPENED":
      case "IN_PROGRESS":
      case "SUBMITTED":
        return { color: "text-blue-400", bg: "bg-blue-500/10", label: "In Progress" };
      default:
        return { color: "text-white/50", bg: "bg-white/5", label: "Not Started" };
    }
  };

  const s = getStatusDisplay();
  const isApproved = status === "APPROVED";

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <CardTitle className="text-xl">Identity Verification</CardTitle>
        <CardDescription className="text-white/60">
          Individual accounts require Veriff government-ID verification before protection can be
          activated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className={`border border-white/10 rounded-xl p-6 flex flex-col items-center justify-center text-center space-y-4 ${s.bg}`}
        >
          <div className={`font-mono text-sm tracking-wider uppercase font-semibold ${s.color}`}>
            Status: {s.label}
          </div>
          {isApproved ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 justify-center text-emerald-400">
                <CheckCircle2 className="size-5" /> Identity Verified
              </div>
              <div className="flex items-center gap-2 justify-center text-emerald-400">
                <CheckCircle2 className="size-5" /> Government ID Verified
              </div>
              <div className="text-white/50 text-xs mt-2">Provider: Veriff</div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-white/70 max-w-sm">
                You will be redirected to securely scan your government ID and face. Keep this
                window open; it updates automatically.
              </p>
              <div className="flex gap-3 justify-center">
                <Button
                  onClick={handleStart}
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                >
                  {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                  {status === "NOT_STARTED"
                    ? "Start Identity Verification"
                    : "Open / Continue Verification"}
                </Button>
                {status !== "NOT_STARTED" && (
                  <Button
                    variant="outline"
                    onClick={handleRefresh}
                    disabled={syncing}
                    className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
                  >
                    {syncing ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                    Refresh Status
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <Button
            disabled={!isApproved}
            onClick={onNext}
            className="bg-blue-600 hover:bg-blue-500 text-white border-0"
          >
            Continue <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
