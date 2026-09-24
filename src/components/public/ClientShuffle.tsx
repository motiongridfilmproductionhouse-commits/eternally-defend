import { useEffect, useMemo, useRef, useState } from "react";
import { Quote, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type ClientCard = {
  category: string;
  quote: string;
  role: string;
};

// Role-attributed feedback only. Client names are confidential by policy.
const CLIENT_CARDS: ClientCard[] = [
  {
    category: "Film industry",
    quote:
      "Every alert about our talent is read by a person before anything happens. That discipline is why we stayed.",
    role: "Film industry public figure",
  },
  {
    category: "Public affairs",
    quote:
      "Impersonation accounts were surfaced quickly, and the response was measured — evidence first, action only when authorized.",
    role: "Public affairs representative",
  },
  {
    category: "Enterprise",
    quote:
      "We engaged Eterna while an executive was under coordinated attack. The reporting was calm, factual and board-ready.",
    role: "Enterprise client",
  },
  {
    category: "Music & entertainment",
    quote:
      "In a situation that could have spiralled, the communication stayed clear and human. Nothing escalated without our approval.",
    role: "Artist management",
  },
  {
    category: "Public figures",
    quote:
      "What we value most is discretion. The work happens quietly in the background, and we hear about what matters.",
    role: "Public figure representative",
  },
];

const SHUFFLE_INTERVAL_MS = 4200;
const EXIT_MS = 520;

export function ClientShuffleCards() {
  const total = CLIENT_CARDS.length;
  const [order, setOrder] = useState<number[]>(() =>
    Array.from({ length: total }, (_, i) => i),
  );
  const [exiting, setExiting] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (
      paused ||
      exiting !== null ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const interval = setInterval(() => {
      setExiting(order[0]);
      const rotate = setTimeout(() => {
        setOrder((current) => [...current.slice(1), current[0]]);
        setExiting(null);
      }, EXIT_MS);
      timers.current.push(rotate);
    }, SHUFFLE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [order, paused, exiting]);

  const bringToFront = (cardIndex: number) => {
    if (exiting !== null) return;
    setOrder((current) => [cardIndex, ...current.filter((i) => i !== cardIndex)]);
  };

  const depthOf = useMemo(() => {
    const map = new Map<number, number>();
    order.forEach((cardIndex, depth) => map.set(cardIndex, depth));
    return map;
  }, [order]);

  return (
    <div
      className="relative mx-auto h-[380px] w-full max-w-md select-none sm:h-[400px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {CLIENT_CARDS.map((card, cardIndex) => {
        const depth = depthOf.get(cardIndex) ?? total;
        const isFront = depth === 0;
        const drift = depth % 2 === 1 ? 1 : -1;
        return (
          <article
            key={card.category}
            aria-hidden={!isFront}
            onClick={() => !isFront && bringToFront(cardIndex)}
            style={{
              zIndex: total - depth,
              transform: isFront
                ? "translate(0, 0) scale(1) rotate(0deg)"
                : `translate(${drift * (depth * 14)}px, ${depth * 16}px) scale(${1 - depth * 0.045}) rotate(${drift * depth * 1.6}deg)`,
              opacity: depth > 2 ? 0.45 : 1,
              pointerEvents: isFront ? "auto" : "none",
            }}
            className={cn(
              "absolute inset-x-4 top-0 cursor-pointer overflow-hidden rounded-xl border border-landing-line bg-landing shadow-[0_28px_60px_-38px_oklch(0.64_0.23_256/0.55)] transition-[transform,opacity] duration-500 ease-out sm:inset-x-0",
              exiting === cardIndex && "client-card-exit",
            )}
          >
            <div className="client-card-cover relative flex h-28 items-end justify-between overflow-hidden px-6 pb-4">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(135deg, oklch(0.38 0.16 262) 0%, oklch(0.55 0.21 256) 55%, oklch(0.68 0.22 250) 100%)",
                }}
              />
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  background:
                    "radial-gradient(120% 90% at 85% -10%, oklch(0.9 0.08 200/0.55), transparent 55%), radial-gradient(90% 80% at 10% 110%, oklch(0.3 0.12 262/0.7), transparent 60%)",
                }}
              />
              <div className="client-card-fluid absolute inset-y-0 -left-16 w-24 opacity-60" />
              <div className="relative z-10">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/70">
                  Client feedback
                </p>
                <p className="mt-1 text-sm font-semibold text-white">{card.category}</p>
              </div>
              <ShieldCheck className="relative z-10 size-5 text-white/80" aria-hidden="true" />
            </div>
            <div className="px-6 pb-6 pt-5">
              <Quote className="size-4 text-landing-accent" aria-hidden="true" />
              <p className="mt-3 font-landing-serif text-lg leading-7 text-landing-ink">
                “{card.quote}”
              </p>
              <div className="mt-5 flex items-center justify-between border-t border-landing-line pt-4">
                <p className="text-xs font-medium text-landing-ink">{card.role}</p>
                <p className="text-[10px] uppercase tracking-wide text-landing-muted">
                  Name confidential
                </p>
              </div>
            </div>
          </article>
        );
      })}
      <div className="absolute -bottom-2 left-1/2 z-50 flex -translate-x-1/2 gap-2">
        {CLIENT_CARDS.map((card, cardIndex) => (
          <button
            key={card.category}
            type="button"
            aria-label={`Show ${card.category} feedback`}
            onClick={() => bringToFront(cardIndex)}
            className={cn(
              "size-1.5 rounded-full transition-all duration-300",
              (depthOf.get(cardIndex) ?? -1) === 0
                ? "w-5 bg-landing-accent"
                : "bg-landing-line hover:bg-landing-accent/50",
            )}
          />
        ))}
      </div>
    </div>
  );
}
