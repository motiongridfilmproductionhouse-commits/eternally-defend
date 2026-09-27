import { useEffect, useRef, useState } from "react";

/**
 * Eterna Citadel introduction. Runs only AFTER the existing Eterna boot
 * animation finishes; it never touches the logo or its animation.
 * Every status shown comes from the real getCitadelStatus check.
 */

export type CitadelSystem = { key: string; label: string; state: string };
type Stage = "welcome" | "core" | "eip" | "pipeline" | "overview" | "online";

const NODES: { key: string; label: string; desc: string; pos: string }[] = [
  { key: "monitoring", label: "Monitoring", desc: "Continuous public-source monitoring", pos: "n-top" },
  { key: "eip", label: "EIP", desc: "Image Immunization & Validation", pos: "n-right" },
  { key: "identity", label: "Identity Intelligence", desc: "Identity resolution and live scans", pos: "n-br" },
  { key: "enforcement", label: "Enforcement", desc: "Protection actions and case operations", pos: "n-bl" },
  { key: "evidence", label: "Evidence", desc: "Verified evidence and source intelligence", pos: "n-left" },
  { key: "protection", label: "Protection Operations", desc: "Client protection workflows", pos: "n-tl" },
];
const CONNECT_ORDER = ["identity", "evidence", "enforcement", "monitoring", "protection", "eip"];
const EIP_STEPS = ["Image Input", "Identity Analysis", "Immunization", "Validation", "Protected Output"];

const rm = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isOk = (s?: string) => s === "CONNECTED";

export function CitadelIntro({
  name,
  returning,
  loadStatus,
  onDone,
}: {
  name: string | null;
  /** true → shortened flow */
  returning: boolean;
  loadStatus: () => Promise<CitadelSystem[]>;
  onDone: () => void;
}) {
  const reduced = rm();
  const [stage, setStage] = useState<Stage>("welcome");
  const [linked, setLinked] = useState<string[]>([]);
  const [step, setStep] = useState(-1);
  const [eipLinked, setEipLinked] = useState(false);
  const [systems, setSystems] = useState<CitadelSystem[] | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const doneRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    setTimeout(onDone, reduced ? 0 : 1100);
  };

  useEffect(() => {
    loadStatus()
      .then(setSystems)
      .catch(() => setStatusError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cursor parallax → CSS vars.
  useEffect(() => {
    if (reduced) return;
    const el = rootRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      el.style.setProperty("--px", x.toFixed(3));
      el.style.setProperty("--py", y.toFixed(3));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced]);

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(finish, 4000);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const go = (s: Stage) => !cancelled && setStage(s);
    (async () => {
      if (returning) {
        await sleep(1400);
        go("core");
        setLinked(CONNECT_ORDER);
        await sleep(1400);
        go("online");
        await sleep(2400);
        if (!cancelled) finish();
        return;
      }
      await sleep(4200);
      go("core");
      await sleep(2200);
      for (const k of CONNECT_ORDER.slice(0, -1)) {
        if (cancelled) return;
        setLinked((l) => [...l, k]);
        await sleep(1000);
      }
      await sleep(600);
      go("eip");
      await sleep(2600);
      if (cancelled) return;
      setLinked((l) => [...l, "eip"]);
      setEipLinked(true);
      await sleep(3600);
      go("pipeline");
      for (let i = 0; i < EIP_STEPS.length; i++) {
        if (cancelled) return;
        setStep(i);
        await sleep(1100);
      }
      await sleep(1400);
      go("overview");
      await sleep(3400);
      go("online");
      await sleep(3200);
      if (!cancelled) finish();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stateOf = (k: string) => systems?.find((s) => s.key === k)?.state;
  const eipState = stateOf("eip");
  const eipOk = isOk(eipState);
  const allOk = !!systems && systems.every((s) => isOk(s.state));
  const hello = name ? `${returning ? "Welcome back" : "Welcome"}, ${name}` : returning ? "Welcome back" : "Welcome";

  if (reduced) {
    return (
      <div className={`cx${leaving ? " is-leaving" : ""}`} role="dialog" aria-label="Eterna Citadel">
        <div className="cx-center">
          <p className="cx-hello">{hello}</p>
          <h1 className="cx-title">ETERNA CITADEL</h1>
          <StatusList systems={systems} error={statusError} />
        </div>
      </div>
    );
  }

  const showNodes = stage === "core" || stage === "eip" || stage === "overview";

  return (
    <div
      ref={rootRef}
      className={`cx cx-stage-${stage}${leaving ? " is-leaving" : ""}`}
      role="dialog"
      aria-label="Eterna Citadel"
    >
      <div className="cx-dust" aria-hidden="true" />
      <div className={`cx-sphere-wrap${stage === "welcome" ? "" : " is-on"}${stage === "pipeline" ? " is-dim" : ""}`}>
        <div className="cx-parallax">
          <CitadelSphere />
          {stage === "core" && (
            <div className="cx-core-label">
              <span>CITADEL CORE</span>
              <small>{linked.length < CONNECT_ORDER.length - 1 ? "Connecting systems…" : "Systems linked"}</small>
            </div>
          )}
        </div>
        <svg className={`cx-links${showNodes ? " is-on" : ""}`} viewBox="0 0 100 100" aria-hidden="true">
          {NODES.map((n) => {
            const on = linked.includes(n.key);
            const p = NODE_XY[n.pos]!;
            return (
              <line
                key={n.key}
                x1="50"
                y1="50"
                x2={p[0]}
                y2={p[1]}
                className={`cx-link${on ? " is-on" : ""}${n.key === "eip" ? " is-eip" : ""}${hover === n.key ? " is-hover" : ""}`}
              />
            );
          })}
        </svg>
        {NODES.map((n) => {
          const on = linked.includes(n.key);
          const st = stateOf(n.key);
          return (
            <button
              type="button"
              key={n.key}
              className={`cx-node ${n.pos}${showNodes ? " is-shown" : ""}${on ? " is-on" : ""}${n.key === "eip" ? " is-eip" : ""}${stage === "eip" && n.key !== "eip" ? " is-muted" : ""}`}
              onMouseEnter={() => setHover(n.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n.key)}
              onBlur={() => setHover(null)}
            >
              <i className="cx-node-dot" />
              <span className="cx-node-label">{n.label}</span>
              {on && st && <b className={isOk(st) ? "ok" : "warn"}>{st}</b>}
              <span className="cx-node-desc">{n.desc}</span>
            </button>
          );
        })}
      </div>

      <div className="cx-center">
        {stage === "welcome" && (
          <div key="w">
            <p className="cx-hello cx-in">{hello}</p>
            {!returning && (
              <p className="cx-appreciation cx-in" style={{ animationDelay: "0.6s" }}>
                Thank you for your dedication and outstanding effort in onboarding Eterna clients.
              </p>
            )}
            <h1 className="cx-title cx-in" style={{ animationDelay: "1.1s" }}>
              ETERNA CITADEL
            </h1>
            <p className="cx-sub cx-in" style={{ animationDelay: "1.7s" }}>
              Central Intelligence &amp; Protection System
            </p>
            <p className="cx-eyebrow cx-in cx-pulse" style={{ animationDelay: "2.4s", marginTop: 26 }}>
              INITIALIZING CONNECTED PROTECTION SYSTEMS
            </p>
          </div>
        )}
        {stage === "eip" && (
          <div key="e" className="cx-eip-moment">
            <p className="cx-eyebrow cx-in">NEW SYSTEM CONNECTION</p>
            <h1 className="cx-lead cx-in" style={{ animationDelay: "0.4s" }}>
              Eterna Image Immunization
            </h1>
            {!eipLinked ? (
              <p className="cx-sub cx-in cx-pulse" style={{ animationDelay: "0.9s" }}>
                Connecting EIP to Citadel
              </p>
            ) : (
              <>
                <p className={`cx-eip-state cx-in ${eipOk ? "ok" : "warn"}`}>
                  {eipOk ? "EIP CONNECTED" : "EIP INTEGRATED · ENGINE PENDING"}
                </p>
                <p className="cx-sub cx-in" style={{ animationDelay: "0.4s", maxWidth: 520 }}>
                  {eipOk
                    ? "Image Immunization is now integrated with Eterna Citadel. Protection intelligence, processing, validation and protected outputs are available through the Citadel environment."
                    : "Image Immunization is integrated with Eterna Citadel. Processing begins once the protection engine link is active."}
                </p>
              </>
            )}
          </div>
        )}
        {stage === "pipeline" && (
          <div key="p">
            <EipOrb step={step} />
            <div className="cx-steps">
              {EIP_STEPS.map((s, i) => (
                <span key={s} className={`cx-step${step >= i ? " is-on" : ""}${step === i ? " is-now" : ""}`}>
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
        {stage === "overview" && (
          <div key="v" className="cx-overlay">
            <h1 className="cx-title cx-in">CITADEL</h1>
            <p className="cx-sub cx-in" style={{ animationDelay: "0.8s" }}>
              {allOk ? "All available systems connected" : "Available systems connected"}
            </p>
            <p className="cx-eyebrow cx-in" style={{ animationDelay: "1.6s", marginTop: 14 }}>
              ETERNA CITADEL IS READY
            </p>
          </div>
        )}
        {stage === "online" && (
          <div key="o" className="cx-overlay">
            <h1 className="cx-title cx-in">CITADEL ONLINE</h1>
            <p className="cx-sub cx-in" style={{ animationDelay: "0.3s" }}>
              {hello}
            </p>
            <div className="cx-in" style={{ animationDelay: "0.6s" }}>
              <StatusList systems={systems} error={statusError} />
            </div>
            <button type="button" className="cx-enter cx-in" style={{ animationDelay: "0.9s" }} onClick={finish}>
              Enter Citadel →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const NODE_XY: Record<string, [number, number]> = {
  "n-top": [50, 2],
  "n-right": [100, 42],
  "n-br": [84, 92],
  "n-bl": [16, 92],
  "n-left": [0, 42],
  "n-tl": [14, 10],
};

function StatusList({ systems, error }: { systems: CitadelSystem[] | null; error: boolean }) {
  return (
    <ul className="cx-status">
      {error && <li className="cx-status-row">Status unavailable</li>}
      {!error && !systems && <li className="cx-status-row">Checking systems…</li>}
      {systems?.map((s) => (
        <li key={s.key} className={`cx-status-row${s.key === "eip" ? " is-eip" : ""}`}>
          <span>{s.label.toUpperCase()}</span>
          <b className={isOk(s.state) ? "is-ready" : "is-warn"}>
            <i className="cx-led" />
            {s.state}
          </b>
        </li>
      ))}
    </ul>
  );
}

/** EIP energy orb: image enters, scan ring passes, particles lock, protected image exits. */
function EipOrb({ step }: { step: number }) {
  return (
    <div className={`cx-orb s-${step}`} aria-hidden="true">
      <div className="cx-orb-core" />
      <div className="cx-orb-ring" />
      <div className="cx-orb-lock" />
      <span className="cx-orb-in">▢</span>
      <span className="cx-orb-out">◈</span>
    </div>
  );
}

/** Particle sphere with cursor-reactive rotation. */
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
    const N = 2200;
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      const j = 1 + (Math.random() - 0.5) * 0.08;
      return { x: Math.cos(th) * r * j, y: y * j, z: Math.sin(th) * r * j, h: Math.random() };
    });
    let mx = 0,
      my = 0,
      tx = 0,
      ty = 0;
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 0.6;
      ty = (e.clientY / window.innerHeight - 0.5) * 0.4;
    };
    window.addEventListener("pointermove", onMove);
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      mx += (tx - mx) * 0.04;
      my += (ty - my) * 0.04;
      const a = t * 0.1 + mx;
      const tilt = 0.35 + my;
      const pulse = 1 + Math.sin(t * 0.9) * 0.012;
      const c = W / 2;
      const R = W * 0.36 * pulse;
      ctx.clearRect(0, 0, W, W);
      ctx.globalCompositeOperation = "lighter";
      for (const p of pts) {
        const x1 = p.x * Math.cos(a) - p.z * Math.sin(a);
        const z1 = p.x * Math.sin(a) + p.z * Math.cos(a);
        const y2 = p.y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = p.y * Math.sin(tilt) + z1 * Math.cos(tilt);
        const depth = (z2 + 1) / 2;
        const alpha = 0.1 + depth * 0.5;
        ctx.fillStyle =
          p.h > 0.94
            ? `rgba(214,110,220,${alpha * 0.7})`
            : p.h > 0.55
              ? `rgba(128,112,255,${alpha})`
              : `rgba(86,140,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(c + x1 * R, c + y2 * R, (0.4 + depth * 0.8) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return (
    <>
      <div className="cx-glow" aria-hidden="true" />
      <canvas ref={ref} className="cx-sphere" aria-hidden="true" />
    </>
  );
}
