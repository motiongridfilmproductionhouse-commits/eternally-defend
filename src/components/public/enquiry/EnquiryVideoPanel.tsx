import { useEffect, useRef, useState } from "react";

import heroPoster from "@/assets/eterna-hero-poster.jpg.asset.json";
import heroVideoMp4 from "@/assets/eterna-hero.mp4.asset.json";
import heroVideoWebm from "@/assets/eterna-hero.webm.asset.json";
import { EternaLogo } from "@/components/public/PublicSite";

/**
 * Premium visual panel toward the bottom of the modal — reuses the same
 * approved footage as the homepage's "Meet your protection partner." final
 * CTA section (src/routes/index.tsx), not a different/new video, so the
 * modal never introduces unapproved footage. Desktop autoplays muted/looped;
 * on narrow viewports (and whenever the visitor prefers reduced motion) it
 * falls back to the static poster instead of forcing video playback.
 */
export function EnquiryVideoPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [allowVideo, setAllowVideo] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isNarrow = window.matchMedia("(max-width: 640px)").matches;
    setAllowVideo(!prefersReducedMotion && !isNarrow);
  }, []);

  return (
    <div className="eterna-enquiry-video relative min-h-[200px] overflow-hidden rounded-2xl border border-landing-line sm:min-h-[240px]">
      {allowVideo ? (
        <video
          ref={videoRef}
          className="absolute inset-0 size-full object-cover"
          muted
          loop
          autoPlay
          playsInline
          preload="none"
          poster={heroPoster.url}
          aria-hidden="true"
        >
          <source src={heroVideoWebm.url} type="video/webm" />
          <source src={heroVideoMp4.url} type="video/mp4" />
        </video>
      ) : (
        <img
          src={heroPoster.url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <div className="landing-cta-overlay absolute inset-0" />
      <div className="relative z-10 flex min-h-[200px] flex-col items-center justify-center px-6 py-10 text-center sm:min-h-[240px]">
        <EternaLogo inverse className="h-4 opacity-90 sm:h-5" alt="" />
        <p className="mt-4 text-lg font-medium leading-snug text-landing-on-media sm:text-xl">
          Eterna Sentinel
        </p>
        <p className="mt-2 max-w-sm text-sm leading-6 text-landing-on-media-muted">
          Identity protection begins with verified context.
        </p>
      </div>
    </div>
  );
}
