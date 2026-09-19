import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AudienceVisual = "person" | "organization" | "presence";

type AudienceCard = {
  number: string;
  title: string;
  label: string;
  description: string;
  visual: AudienceVisual;
};

const audiences: AudienceCard[] = [
  {
    number: "01",
    title: "Public figures",
    label: "Identity exposure",
    description:
      "Protection designed for people whose face, name and public identity may appear across large volumes of online content.",
    visual: "person",
  },
  {
    number: "02",
    title: "Organizations",
    label: "Organizational identity",
    description:
      "Protection for organizations whose executives, representatives, brands or visual assets may be reproduced, manipulated or misrepresented.",
    visual: "organization",
  },
  {
    number: "03",
    title: "Public-facing individuals",
    label: "Public presence",
    description:
      "Protection for creators, executives, professionals and other individuals whose identity has a meaningful public digital footprint.",
    visual: "presence",
  },
];

const lifecycleStages = [
  {
    number: "01",
    title: "Original image",
    short: "Authorized source image.",
    state: "ORIGINAL",
    detail:
      "Standard digital images may carry identity information that machine systems can analyze and reuse.",
  },
  {
    number: "02",
    title: "EIP process",
    short: "Image passes through Eterna Image Protection.",
    state: "PROCESSING",
    detail:
      "Eterna applies a defensive transformation to an authorized image before publication.",
  },
  {
    number: "03",
    title: "Protected output",
    short: "Human-visible appearance remains visually preserved.",
    state: "EIP PROTECTED",
    detail:
      "The image remains intended for normal human viewing while incorporating the EIP protection layer.",
  },
  {
    number: "04",
    title: "Public use",
    short: "Protected image may be used across authorized digital channels.",
    state: "PUBLISHED",
    detail:
      "The protected version becomes the preferred asset for authorized publishing workflows.",
  },
  {
    number: "05",
    title: "Defensive layer",
    short:
      "Designed to make reliable machine identity reuse more difficult across common AI identity workflows.",
    state: "DEFENSIVE SIGNAL",
    detail:
      "EIP is designed to reduce reliable machine identity fidelity when the protected image encounters common AI identity pipelines.",
  },
] as const;

function AudienceIllustration({ type }: { type: AudienceVisual }) {
  if (type === "organization") {
    return (
      <svg viewBox="0 0 320 170" role="presentation" focusable="false">
        <g className="eip-card-art__trace">
          <path d="M72 86H135M185 86H248M160 61V35M160 111V137" />
          <path d="M89 86 122 48M231 86l-33-38M89 86l33 38M231 86l-33 38" />
        </g>
        <g className="eip-card-art__nodes">
          <rect x="137" y="63" width="46" height="46" rx="8" />
          <circle cx="72" cy="86" r="14" />
          <circle cx="248" cy="86" r="14" />
          <circle cx="160" cy="28" r="10" />
          <circle cx="160" cy="144" r="10" />
          <circle cx="116" cy="43" r="7" />
          <circle cx="204" cy="43" r="7" />
          <circle cx="116" cy="129" r="7" />
          <circle cx="204" cy="129" r="7" />
        </g>
        <path className="eip-card-art__shield" d="M160 74l14 6v11c0 10-6 17-14 21-8-4-14-11-14-21V80l14-6Z" />
      </svg>
    );
  }

  if (type === "presence") {
    return (
      <svg viewBox="0 0 320 170" role="presentation" focusable="false">
        <g className="eip-card-art__surfaces">
          <rect x="52" y="45" width="79" height="92" rx="9" />
          <rect x="120" y="26" width="82" height="118" rx="10" />
          <rect x="191" y="48" width="77" height="88" rx="9" />
        </g>
        <g className="eip-card-art__trace">
          <path d="M91 91h29M202 91h28" />
          <path d="M161 58c17 0 30 14 30 31 0 16-13 30-30 30s-30-14-30-30c0-17 13-31 30-31Z" />
        </g>
        <circle className="eip-card-art__identity" cx="161" cy="82" r="10" />
        <path className="eip-card-art__identity" d="M143 108c3-12 11-18 18-18s15 6 18 18" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 320 170" role="presentation" focusable="false">
      <rect className="eip-card-art__frame" x="92" y="20" width="136" height="130" rx="14" />
      <path className="eip-card-art__corners" d="M80 56V25h31M240 56V25h-31M80 114v31h31M240 114v31h-31" />
      <circle className="eip-card-art__identity" cx="160" cy="72" r="23" />
      <path className="eip-card-art__identity" d="M119 130c7-28 22-42 41-42s34 14 41 42" />
      <path className="eip-card-art__scan" d="M101 84h118" />
    </svg>
  );
}

function AudienceCardView({ card }: { card: AudienceCard }) {
  return (
    <article className="eip-audience-card" tabIndex={0}>
      <div className="eip-audience-card__meta">
        <span>{card.number}</span>
        <span>{card.label}</span>
      </div>
      <div className="eip-card-art">
        <AudienceIllustration type={card.visual} />
      </div>
      <h3>{card.title}</h3>
      <p>{card.description}</p>
      <ArrowRight className="eip-audience-card__arrow" aria-hidden="true" />
    </article>
  );
}

function LifecycleImage({ activeIndex }: { activeIndex: number }) {
  const state = lifecycleStages[activeIndex]?.state ?? lifecycleStages[0].state;
  return (
    <div className={cn("eip-image-state", `eip-image-state--${activeIndex + 1}`)} aria-hidden="true">
      <div className="eip-image-state__frame">
        <span className="eip-image-state__corner eip-image-state__corner--tl" />
        <span className="eip-image-state__corner eip-image-state__corner--tr" />
        <span className="eip-image-state__corner eip-image-state__corner--bl" />
        <span className="eip-image-state__corner eip-image-state__corner--br" />
        <svg viewBox="0 0 340 300" role="presentation" focusable="false">
          <path className="eip-image-state__head" d="M170 62c35 0 62 29 62 65s-27 65-62 65-62-29-62-65 27-65 62-65Z" />
          <path className="eip-image-state__body" d="M72 286c9-57 47-92 98-92s89 35 98 92" />
          <g className="eip-image-state__mesh">
            <path d="M111 113h118M117 142h106M131 170h78M143 73l-25 99M170 63v130M197 73l25 99" />
            <circle cx="117" cy="142" r="3" /><circle cx="170" cy="63" r="3" />
            <circle cx="223" cy="142" r="3" /><circle cx="170" cy="193" r="3" />
          </g>
          <g className="eip-image-state__paths">
            <path d="M268 78c24 0 33-18 52-18" /><path d="M268 114h57" />
            <path d="M268 150c24 0 33 18 52 18" />
          </g>
        </svg>
        <span className="eip-image-state__scan" />
        <span className="eip-image-state__badge"><ShieldCheck /> Protected state</span>
      </div>
      <div className="eip-image-state__caption">
        <span>AUTHORIZED IMAGE · 01</span>
        <strong>{state}</strong>
      </div>
    </div>
  );
}

export function EipIdentityProtectionSection() {
  return (
    <section className="eip-identity-section border-t border-landing-line bg-landing-soft" aria-labelledby="eip-identities-heading">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <header className="eip-section-intro">
          <p className="landing-kicker">EIP / Identity protection</p>
          <div className="mt-5 grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-end">
            <h2 id="eip-identities-heading" className="max-w-3xl text-4xl font-medium leading-tight text-landing-ink md:text-6xl">
              Protection for identities that operate in public.
            </h2>
            <div className="space-y-4 text-sm leading-7 text-landing-muted">
              <p>
                Eterna supports public figures, organizations and public-facing individuals through confidential, authorized protection engagements.
              </p>
              <p>
                Client identities remain private unless explicit permission is provided for public disclosure.
              </p>
            </div>
          </div>
        </header>

        <div className="eip-audience-grid" aria-label="Identity protection audiences">
          {audiences.map((card) => <AudienceCardView key={card.number} card={card} />)}
        </div>

        <aside className="eip-confidentiality" aria-label="Confidentiality principle">
          <span className="eip-confidentiality__icon" aria-hidden="true"><LockKeyhole /></span>
          <div>
            <p className="eip-confidentiality__title">Confidential by design</p>
            <p>Client identities remain private unless explicit permission is provided for public disclosure.</p>
          </div>
          <span className="eip-confidentiality__note">Authorized engagements only.</span>
        </aside>
      </div>
    </section>
  );
}

export function EipImageLifecycleSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => setIsInView(Boolean(entry?.isIntersecting)),
      { rootMargin: "20% 0px", threshold: 0.05 },
    );
    visibilityObserver.observe(section);

    let frame = 0;
    const updateFromScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (window.innerWidth < 768) {
          const center = window.innerHeight * 0.52;
          let closestIndex = 0;
          let closestDistance = Number.POSITIVE_INFINITY;
          stageRefs.current.forEach((node, index) => {
            if (!node) return;
            const bounds = node.getBoundingClientRect();
            const distance = Math.abs(bounds.top + bounds.height / 2 - center);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestIndex = index;
            }
          });
          setActiveIndex(closestIndex);
          return;
        }
        const bounds = section.getBoundingClientRect();
        const travel = Math.max(bounds.height - window.innerHeight * 0.45, 1);
        const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.58 - bounds.top) / travel));
        setActiveIndex(Math.min(lifecycleStages.length - 1, Math.floor(progress * lifecycleStages.length)));
      });
    };

    const onScroll = () => {
      if (isInView) updateFromScroll();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateFromScroll);
    updateFromScroll();
    return () => {
      visibilityObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateFromScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [isInView]);

  return (
    <section ref={sectionRef} className={cn("eip-lifecycle-section border-t border-landing-line", isInView && "is-in-view")} aria-labelledby="eip-lifecycle-heading">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <header className="max-w-4xl">
          <p className="landing-kicker">Image lifecycle</p>
          <h2 id="eip-lifecycle-heading" className="mt-5 text-4xl font-medium leading-tight text-landing-ink md:text-6xl">
            How EIP changes the image lifecycle
          </h2>
          <p className="mt-6 max-w-3xl text-sm leading-7 text-landing-muted">
            EIP introduces a protection step before an authorized image enters the wider public digital environment.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-landing-muted">
            The objective is to preserve the image’s intended human-visible appearance while adding a defensive privacy layer designed to reduce reliable machine reuse of identity information.
          </p>
        </header>

        <div className="eip-lifecycle-experience">
          <div className="eip-lifecycle-visual" aria-label={`Current lifecycle state: ${lifecycleStages[activeIndex]?.title ?? lifecycleStages[0].title}`}>
            <LifecycleImage activeIndex={activeIndex} />
            <div className="eip-lifecycle-detail">
              <span>{lifecycleStages[activeIndex]?.number}</span>
              <p>{lifecycleStages[activeIndex]?.detail}</p>
            </div>
          </div>

          <ol className="eip-lifecycle-stages" style={{ "--eip-progress": `${(activeIndex / (lifecycleStages.length - 1)) * 100}%` } as React.CSSProperties}>
            {lifecycleStages.map((stage, index) => (
              <li key={stage.number} ref={(node) => { stageRefs.current[index] = node; }} className={cn("eip-lifecycle-stage", index === activeIndex && "is-active", index < activeIndex && "is-complete")}>
                <Button
                  type="button"
                  variant="ghost"
                  className="eip-lifecycle-stage__button"
                  aria-pressed={index === activeIndex}
                  onClick={() => setActiveIndex(index)}
                >
                  <span className="eip-lifecycle-stage__number">{stage.number}</span>
                  <span className="eip-lifecycle-stage__copy">
                    <strong>{stage.title}</strong>
                    <span>{stage.short}</span>
                    {index === 3 && <small>Web · Social · Press · Campaigns · Profiles</small>}
                    {index === 4 && <small>Designed to reduce machine identity fidelity.</small>}
                  </span>
                  <ArrowRight className="eip-lifecycle-stage__arrow" aria-hidden="true" />
                </Button>
                <div className="eip-lifecycle-stage__mobile-detail">
                  <LifecycleImage activeIndex={index} />
                  <p>{stage.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
