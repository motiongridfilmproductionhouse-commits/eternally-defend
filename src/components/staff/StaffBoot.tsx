import { useEffect, useRef, useState } from "react";

/**
 * Eterna boot sequence. The visual timeline is choreographed, but the status
 * line only advances when the matching REAL check resolves:
 *   INITIALIZING                       → signed-in session present
 *   CONNECTING INTELLIGENCE LAYER      → server confirms the staff role
 *   LOADING PUBLIC-SOURCE DISCOVERY    → server reports source readiness
 *   READY
 */

export type BootCheck = () => Promise<void>;

const STATUS = [
  "INITIALIZING",
  "CONNECTING INTELLIGENCE LAYER",
  "LOADING PUBLIC-SOURCE DISCOVERY",
  "READY",
] as const;

type Phase = "logo" | "ring" | "text" | "status";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function StaffBoot({
  logoSrc,
  checks,
  onDone,
}: {
  logoSrc: string;
  /** [session, staff access, discovery readiness] — each must resolve. */
  checks: [BootCheck, BootCheck, BootCheck];
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("logo");
  const [statusIdx, setStatusIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    setTimeout(onDone, reducedMotion() ? 0 : 850);
  };

  // Choreography + real checks.
  useEffect(() => {
    let cancelled = false;
    const rm = reducedMotion();
    (async () => {
      const t = (ms: number) => sleep(rm ? 0 : ms);
      await t(1500);
      if (cancelled) return;
      setPhase("ring");
      await t(1100);
      if (cancelled) return;
      setPhase("text");
      await t(1200);
      if (cancelled) return;
      setPhase("status");
      for (let i = 0; i < 3; i++) {
        setStatusIdx(i);
        const started = Date.now();
        try {
          await checks[i]!();
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "Check failed");
          return;
        }
        const elapsed = Date.now() - started;
        await t(Math.max(0, 750 - elapsed));
        if (cancelled) return;
      }
      setStatusIdx(3);
      await t(900);
      if (!cancelled) finish();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Particles / data points drifting toward the core.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rm = reducedMotion();
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      const w = canvas.clientWidth;
      canvas.width = w * dpr;
      canvas.height = w * dpr;
    };
    size();
    const parts = Array.from({ length: 70 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.28 + Math.random() * 0.22,
      s: 0.00005 + Math.random() * 0.00012,
      z: 0.3 + Math.random() * 0.7,
    }));
    const start = performance.now();
    const draw = (now: number) => {
      const w = canvas.width;
      const c = w / 2;
      const t = now - start;
      const fadeIn = Math.min(1, Math.max(0, (t - 1800) / 1400));
      ctx.clearRect(0, 0, w, w);
      for (const p of parts) {
        if (!rm) {
          p.r -= p.s * 6;
          p.a += p.s * 4;
          if (p.r < 0.2) p.r = 0.5;
        }
        const x = c + Math.cos(p.a) * p.r * w;
        const y = c + Math.sin(p.a) * p.r * w;
        const alpha = Math.min(1, (p.r - 0.2) * 4) * 0.6 * p.z * fadeIn;
        ctx.fillStyle = p.z > 0.75 ? `rgba(79,212,238,${alpha})` : `rgba(140,160,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, (0.6 + p.z) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!rm) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`sx-boot${leaving ? " is-leaving" : ""}`}
      data-phase={phase}
      role="status"
      aria-live="polite"
    >
      <div className="sx-boot-stage">
        <div className="sx-boot-core">
          <canvas ref={canvasRef} className="sx-boot-canvas" aria-hidden="true" />
          <svg className="sx-boot-ring" viewBox="0 0 200 200" aria-hidden="true">
            <defs>
              <linearGradient id="sxRing" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#4fd4ee" />
                <stop offset="0.5" stopColor="#5b8cff" />
                <stop offset="1" stopColor="#9b85ff" />
              </linearGradient>
            </defs>
            <circle
              cx="100"
              cy="100"
              r="96"
              fill="none"
              stroke="rgba(150,176,255,0.08)"
              strokeWidth="0.6"
            />
            <g className="spin">
              <circle
                cx="100"
                cy="100"
                r="88"
                fill="none"
                stroke="url(#sxRing)"
                strokeWidth="1.1"
                strokeDasharray="120 433"
                strokeLinecap="round"
              />
              <circle cx="188" cy="100" r="2" fill="#4fd4ee" />
            </g>
            <g className="spin-rev">
              <circle
                cx="100"
                cy="100"
                r="78"
                fill="none"
                stroke="rgba(155,133,255,0.35)"
                strokeWidth="0.7"
                strokeDasharray="2 6"
              />
            </g>
            {Array.from({ length: 72 }, (_, i) => {
              const a = (i / 72) * Math.PI * 2;
              const r1 = 96;
              const r2 = i % 6 ? 93.5 : 90;
              return (
                <line
                  key={i}
                  x1={100 + Math.cos(a) * r1}
                  y1={100 + Math.sin(a) * r1}
                  x2={100 + Math.cos(a) * r2}
                  y2={100 + Math.sin(a) * r2}
                  stroke="rgba(150,176,255,0.22)"
                  strokeWidth="0.6"
                />
              );
            })}
          </svg>
          <div className="sx-boot-logo">
            <img src={logoSrc} alt="Eterna" />
            <span className="sweep" aria-hidden="true" />
          </div>
          <div className="sx-boot-reflection" aria-hidden="true">
            <img src={logoSrc} alt="" />
          </div>
          <div className="sx-boot-floor" aria-hidden="true" />
        </div>
        <div className="sx-boot-word">ETERNA</div>
        <div className="sx-boot-sub">Identity Intelligence System</div>
        <div
          className={`sx-boot-status${statusIdx === 3 ? " is-ready" : ""}${error ? " is-error" : ""}`}
        >
          <span className="dot" />
          <span>{error ? `UNAVAILABLE · ${error.toUpperCase()}` : STATUS[statusIdx]}</span>
        </div>
      </div>
      {!error ? (
        <button type="button" className="sx-boot-skip" onClick={finish}>
          SKIP
        </button>
      ) : null}
    </div>
  );
}
