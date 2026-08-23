import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck, Clock, CircleDashed } from "lucide-react";
import { getProtectionEnrollments } from "@/lib/protection/enrollment.functions";

const REASON_LABEL: Record<string, string> = {
  NO_SUBJECT_NAME: "Waiting for verified name",
  NO_TARGET_PROFILE: "Face enrollment needed",
  NO_REFERENCE_FACES: "Face enrollment needed",
  NOT_AUTOMATED_YET: "Not yet automated",
};

function reasonText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REASON_LABEL[reason] ?? reason;
}

function statusBadge(status: string | undefined, blockedReason: string | null | undefined) {
  if (!status)
    return {
      label: "Not enrolled",
      tone: "text-muted-foreground bg-muted/40 border-border",
    };
  if (blockedReason && REASON_LABEL[blockedReason]) {
    return {
      label: REASON_LABEL[blockedReason],
      tone: "text-amber-600 dark:text-amber-300 bg-amber-500/10 border-amber-500/20",
    };
  }
  switch (status) {
    case "COMPLETED":
      return {
        label: "Monitoring",
        tone: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      };
    case "RUNNING":
    case "DISCOVERY":
    case "VERIFYING":
      return {
        label: "Running now",
        tone: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20",
      };
    case "QUEUED":
      return {
        label: "Queued",
        tone: "text-blue-600 dark:text-blue-300 bg-blue-500/10 border-blue-500/20",
      };
    case "PARTIAL":
    case "PROVIDER_LIMITED":
    case "RETRYING":
      return {
        label: "Partial — retrying",
        tone: "text-amber-600 dark:text-amber-300 bg-amber-500/10 border-amber-500/20",
      };
    case "FAILED":
      return {
        label: "Failed — retrying",
        tone: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20",
      };
    default:
      return {
        label: "Waiting for next scan",
        tone: "text-muted-foreground bg-muted/40 border-border",
      };
  }
}


function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  const label =
    mins < 60
      ? `${mins}m`
      : mins < 1440
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / 1440)}d`;
  return ms < 0 ? `${label} ago` : `in ${label}`;
}

export function ProtectionStatusPanel() {
  const fetchFn = useServerFn(getProtectionEnrollments);
  const q = useQuery({
    queryKey: ["protection-enrollments"],
    queryFn: () => fetchFn(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (q.isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-md p-6 flex items-center gap-3 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading protection status…
      </div>
    );
  }
  if (q.error || !q.data) return null;

  const { profile, modules } = q.data;

  return (
    <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-md shadow-[0_10px_40px_-15px_oklch(0.2_0.1_260_/_0.4)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <div className="text-[10px] tracking-[0.22em] font-bold text-primary/80 uppercase">
            Protection Status
          </div>
        </div>
        {profile ? (
          <span className="text-xs px-2 py-1 rounded-full border border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
            Protection Active
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-full border border-white/10 text-white/40 bg-white/5">
            Not enrolled yet
          </span>
        )}
      </div>

      {!profile ? (
        <div className="text-sm text-muted-foreground">
          Your protection profile is built automatically once your authorization is activated.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {modules.map((m) => {
            const e = m.enrollment;
            if (!e?.eligible) return null;
            const badge = statusBadge(e.current_status, e.blocked_reason);
            return (
              <div
                key={m.key}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-white truncate">{m.label}</div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.tone} shrink-0`}
                  >
                    {badge.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-white/50">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" /> Last: {relTime(e.last_scan_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <CircleDashed className="size-3" /> Next: {relTime(e.next_scan_at)}
                  </span>
                </div>
                <div className="text-[11px] text-white/40">
                  {e.candidates_found} candidates · {e.verified_findings} findings
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
