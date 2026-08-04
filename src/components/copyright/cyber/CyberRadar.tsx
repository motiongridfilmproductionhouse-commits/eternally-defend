import { useEffect, useMemo, useRef, useState } from "react";
import { Radar } from "lucide-react";
import type { ScanActivityEvent } from "@/lib/copyright/scan-activity";

export type CyberRadarProps = {
  events: ScanActivityEvent[];
  scanning: boolean;
  counters?: Array<{ label: string; value: number }>;
};

const SEED_TARGETS = [
  "google.com",
  "ogomovies1.com.pk",
  "bilibili.tv",
  "archive.org",
  "terabox.app",
  "dailymotion.com",
  "mega.nz",
  "pixeldrain.com",
  "ok.ru",
  "Telegram channels",
  "torrent indexes",
  "mirror domains",
];

function hashAngle(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function hashRadius(seed: string): number {
  let h = 7;
  for (let i = 0; i < seed.length; i++) h = (h * 17 + seed.charCodeAt(i)) % 100;
  return 22 + (h % 60) / 2;
}

/** Global cyber radar with sweeping beam and a live stream of investigated domains. */
export function CyberRadar({ events, scanning, counters = [] }: CyberRadarProps) {
  const [seedIndex, setSeedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!scanning || seedIndex >= SEED_TARGETS.length) return;
    const id = window.setTimeout(() => setSeedIndex((n) => n + 1), 420);
    return () => window.clearTimeout(id);
  }, [scanning, seedIndex]);

  const blips = useMemo(
    () =>
      events.slice(0, 26).map((event) => ({
        id: event.id,
        host: event.hostname,
        angle: hashAngle(event.hostname),
        radius: hashRadius(event.hostname),
        hot: event.threat === "verified_finding" || event.threat === "high_risk",
      })),
    [events],
  );

  const stream = useMemo(() => {
    const live = events.slice(0, 40).map((e) => ({
      key: e.id,
      host: e.hostname,
      done: e.threat !== "checking",
      hot: e.threat === "verified_finding" || e.threat === "high_risk",
    }));
    if (live.length) return live;
    return SEED_TARGETS.slice(0, Math.max(1, seedIndex)).map((host) => ({
      key: host,
      host,
      done: true,
      hot: false,
    }));
  }, [events, seedIndex]);

  return (
    <section className="cyber-panel relative overflow-hidden rounded-2xl p-5">
      <div className="pointer-events-none absolute inset-0 cyber-grid opacity-40" />
      <header className="relative flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-sky-400/40 bg-sky-500/10">
          <Radar className={`h-4 w-4 text-sky-300 ${scanning ? "animate-pulse" : ""}`} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">Global investigation radar</h3>
          <p className="text-[11px] text-sky-300/80">
            {scanning ? "Sweeping global distribution surface…" : "Radar idle — last sweep archived"}
          </p>
        </div>
      </header>

      <div className="relative mt-4 grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="relative mx-auto aspect-square w-full max-w-[280px]">
          <div className="absolute inset-0 rounded-full border border-sky-400/25" />
          <div className="absolute inset-[14%] rounded-full border border-sky-400/20" />
          <div className="absolute inset-[30%] rounded-full border border-sky-400/15" />
          <div className="absolute inset-[46%] rounded-full border border-sky-400/10" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-sky-400/10" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-sky-400/10" />
          {scanning && (
            <>
              <div className="cyber-radar-sweep absolute inset-0 rounded-full" />
              <span className="cyber-radar-ping absolute inset-0 rounded-full border border-sky-400/30" />
            </>
          )}
          {blips.map((blip, i) => (
            <span
              key={blip.id}
              className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                blip.hot ? "bg-red-400 cyber-blip-hot" : "bg-sky-300/80"
              }`}
              style={{
                left: `${50 + Math.cos((blip.angle * Math.PI) / 180) * blip.radius}%`,
                top: `${50 + Math.sin((blip.angle * Math.PI) / 180) * blip.radius}%`,
                animationDelay: `${(i % 8) * 120}ms`,
              }}
              aria-hidden
            />
          ))}
        </div>

        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-widest text-sky-300/70">
            Investigating…
          </p>
          <ul
            ref={listRef}
            className="mt-2 max-h-[240px] space-y-1 overflow-y-auto pr-1 font-mono text-xs"
            aria-live="polite"
          >
            {stream.map((row) => (
              <li
                key={row.key}
                className={`cyber-stream-row flex items-center gap-2 rounded px-2 py-1 ${
                  row.hot ? "bg-red-500/10 text-red-300" : "text-emerald-300/90"
                }`}
              >
                <span className={row.done ? "" : "animate-pulse"}>{row.done ? "✓" : "›"}</span>
                <span className="truncate">{row.host}</span>
              </li>
            ))}
          </ul>

          {counters.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {counters.map((c) => (
                <div
                  key={c.label}
                  className="rounded-lg border border-sky-400/20 bg-sky-500/5 px-2 py-1.5"
                >
                  <div className="text-sm font-semibold text-slate-100">{c.value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-sky-300/70">
                    {c.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default CyberRadar;
