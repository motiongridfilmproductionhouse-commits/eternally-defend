import { useEffect, useState } from "react";
import {
  Loader2, ScanLine, Image as ImageIcon, Sparkles, Globe, FileCheck,
  CheckCircle2, Film, Radar,
} from "lucide-react";

export const SCAN_STAGES = [
  { key: "prepare", label: "Preparing reference material", icon: ImageIcon },
  { key: "visual", label: "Analyzing visual content", icon: ScanLine },
  { key: "details", label: "Extracting important details", icon: Sparkles },
  { key: "compare", label: "Comparing online matches", icon: Globe },
  { key: "report", label: "Generating report", icon: FileCheck },
] as const;

export interface ScanProgressProps {
  /** object URLs of the reference frame(s) */
  previews: string[];
  title: string;
  kind: "image" | "video";
  /** index into SCAN_STAGES */
  stageIndex: number;
  note?: string;
}

const LIVE_CARDS = [
  "Scanning web sources…",
  "Analyzing images…",
  "Checking video matches…",
  "Comparing scenes…",
  "Reviewing possible copies…",
];

export function ScanProgress({ previews, title, kind, stageIndex, note }: ScanProgressProps) {
  const [tick, setTick] = useState(0);
  const [visibleFrames, setVisibleFrames] = useState(1);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1600);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (visibleFrames >= previews.length) return;
    const id = setTimeout(() => setVisibleFrames((n) => n + 1), 550);
    return () => clearTimeout(id);
  }, [visibleFrames, previews.length]);

  const pct = Math.min(96, Math.round(((stageIndex + 0.5) / SCAN_STAGES.length) * 100));

  return (
    <section className="relative overflow-hidden rounded-xl border border-primary/30 bg-card/60 p-5 backdrop-blur">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />

      <header className="relative flex items-center gap-3">
        <div className="relative grid h-10 w-10 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <Radar className="h-5 w-5 animate-pulse text-primary" />
          <span className="absolute inset-0 animate-ping rounded-xl border border-primary/30" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Scanning in progress · {title}</h2>
          <p className="text-xs text-muted-foreground">
            {note || SCAN_STAGES[Math.min(stageIndex, SCAN_STAGES.length - 1)].label}
          </p>
        </div>
        <Loader2 className="ml-auto h-4 w-4 animate-spin text-primary" />
      </header>

      <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary/50 to-primary transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="relative mt-5 grid gap-5 lg:grid-cols-[minmax(0,260px)_1fr]">
        {/* Reference preview with scan-line sweep */}
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {kind === "video" ? "Extracted frames" : "Reference material"}
          </p>
          <div className="relative overflow-hidden rounded-lg border border-border/60 bg-background/40">
            {previews[0] ? (
              <img
                src={previews[0]}
                alt={`Reference material for ${title}`}
                className="h-40 w-full object-cover"
              />
            ) : (
              <div className="grid h-40 w-full place-items-center text-muted-foreground">
                {kind === "video" ? <Film className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
              </div>
            )}
            <span className="pointer-events-none absolute inset-x-0 top-0 h-10 animate-[scanSweep_2.4s_ease-in-out_infinite] bg-gradient-to-b from-primary/40 to-transparent" />
            <span className="pointer-events-none absolute inset-0 border border-primary/30" />
          </div>

          {previews.length > 1 && (
            <div className="grid grid-cols-4 gap-1.5">
              {previews.map((src, i) => (
                <div
                  key={src}
                  className={`relative overflow-hidden rounded border transition-all duration-500 ${
                    i < visibleFrames
                      ? "border-primary/40 opacity-100"
                      : "border-border/40 opacity-0"
                  }`}
                >
                  <img src={src} alt={`Frame ${i + 1} of ${title}`} className="h-12 w-full object-cover" />
                  {i === (tick % previews.length) && (
                    <span className="absolute inset-0 animate-pulse bg-primary/20" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stage list + live processing cards */}
        <div className="space-y-3">
          <ol className="space-y-1.5">
            {SCAN_STAGES.map((s, i) => {
              const Icon = s.icon;
              const done = i < stageIndex;
              const active = i === stageIndex;
              return (
                <li
                  key={s.key}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
                    active
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : done
                        ? "border-border/50 bg-background/30 text-muted-foreground"
                        : "border-border/40 bg-background/10 text-muted-foreground/60"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Icon className={`h-3.5 w-3.5 ${active ? "animate-pulse text-primary" : ""}`} />
                  )}
                  <span className="min-w-0 truncate">{s.label}</span>
                  {active && <Loader2 className="ml-auto h-3 w-3 animate-spin text-primary" />}
                </li>
              );
            })}
          </ol>

          <div className="grid gap-1.5 sm:grid-cols-2">
            {LIVE_CARDS.map((c, i) => (
              <div
                key={c}
                className={`rounded-lg border px-3 py-2 text-[11px] transition-all duration-500 ${
                  (tick + i) % LIVE_CARDS.length < 2
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border/40 bg-background/20 text-muted-foreground"
                }`}
              >
                {c}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scanSweep {
          0% { transform: translateY(0); opacity: 0.15; }
          50% { transform: translateY(150px); opacity: 0.55; }
          100% { transform: translateY(0); opacity: 0.15; }
        }
      `}</style>
    </section>
  );
}
