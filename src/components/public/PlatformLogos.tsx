import { useEffect, useRef, useState } from "react";

const platforms = ["YouTube", "Instagram", "Facebook", "X", "Reddit", "TikTok", "Web"];
const transitionDuration = 400;

export function PlatformLogos() {
  const showcaseRef = useRef<HTMLDivElement>(null);
  const [activePlatform, setActivePlatform] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
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
    if (!element || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), {
      threshold: 0.1,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || !isVisible) {
      setIsTransitioning(false);
      return;
    }

    const interval = window.setInterval(() => {
      setIsTransitioning(true);
      window.setTimeout(() => {
        setActivePlatform((current) => (current + 1) % platforms.length);
        setIsTransitioning(false);
      }, transitionDuration / 2);
    }, 2000);

    return () => window.clearInterval(interval);
  }, [isVisible, prefersReducedMotion]);

  const platformClassName =
    "border border-landing-line px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-landing-muted transition-[opacity,transform,border-color,color] duration-[400ms] hover:border-landing-ink hover:text-landing-ink";

  return (
    <div
      ref={showcaseRef}
      className="mt-5"
      aria-label="Supported platforms: YouTube, Instagram, Facebook, X, Reddit, TikTok, and Web"
    >
      <p className="sr-only">
        Supported platforms: YouTube, Instagram, Facebook, X, Reddit, TikTok, and Web.
      </p>
      {prefersReducedMotion ? (
        <div className="flex flex-wrap gap-2" aria-hidden="true">
          {platforms.map((platform) => (
            <span key={platform} className={platformClassName}>
              {platform}
            </span>
          ))}
        </div>
      ) : (
        <div className="relative h-7" aria-hidden="true">
          <span
            className={`${platformClassName} absolute left-0 top-0 ${
              isTransitioning ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100"
            }`}
          >
            {platforms[activePlatform]}
          </span>
        </div>
      )}
    </div>
  );
}
