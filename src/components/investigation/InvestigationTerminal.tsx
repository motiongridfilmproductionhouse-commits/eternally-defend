import { useEffect, useRef, useState } from "react";

const STEPS = [
  "> Connecting to target...",
  "✓ Connected",
  "> Resolving DNS...",
  "✓ DNS Complete",
  "> Querying RDAP...",
  "✓ RDAP Complete",
  "> Querying WHOIS...",
  "✓ WHOIS Complete",
  "> Downloading webpage...",
  "✓ HTML Downloaded",
  "> Detecting CMS...",
  "✓ WordPress detected",
  "> Detecting Framework...",
  "✓ Framework analyzed",
  "> Detecting CDN...",
  "✓ Cloudflare detected",
  "> Detecting Hosting...",
  "✓ Cloudflare Inc.",
  "> Finding download links...",
  "✓ Download links detected",
  "> Searching embedded player...",
  "✓ Analysis complete",
  "> Calculating Threat Score...",
  "✓ Investigation Complete",
] as const;

export type InvestigationTerminalProps = {
  active: boolean;
  progress?: number;
};

export function InvestigationTerminal({ active, progress }: InvestigationTerminalProps) {
  const [lines, setLines] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    setLines([]);
    indexRef.current = 0;

    timerRef.current = setInterval(() => {
      const i = indexRef.current;
      if (i >= STEPS.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        return;
      }
      setLines((prev) => [...prev, STEPS[i]!]);
      indexRef.current += 1;
    }, 300);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [active]);

  const animatedProgress = Math.round((lines.length / STEPS.length) * 100);
  const displayProgress =
    typeof progress === "number"
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : animatedProgress;

  return (
    <div className="h-[600px] overflow-auto rounded-xl bg-black p-6 font-mono text-green-400">
      <div className="mb-4 text-xl font-bold">ETERNA CYBER INVESTIGATION</div>
      <div className="mb-6 text-green-500">Digital Infrastructure Intelligence Engine</div>

      {lines.map((line, index) => (
        <div key={`${line}-${index}`} className="mb-1">
          {line}
        </div>
      ))}

      <div className="mt-10">
        <div className="h-3 w-full rounded bg-zinc-800">
          <div
            className="h-3 rounded bg-green-500 transition-all duration-300"
            style={{ width: `${displayProgress}%` }}
          />
        </div>
        <div className="mt-2 text-green-300">{displayProgress}% Complete</div>
      </div>
    </div>
  );
}

export default InvestigationTerminal;
