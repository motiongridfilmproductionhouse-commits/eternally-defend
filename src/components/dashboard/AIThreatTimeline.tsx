import { Link } from "@tanstack/react-router";
import { Youtube, Brain, FileImage, Send, Plus, AlertTriangle, ShieldAlert, Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/mm/dashboard.functions";
import { useSession } from "@/hooks/use-session";

const TYPE_ICON: Record<string, { icon: any; color: string }> = {
  youtube_meta: { icon: Youtube, color: "oklch(0.63 0.24 25)" },
  deepfake: { icon: Brain, color: "oklch(0.6 0.24 295)" },
  face_swap: { icon: Brain, color: "oklch(0.6 0.24 295)" },
  voice_clone: { icon: Brain, color: "oklch(0.6 0.24 295)" },
  synthetic_media: { icon: Brain, color: "oklch(0.6 0.24 295)" },
  ocr_text: { icon: FileImage, color: "oklch(0.65 0.18 240)" },
  screenshot: { icon: FileImage, color: "oklch(0.65 0.18 240)" },
  claim: { icon: Send, color: "oklch(0.68 0.16 155)" },
  fact_check: { icon: Send, color: "oklch(0.68 0.16 155)" },
  impersonation: { icon: ShieldAlert, color: "oklch(0.7 0.18 320)" },
  copyright_match: { icon: AlertTriangle, color: "oklch(0.75 0.16 70)" },
  unauthorized_ad: { icon: AlertTriangle, color: "oklch(0.75 0.16 70)" },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "oklch(0.55 0.25 25)",
  high: "oklch(0.63 0.24 25)",
  medium: "oklch(0.7 0.18 60)",
  low: "oklch(0.68 0.16 155)",
  info: "oklch(0.65 0.05 260)",
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AIThreatTimeline() {
  const { session } = useSession();
  const fn = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fn({}),
    enabled: !!session,
    refetchInterval: 30_000,
  });

  const events = data?.timeline ?? [];

  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">AI THREAT TIMELINE</div>
          <div className="text-xs text-muted-foreground/80">Real-time events</div>
        </div>
        <Link to="/intelligence" className="text-xs font-semibold text-primary">View All</Link>
      </div>

      {!session ? (
        <Empty msg="Sign in to view real-time events" />
      ) : isLoading ? (
        <Empty msg="Loading events…" />
      ) : events.length === 0 ? (
        <Empty msg="No events yet — run an analysis to populate the timeline" />
      ) : (
        <div className="relative pl-4">
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
          <div className="space-y-4">
            {events.map((e) => {
              const meta = TYPE_ICON[e.type] ?? { icon: Activity, color: SEVERITY_COLOR[e.severity] ?? "oklch(0.6 0.05 260)" };
              const Icon = meta.icon;
              const dotColor = SEVERITY_COLOR[e.severity] ?? meta.color;
              return (
                <div key={e.id} className="relative flex items-start gap-3">
                  <span className="absolute -left-4 top-1.5 size-3 rounded-full ring-4 ring-background" style={{ background: dotColor }} />
                  <div className="text-xs font-semibold text-muted-foreground w-16 shrink-0 pt-0.5">{fmtTime(e.time)}</div>
                  <div className="size-8 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in oklab, ${meta.color} 12%, white)`, color: meta.color }}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-tight truncate">{e.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{e.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-10 text-center text-xs text-muted-foreground">{msg}</div>;
}
