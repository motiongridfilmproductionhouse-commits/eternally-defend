import { useMemo } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Globe,
  Globe2,
  Trash2,
  CheckCircle,
  Repeat,
  Layers,
} from "lucide-react";
import type { ClientFinding } from "@/lib/deepfake/results-dashboard";
import { buildIntelligenceSummaryMetrics } from "@/lib/deepfake/analytics-helpers";

interface Props {
  findings: ClientFinding[];
}

export function DeepfakeIntelligenceSummary({ findings }: Props) {
  const summary = useMemo(() => buildIntelligenceSummaryMetrics(findings), [findings]);

  const cards = [
    {
      title: "VERIFIED THREATS",
      value: summary.verifiedThreats,
      subtitle: "Face + explicit confirmed",
      icon: ShieldAlert,
      tone: "border-red-500/40 bg-red-500/10 text-red-400",
      valueColor: "text-red-400",
    },
    {
      title: "PROBABLE THREATS",
      value: summary.probableThreats,
      subtitle: "High identity match",
      icon: ShieldCheck,
      tone: "border-amber-500/40 bg-amber-500/10 text-amber-400",
      valueColor: "text-amber-400",
    },
    {
      title: "AFFECTED DOMAINS",
      value: summary.affectedDomains,
      subtitle: "Distinct hosting sources",
      icon: Globe,
      tone: "border-sky-500/40 bg-sky-500/10 text-sky-400",
      valueColor: "text-sky-300",
    },
    {
      title: "QUALIFYING URLs",
      value: summary.qualifyingUrls,
      subtitle: "Verified media pages",
      icon: Layers,
      tone: "border-blue-500/40 bg-blue-500/10 text-blue-400",
      valueColor: "text-blue-300",
    },
    {
      title: "COUNTRIES / REGIONS",
      value: summary.countriesCount,
      subtitle: "Infra geolocation",
      icon: Globe2,
      tone: "border-purple-500/40 bg-purple-500/10 text-purple-300",
      valueColor: "text-purple-300",
    },
    {
      title: "REMOVAL QUEUE",
      value: summary.removalQueueCount,
      subtitle: "Notice ready for dispatch",
      icon: Trash2,
      tone: "border-orange-500/40 bg-orange-500/10 text-orange-400",
      valueColor: "text-orange-300",
    },
    {
      title: "REMOVED / DISMISSED",
      value: summary.removedCount,
      subtitle: "Takedown completed",
      icon: CheckCircle,
      tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
      valueColor: "text-emerald-400",
    },
    {
      title: "REUPLOADS / MIRRORS",
      value: summary.reuploadsCount,
      subtitle: "Secondary endpoints",
      icon: Repeat,
      tone: "border-slate-500/40 bg-slate-500/10 text-slate-300",
      valueColor: "text-slate-200",
    },
  ];

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] tracking-[0.2em] font-semibold text-muted-foreground uppercase">
          DEEPFAKE INTELLIGENCE SUMMARY
        </div>
        <div className="text-xs text-muted-foreground">
          Real target findings • {summary.qualifyingUrls} qualifying threats analyzed
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className={`p-3 rounded-xl border ${card.tone} space-y-1 transition hover:scale-[1.02]`}
            >
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[9px] font-bold tracking-wider truncate">{card.title}</span>
                <Icon className="size-3.5 opacity-80 shrink-0" />
              </div>
              <div className={`text-xl font-extrabold tabular-nums ${card.valueColor}`}>
                {card.value}
              </div>
              <div className="text-[10px] text-muted-foreground/80 truncate">{card.subtitle}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
