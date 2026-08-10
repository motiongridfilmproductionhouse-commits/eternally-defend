import { ShieldAlert, Activity, CheckCircle2, Radar, Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface TimelineEvent {
  id: string;
  time: string;
  stage: string;
  message: string;
  threat?: boolean;
}

export function ThreatTimeline({ events }: { events: TimelineEvent[] }) {
  if (!events || events.length === 0) return null;

  return (
    <div className="card-surface p-3.5 border border-primary/20 rounded-xl space-y-2 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-2 pb-1 border-b border-border/50">
        <div className="flex items-center gap-1.5 font-bold text-foreground">
          <Activity className="size-4 text-primary animate-pulse" />
          <span>Real-Time Threat & Discovery Timeline</span>
        </div>
        <Badge variant="outline" className="text-[9px] uppercase border-primary/40 text-primary">
          Live Telemetry Feed
        </Badge>
      </div>

      <ul className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
        {events.map((ev) => (
          <li
            key={ev.id}
            className={`flex items-start justify-between gap-2 p-2 rounded-md border text-[11px] transition ${
              ev.threat
                ? "border-red-500/50 bg-red-500/10 text-red-200"
                : "border-border/40 bg-secondary/20 text-muted-foreground"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-mono text-[10px] opacity-70 shrink-0">{ev.time}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-foreground truncate flex items-center gap-1">
                  {ev.threat ? (
                    <Flame className="size-3 text-red-400 shrink-0" />
                  ) : (
                    <Radar className="size-3 text-primary shrink-0" />
                  )}
                  {ev.stage}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">{ev.message}</div>
              </div>
            </div>
            {ev.threat && (
              <Badge className="bg-red-600/30 text-red-300 border border-red-500/50 text-[9px] py-0 shrink-0">
                +1 Threat
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
