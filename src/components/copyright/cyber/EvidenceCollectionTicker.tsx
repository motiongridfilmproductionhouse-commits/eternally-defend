import { useEffect, useState } from "react";
import { FileSearch } from "lucide-react";

const PHASES = [
  "Capturing HTML…",
  "Capturing screenshot…",
  "Extracting download links…",
  "Extracting video URLs…",
  "Analyzing metadata…",
  "Extracting fingerprints…",
  "Finding mirrors…",
  "Collecting ownership…",
  "Preparing enforcement…",
] as const;

export type EvidenceCollectionTickerProps = {
  active: boolean;
  compact?: boolean;
};

/** Non-blocking evidence-collection ticker shown while enrichment runs. */
export function EvidenceCollectionTicker({ active, compact = false }: EvidenceCollectionTickerProps) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!active) {
      setVisible(0);
      return;
    }
    if (visible >= PHASES.length) return;
    const id = window.setTimeout(() => setVisible((n) => n + 1), 380);
    return () => window.clearTimeout(id);
  }, [active, visible]);

  if (!active) return null;

  const rows = PHASES.slice(0, Math.max(1, visible));

  return (
    <div
      className={`rounded-xl border border-sky-400/25 bg-black/50 p-3 font-mono text-[11px] text-emerald-300/90 ${
        compact ? "max-h-32 overflow-hidden" : ""
      }`}
      aria-live="polite"
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-sky-300/80">
        <FileSearch className="h-3.5 w-3.5" />
        <span className="uppercase tracking-widest">Evidence collection</span>
      </div>
      {rows.map((phase, i) => (
        <div key={phase} className="cyber-stream-row flex items-center gap-2">
          <span>{i === rows.length - 1 && visible < PHASES.length ? "›" : "✓"}</span>
          <span>{phase}</span>
        </div>
      ))}
    </div>
  );
}

export default EvidenceCollectionTicker;
