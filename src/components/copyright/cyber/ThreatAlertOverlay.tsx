import { useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const LOCK_STEPS = [
  "Scanning…",
  "Matching fingerprints…",
  "Identity confirmed…",
  "Target locked",
  "Evidence collected",
  "Ready for enforcement",
] as const;

export type ThreatAlertOverlayProps = {
  open: boolean;
  domain: string | null;
  url: string | null;
  workTitle: string | null;
  riskLabel?: string;
  soundEnabled?: boolean;
  onClose: () => void;
  onInvestigate?: () => void;
};

function playSiren() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.35);
    osc.frequency.linearRampToValueAtTime(520, ctx.currentTime + 0.7);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.95);
    window.setTimeout(() => void ctx.close(), 1_200);
  } catch {
    /* audio is best-effort only */
  }
}

/** Full-screen cyber alert with siren pulse and threat-lock sequence. */
export function ThreatAlertOverlay({
  open,
  domain,
  url,
  workTitle,
  riskLabel = "High Risk",
  soundEnabled = false,
  onClose,
  onInvestigate,
}: ThreatAlertOverlayProps) {
  const [step, setStep] = useState(0);
  const playedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setStep(0);
      playedRef.current = false;
      return;
    }
    if (soundEnabled && !playedRef.current) {
      playedRef.current = true;
      playSiren();
    }
    if (step >= LOCK_STEPS.length) return;
    const id = window.setTimeout(() => setStep((n) => n + 1), 520);
    return () => window.clearTimeout(id);
  }, [open, step, soundEnabled]);

  const visibleSteps = useMemo(() => LOCK_STEPS.slice(0, step), [step]);

  if (!open || !domain) return null;

  return (
    <div
      role="alertdialog"
      aria-label="Unauthorized distribution detected"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
    >
      <div className="cyber-alert-flash absolute inset-0 bg-red-600/25 backdrop-blur-sm" />
      <div className="cyber-alert-card relative w-full max-w-2xl overflow-hidden rounded-2xl border border-red-500/50 bg-slate-950/95 p-6 shadow-2xl">
        <span className="cyber-siren-ring pointer-events-none absolute -inset-8 rounded-full border border-red-500/40" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss threat alert"
          className="absolute right-4 top-4 text-slate-400 transition hover:text-red-300"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-red-500/50 bg-red-500/15">
            <ShieldAlert className="h-5 w-5 animate-pulse text-red-400" />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-red-400">
              🚨 Unauthorized distribution detected
            </p>
            <h2 className="mt-1 truncate text-xl font-bold text-slate-50">{domain}</h2>
            <p className="mt-1 text-xs text-red-200/80">
              {riskLabel} · {workTitle ? `Match on “${workTitle}”` : "Protected work match"} ·
              Immediate action recommended
            </p>
          </div>
        </div>

        <div className="relative mt-5 overflow-hidden rounded-xl border border-red-500/30 bg-black/60 p-4">
          <span className="cyber-lock-beam pointer-events-none absolute inset-x-0 h-16" />
          <ol className="relative space-y-1.5 font-mono text-xs text-red-200">
            {visibleSteps.map((label, index) => (
              <li key={label} className="cyber-stream-row flex items-center gap-2">
                <span className="text-red-400">{index === LOCK_STEPS.length - 1 ? "✓" : "↓"}</span>
                <span>{label}</span>
              </li>
            ))}
            {step < LOCK_STEPS.length && <li className="animate-pulse text-red-400/70">▌</li>}
          </ol>
        </div>

        <div className="relative mt-5 flex flex-wrap gap-2">
          {onInvestigate && (
            <Button onClick={onInvestigate} className="bg-red-600 text-white hover:bg-red-500">
              Open full investigation
            </Button>
          )}
          {url && (
            <Button variant="outline" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                View source page
              </a>
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Continue monitoring
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ThreatAlertOverlay;
