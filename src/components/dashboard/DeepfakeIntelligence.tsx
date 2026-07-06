import { AlertTriangle, ScanFace } from "lucide-react";

const bars = [
  { label: "Face Match", value: 97, color: "oklch(0.63 0.24 25)" },
  { label: "Voice Match", value: 94, color: "oklch(0.7 0.18 320)" },
  { label: "Deepfake Probability", value: 88, color: "oklch(0.6 0.24 295)" },
];

export function DeepfakeIntelligence() {
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
              <div className="flex justify-between text-[11px] mb-1"><span className="text-muted-foreground">{b.label}</span><span className="font-bold" style={{ color: b.color }}>{b.value}%</span></div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${b.value}%`, background: b.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="size-3.5" /> Risk Level</div>
        <div className="text-sm font-bold" style={{ color: "oklch(0.63 0.24 25)" }}>Critical</div>
      </div>
    </div>
  );
}
