import { AlertTriangle, ScanFace } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/mm/dashboard.functions";
import { useSession } from "@/hooks/use-session";

export function DeepfakeIntelligence() {
  const fn = useServerFn(getDashboardStats);
  const { session } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fn({}),
    enabled: !!session,
    refetchInterval: 30_000,
  });
  const d = data?.deepfake;
  const bars = [
    { label: "Face Match", value: d?.faceMatch ?? 0, color: "oklch(0.63 0.24 25)" },
    { label: "Voice Match", value: d?.voiceMatch ?? 0, color: "oklch(0.7 0.18 320)" },
    { label: "Deepfake Probability", value: d?.deepfakeProb ?? 0, color: "oklch(0.6 0.24 295)" },
  ];
  const riskColor =
    d?.risk === "Critical" ? "oklch(0.63 0.24 25)" :
    d?.risk === "High" ? "oklch(0.7 0.2 35)" :
    d?.risk === "Medium" ? "oklch(0.75 0.16 70)" :
    "oklch(0.68 0.16 155)";

  return (
    <div className="card-surface p-5">
      <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">DEEPFAKE INTELLIGENCE CENTER</div>
      <div className="text-xs text-muted-foreground/80 mb-4">AI analysis results</div>

      <div className="grid grid-cols-[auto_1fr] gap-4 items-center">
        <div className="size-24 rounded-xl grid place-items-center" style={{ background: "var(--gradient-soft)" }}>
          <ScanFace className="size-14 text-primary/70" strokeWidth={1.2} />
        </div>
        <div className="space-y-2.5">
          {bars.map((b) => (
            <div key={b.label}>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-muted-foreground">{b.label}</span>
                <span className="font-bold" style={{ color: b.color }}>{b.value}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${b.value}%`, background: b.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5" />
          {isLoading ? "Loading…" : `${d?.sampleCount ?? 0} samples analyzed`}
        </div>
        <div className="text-sm font-bold" style={{ color: riskColor }}>{d?.risk ?? "None"}</div>
      </div>
    </div>
  );
}
