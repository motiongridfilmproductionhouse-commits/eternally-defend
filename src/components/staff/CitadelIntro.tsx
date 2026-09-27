import { useEffect, useRef, useState } from "react";

/**
 * Eterna Citadel introduction. Runs only AFTER the existing Eterna boot
 * animation finishes; it never touches the logo or its animation.
 */

export type CitadelSystem = { key: string; label: string; state: string };
type Stage = "welcome" | "citadel" | "eip" | "online";

const CAPS = [
  "IDENTITY INTELLIGENCE",
  "MONITORING",
  "EVIDENCE",
  "ENFORCEMENT",
  "EIP",
  "PROTECTION OPERATIONS",
];
const EIP_STEPS = ["Image Intake", "Analysis", "Immunization", "Validation", "Protected Output"];

const rm = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CitadelIntro({
  name,
  returning,
  loadStatus,
  onDone,
}: {
  name: string | null;
  /** true → shortened flow without the EIP announcement */
  returning: boolean;
  loadStatus: () => Promise<CitadelSystem[]>;
  onDone: () => void;
}) {
  const reduced = rm();
  const [stage, setStage] = useState<Stage>("welcome");
  const [cap, setCap] = useState(-1);
  const [step, setStep] = useState(-1);
  const [systems, setSystems] = useState<CitadelSystem[] | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    setTimeout(onDone, reduced ? 0 : 700);
  };

  useEffect(() => {
    loadStatus()
      .then(setSystems)
      .catch(() => setStatusError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(finish, 2600);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    (async () => {
      await sleep(2600);
      if (cancelled) return;
      setStage("citadel");
      await sleep(1400);
      for (let i = 0; i < CAPS.length; i++) {
        if (cancelled) return;
        setCap(i);
        await sleep(returning ? 450 : 900);
      }
      setCap(-1);
      await sleep(500);
      if (cancelled) return;
      if (!returning) {
        setStage("eip");
        await sleep(2200);
        for (let i = 0; i < EIP_STEPS.length; i++) {
          if (cancelled) return;
          setStep(i);
          await sleep(650);
        }
        await sleep(1800);
        if (cancelled) return;
      }
      setStage("online");
      await sleep(4200);
      if (!cancelled) finish();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hello = name ? `${returning ? "Welcome back" : "Welcome"}, ${name}` : returning ? "Welcome back" : "Welcome";

  if (reduced) {
    return (
      <div className={`cx${leaving ? " is-leaving" : ""}`} role="dialog" aria-label="Eterna Citadel">
        <div className="cx-center">
          <p className="cx-hello">{hello}</p>
          <p className="cx-appreciation">Thank you for your dedication and outstanding effort in onboarding Eterna clients.</p>
          <h1 className="cx-title">ETERNA CITADEL</h1>
          {!returning && <p className="cx-sub">EIP is now integrated</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={`cx${leaving ? " is-leaving" : ""}`} role="dialog" aria-label="Eterna Citadel">
      <button type="button" className="cx-skip" onClick={finish}>
        Skip →
      </button>

      <div className={`cx-sphere-wrap${stage === "welcome" ? "" : " is-on"}${stage === "eip" ? " is-dim" : ""}`}>
        <CitadelSphere />
        {CAPS.map((c, i) => (
          <span key={c} className={`cx-cap cx-cap-${i}${cap === i ? " is-on" : ""}`}>
            {c}
          </span>
        ))}
      </div>

      <div className="cx-center">
        {stage === "welcome" && (
          <div key="w">
            <p className="cx-hello cx-in">{hello}</p>
            <h1 className="cx-lead cx-in" style={{ animationDelay: "0.9s" }}>
              Welcome to Eterna Citadel
            </h1>
            <p className="cx-appreciation cx-in" style={{ animationDelay: "1.4s" }}>
              Thank you for your dedication and outstanding effort in onboarding Eterna clients.
            </p>
            <p className="cx-sub cx-in" style={{ animationDelay: "1.8s" }}>
              Eterna’s central protection and intelligence environment.
            </p>
          </div>
        )}
        {stage === "citadel" && (
          <div key="c" className="cx-overlay">
            <h1 className="cx-title cx-in">ETERNA CITADEL</h1>
            <p className="cx-sub cx-in" style={{ animationDelay: "0.5s" }}>
              Central Intelligence &amp; Protection System
            </p>
          </div>
        )}
        {stage === "eip" && (
          <div key="e">
            <p className="cx-eyebrow cx-in">NEW IN CITADEL</p>
            <h1 className="cx-lead cx-in" style={{ animationDelay: "0.4s" }}>
              Eterna Image Immunization
            </h1>
            <p className="cx-sub cx-in" style={{ animationDelay: "0.9s", maxWidth: 520 }}>
              EIP is now integrated into Eterna Citadel, bringing image protection, validation and
              protection intelligence into the central Eterna environment.
            </p>
            <div className="cx-steps">
              {EIP_STEPS.map((s, i) => (
                <span key={s} className={`cx-step${step >= i ? " is-on" : ""}`}>
                  {i > 0 && <i className="cx-arrow">→</i>}
                  {s}
                </span>
              ))}
            </div>
            <p className={`cx-note${step >= EIP_STEPS.length - 1 ? " is-on" : ""}`}>
              Designed to strengthen resistance against AI-driven identity manipulation.
            </p>
          </div>
        )}
        {stage === "online" && (
          <div key="o" className="cx-overlay">
            <h1 className="cx-title cx-in">CITADEL ONLINE</h1>
            <p className="cx-sub cx-in" style={{ animationDelay: "0.4s" }}>
              Protection environment ready
            </p>
            <ul className="cx-status cx-in" style={{ animationDelay: "0.8s" }}>
              {statusError && <li className="cx-status-row">Status unavailable</li>}
              {!statusError && !systems && <li className="cx-status-row">Checking systems…</li>}
              {systems?.map((s) => (
                <li key={s.key} className="cx-status-row">
                  <span>{s.label.toUpperCase()}</span>
                  <b className={s.state === "READY" ? "is-ready" : "is-warn"}>{s.state}</b>
                </li>
              ))}
            </ul>
            <button type="button" className="cx-enter cx-in" style={{ animationDelay: "1.2s" }} onClick={finish}>
              Enter Citadel →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Particle sphere: fine points on a slowly rotating shell. */
function CitadelSphere() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth * dpr;
    canvas.width = W;
    canvas.height = W;
    const N = 1400;
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      const j = 1 + (Math.random() - 0.5) * 0.08;
      return { x: Math.cos(th) * r * j, y: y * j, z: Math.sin(th) * r * j, h: Math.random() };
    });
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const a = t * 0.12;
      const tilt = 0.35;
      const c = W / 2;
      const R = W * 0.36;
      ctx.clearRect(0, 0, W, W);
      ctx.globalCompositeOperation = "lighter";
      for (const p of pts) {
        const x1 = p.x * Math.cos(a) - p.z * Math.sin(a);
        const z1 = p.x * Math.sin(a) + p.z * Math.cos(a);
        const y2 = p.y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = p.y * Math.sin(tilt) + z1 * Math.cos(tilt);
        const depth = (z2 + 1) / 2;
        const alpha = 0.12 + depth * 0.55;
        const col =
          p.h > 0.93
            ? `rgba(214,110,220,${alpha * 0.7})`
            : p.h > 0.55
              ? `rgba(128,112,255,${alpha})`
              : `rgba(86,140,255,${alpha})`;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(c + x1 * R, c + y2 * R, (0.5 + depth * 0.9) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div className="cx-glow" aria-hidden="true" />
      <canvas ref={ref} className="cx-sphere" aria-hidden="true" />
    </>
  );
}
