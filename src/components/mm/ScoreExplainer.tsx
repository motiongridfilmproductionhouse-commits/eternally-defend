/**
 * "Why this score?" popover — renders per-axis contributions,
 * missing signals, model version and calculation timestamp.
 */
import { useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ScoreExplainer({ axis, label, explanation }: {
  axis: string; label: string; explanation: any;
}) {
  const [open, setOpen] = useState(false);
  if (!explanation) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground hover:text-foreground" title="Why this score?">
          <Info className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-xs space-y-2">
        <div>
          <div className="font-semibold text-sm">{label} — {explanation.score}</div>
          <div className="text-[10px] text-muted-foreground">{explanation.formula}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground mb-1">Contributing signals</div>
          {explanation.contributions.filter((c: any) => c.points > 0).length === 0 && (
            <div className="text-[11px] text-muted-foreground">No contributing evidence.</div>
          )}
          <ul className="space-y-1">
            {explanation.contributions.filter((c: any) => c.points > 0).map((c: any) => (
              <li key={c.signal} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground">
                    severity × conf {c.confidence.toFixed(2)} × weight {c.weight.toFixed(2)} × count {c.count}
                  </div>
                </div>
                <span className="font-mono font-medium shrink-0">+{c.points}</span>
              </li>
            ))}
          </ul>
        </div>
        {explanation.missing?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Missing evidence</div>
            <ul className="text-[11px] list-disc list-inside text-muted-foreground">
              {explanation.missing.map((m: string) => <li key={m}>{m.replace(/_/g, " ")}</li>)}
            </ul>
          </div>
        )}
        <div className="border-t border-border pt-1.5 text-[10px] text-muted-foreground">
          Model {explanation.model_version} · {new Date(explanation.calculated_at).toLocaleString()}
        </div>
      </PopoverContent>
    </Popover>
  );
}
