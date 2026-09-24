import { useEffect, useRef, useState } from "react";

type CountUpMetricProps = {
  value?: number;
  displayValue?: string;
  suffix?: string;
  label: string;
  detail?: string;
};

export function CountUpMetric({
  value,
  displayValue,
  suffix = "",
  label,
  detail,
}: CountUpMetricProps) {
  const metricRef = useRef<HTMLDivElement>(null);
  const [currentValue, setCurrentValue] = useState(value === undefined ? displayValue : "0");

  useEffect(() => {
    if (value === undefined) return;
    const element = metricRef.current;
    if (!element) return;

    let frame = 0;
    let started = false;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => setCurrentValue(`${value.toLocaleString()}${suffix}`);

    const animate = () => {
      const start = performance.now();
      const duration = 1400;
      const tick = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setCurrentValue(`${Math.round(value * eased).toLocaleString()}${suffix}`);
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (started) return;
      started = true;
      if (prefersReducedMotion) finish();
      else animate();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          start();
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [suffix, value]);

  return (
    <div ref={metricRef} className="metric-cell bg-landing py-8 sm:px-6">
      <span className="metric-rule" aria-hidden="true" />
      <p className="metric-number text-4xl font-medium" aria-label={`${currentValue} ${label}`}>
        {currentValue}
      </p>
      <p className="metric-label mt-2 text-xs text-landing-muted">{label}</p>
      {detail && (
        <p className="metric-label mt-3 text-[10px] uppercase tracking-wide text-landing-muted">
          {detail}
        </p>
      )}
    </div>
  );
}
