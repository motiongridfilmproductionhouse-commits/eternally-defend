import { useEffect, useState } from "react";
import { threatTone } from "@/lib/copyright/domain-intel";

export type ThreatGaugeProps = {
  score: number;
  label?: string;
  size?: number;
  caption?: string;
};

/** Animated threat gauge with green → yellow → orange → red transitions. */
export function ThreatGauge({ score, label = "Threat level", size = 132, caption }: ThreatGaugeProps) {
  const target = Math.max(0, Math.min(100, Math.round(score)));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = display;
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const tone = threatTone(display);
  const radius = size / 2 - 10;
  const circumference = Math.PI * radius * 1.5;
  const offset = circumference * (1 - display / 100);

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size * 0.78} viewBox={`0 0 ${size} ${size * 0.78}`} role="img" aria-label={`${label} ${display}%`}>
        <path
          d={`M 10 ${size * 0.62} A ${radius} ${radius} 0 1 1 ${size - 10} ${size * 0.62}`}
          fill="none"
          stroke="rgba(148,163,184,0.18)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d={`M 10 ${size * 0.62} A ${radius} ${radius} 0 1 1 ${size - 10} ${size * 0.62}`}
          fill="none"
          stroke={tone.color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 0 8px ${tone.ring})`, transition: "stroke 300ms ease" }}
        />
        <text
          x="50%"
          y={size * 0.52}
          textAnchor="middle"
          className="fill-slate-100"
          style={{ fontSize: size * 0.22, fontWeight: 700 }}
        >
          {display}%
        </text>
      </svg>
      <div className="-mt-1 text-center">
        <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
        <div className="text-sm font-semibold" style={{ color: tone.color }}>
          {tone.label}
        </div>
        {caption && <div className="mt-0.5 text-[10px] text-slate-500">{caption}</div>}
      </div>
    </div>
  );
}

export default ThreatGauge;
