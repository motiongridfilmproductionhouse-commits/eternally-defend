import { useEffect, useRef, useState } from "react";
import { Facebook, Globe, Instagram, MessageCircle, Music2, Twitter, Youtube } from "lucide-react";

const platforms = [
  { name: "YouTube", Icon: Youtube },
  { name: "Instagram", Icon: Instagram },
  { name: "Facebook", Icon: Facebook },
  { name: "X", Icon: Twitter },
  { name: "Reddit", Icon: MessageCircle },
  { name: "TikTok", Icon: Music2 },
  { name: "Web", Icon: Globe },
] as const;

const transitionMs = 350;

export function PlatformLogos() {
  const showcaseRef = useRef<HTMLDivElement>(null);
  const [activePlatform, setActivePlatform] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updateMotionPreference();
    mediaQuery.addEventListener("change", updateMotionPreference);
    return () => mediaQuery.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    const element = showcaseRef.current;
    if (!element || !("IntersectionObserver" in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), {
      threshold: 0.1,
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || !isVisible) return;

    const intervalId = window.setInterval(() => {
      setActivePlatform((current) => (current + 1) % platforms.length);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [isVisible, prefersReducedMotion]);

  const descriptionId = "platform-coverage-description";

  return (
    <div ref={showcaseRef} className="mt-5">
      <p id={descriptionId} className="sr-only">
        Operational scale platform coverage includes YouTube, Instagram, Facebook, X, Reddit,
        TikTok, and Web.
      </p>

      {prefersReducedMotion ? (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Operational scale platform coverage"
          aria-describedby={descriptionId}
        >
          {platforms.map(({ name, Icon }) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-full border border-[#d7d7d5] bg-[#f6f5f3] px-2.5 py-1.5 text-[#1d2125]"
              aria-label={name}
            >
              <Icon
                className="size-5 shrink-0 text-[#1d2125]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#343a40]">
                {name}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="relative h-[88px] overflow-hidden"
          aria-label="Operational scale platform coverage"
          aria-describedby={descriptionId}
          aria-live="off"
        >
          {platforms.map(({ name, Icon }, index) => {
            const isActive = index === activePlatform;
            return (
              <div
                key={name}
                className={[
                  "absolute inset-x-0 top-0 flex items-center justify-center gap-3 transition-all ease-out",
                  isActive
                    ? "translate-y-0 opacity-100"
                    : "-translate-y-2 opacity-0 pointer-events-none",
                ].join(" ")}
                style={{
                  transitionDuration: `${transitionMs}ms`,
                  opacity: isActive ? 1 : 0,
                  visibility: isActive ? "visible" : "hidden",
                }}
                aria-hidden={!isActive}
              >
                <Icon className="size-8 text-[#1d2125]" strokeWidth={1.8} aria-hidden="true" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#343a40]">
                  {name}
                </span>
              </div>
            );
          })}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#f9f7f4] to-transparent" />
        </div>
      )}
    </div>
  );
}
