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
];
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

    let transitionTimer: number | undefined;
    const interval = window.setInterval(() => {
      setIsTransitioning(true);
      transitionTimer = window.setTimeout(() => {
        setActivePlatform((current) => (current + 1) % platforms.length);
        setIsTransitioning(false);
      }, transitionDuration / 2);
    }, 2000);

    return () => {
      window.clearInterval(interval);
      if (transitionTimer) window.clearTimeout(transitionTimer);
    };
  }, [isVisible, prefersReducedMotion]);

  const platformClassName =
    "flex size-12 items-center justify-center border border-landing-line text-landing-muted transition-[opacity,transform,border-color,color] duration-[400ms] hover:border-landing-ink hover:text-landing-ink";
  const { name: activePlatformName, Icon: ActivePlatformIcon } = platforms[activePlatform];

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
          {platforms.map(({ name, Icon }) => (
            <span key={name} className={platformClassName}>
              <Icon className="size-6" strokeWidth={1.5} aria-hidden="true" />
              <span className="sr-only">{name}</span>
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
            <ActivePlatformIcon className="size-7" strokeWidth={1.5} aria-hidden="true" />
            <span className="sr-only">{activePlatformName}</span>
          </span>
        </div>
      )}
    </div>
  );
}
