import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  Building2,
  Check,
  Copyright,
  Eye,
  FileBarChart2,
  FileCheck2,
  Fingerprint,
  LockKeyhole,
  Menu,
  Mic2,
  Radar,
  ScanFace,
  ShieldCheck,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
  X,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import heroVideo from "@/assets/eterna-hero.mp4.asset.json";
import heroVideoWebm from "@/assets/eterna-hero.webm.asset.json";
import heroPoster from "@/assets/eterna-hero-poster.jpg.asset.json";
import newHeroVideo from "@/assets/eterna-hero-new.mp4.asset.json";
import newHeroVideoWebm from "@/assets/eterna-hero-new.webm.asset.json";
import newHeroPoster from "@/assets/eterna-hero-new-poster.jpg.asset.json";
import eternaLogo from "@/assets/eterna-logo.png.asset.json";
import eternaLogoWhite from "@/assets/eterna-logo-white.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Eterna Sentinel — Identity Protection" },
      {
        name: "description",
        content:
          "Identity, reputation and content protection for public figures, creators and organizations, with evidence-led human review.",
      },
      { property: "og:title", content: "Eterna Sentinel — Identity Protection" },
      {
        property: "og:description",
        content:
          "Monitor impersonation, deepfakes and unauthorized content with evidence-led human review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

const features = [
  {
    icon: Fingerprint,
    number: "01",
    title: "Verified identity",
    body: "Secure onboarding, liveness checks and protected reference material establish who and what belongs to you.",
  },
  {
    icon: Radar,
    number: "02",
    title: "Continuous discovery",
    body: "Eterna watches public web, video and social surfaces for signals connected to your protected identity and assets.",
  },
  {
    icon: ScanFace,
    number: "03",
    title: "Risk intelligence",
    body: "Impersonation, synthetic media, reputation threats and copyright findings are separated from ordinary appearances.",
  },
  {
    icon: FileCheck2,
    number: "04",
    title: "Evidence-led action",
    body: "Preserved evidence, eligibility checks and human approval support measured responses when action is appropriate.",
  },
];

const protections = [
  {
    icon: ScanFace,
    label: "Face & deepfake protection",
    detail: "Detect synthetic and unauthorized identity use.",
  },
  {
    icon: Users,
    label: "Impersonation monitoring",
    detail: "Surface suspicious accounts and identity misuse.",
  },
  {
    icon: Copyright,
    label: "Copyright intelligence",
    detail: "Preserve evidence for human-reviewed action.",
  },
  {
    icon: Eye,
    label: "Reputation monitoring",
    detail: "Track emerging public-web risk and context.",
  },
  {
    icon: Youtube,
    label: "YouTube monitoring",
    detail: "Watch channels and video platforms for misuse of your work.",
  },
  {
    icon: Archive,
    label: "Evidence preservation",
    detail: "Findings are recorded with source context for review.",
  },
  {
    icon: UserCheck,
    label: "Verified onboarding",
    detail: "Identity checks and liveness confirm who is being protected.",
  },
  {
    icon: FileBarChart2,
    label: "Risk assessment reports",
    detail: "Structured exposure scans with clear risk context.",
  },
];

function EternaLogo({
  src,
  className,
  alt = "Éterna",
}: {
  src: string;
  className?: string;
  alt?: string;
}) {
  return (
    <span className={`landing-logo ${className ?? ""}`}>
      <img src={src} alt={alt} className="h-full w-auto" width={1712} height={480} />
      <span
        aria-hidden="true"
        className="landing-logo-shine"
        style={{ WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }}
      />
    </span>
  );
}

function LandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const startVideo = () => {
      video.muted = true;
      void video.play().catch(() => undefined);
    };

    startVideo();
    document.addEventListener("visibilitychange", startVideo);
    return () => document.removeEventListener("visibilitychange", startVideo);
  }, []);

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-landing-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10%", threshold: 0.12 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const moveHeroLight = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--hero-pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--hero-pointer-y", `${event.clientY - bounds.top}px`);
  };

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !muted;
    setMuted(!muted);
    if (video.paused) void video.play();
  };

  return (
    <div className="landing-shell min-h-screen bg-landing text-landing-ink">
      <header className="mx-auto flex h-20 max-w-[1380px] items-center justify-between px-5 md:px-10">
        <Link to="/" className="flex items-center gap-3" aria-label="Eterna Sentinel home">
          <EternaLogo src={eternaLogo.url} className="h-4 md:h-[22px]" />
        </Link>

        <nav
          className="hidden items-center gap-8 text-sm text-landing-muted md:flex"
          aria-label="Main navigation"
        >
          <a className="landing-link" href="#platform">
            Platform
          </a>
          <a className="landing-link" href="#protection">
            Protection
          </a>
          <a className="landing-link" href="#approach">
            How it works
          </a>
          <a className="landing-link" href="#questions">
            Questions
          </a>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" className="text-landing-ink hover:bg-landing-soft">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild className="bg-landing-ink text-landing hover:bg-landing-ink/90">
            <Link to="/waitinglist" search={{ source: "book-demo" }}>
              Book a demo
            </Link>
          </Button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-landing-ink hover:bg-landing-soft md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X /> : <Menu />}
        </Button>
      </header>

      {menuOpen && (
        <nav
          className="mx-5 mb-4 grid gap-1 border-y border-landing-line py-4 md:hidden"
          aria-label="Mobile navigation"
        >
          {[
            ["Platform", "#platform"],
            ["Protection", "#protection"],
            ["How it works", "#approach"],
            ["Questions", "#questions"],
          ].map(([label, href]) => (
            <a key={href} href={href} className="py-3 text-sm" onClick={() => setMenuOpen(false)}>
              {label}
            </a>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              asChild
              variant="outline"
              className="border-landing-line bg-transparent text-landing-ink"
            >
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild className="bg-landing-ink text-landing">
              <Link to="/waitinglist" search={{ source: "book-demo" }}>
                Book a demo
              </Link>
            </Button>
          </div>
        </nav>
      )}

      <main>
        <section
          className="mx-auto max-w-[1380px] px-4 md:px-8"
          aria-label="Eterna Sentinel identity protection"
        >
          <div
            className="landing-hero relative min-h-[600px] overflow-hidden rounded-lg md:min-h-[720px]"
            onPointerMove={moveHeroLight}
          >
            <video
              ref={videoRef}
              className="landing-hero-video absolute inset-0 size-full object-cover"
              poster={newHeroPoster.url}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
            >
              <source src={newHeroVideoWebm.url} type="video/webm" />
              <source src={newHeroVideo.url} type="video/mp4" />
            </video>
            <div className="landing-hero-overlay absolute inset-0" />
            <div className="landing-hero-light absolute inset-0 z-[1]" aria-hidden="true" />
            <div className="landing-hero-content relative z-10 flex min-h-[600px] flex-col items-center justify-end px-5 pb-28 pt-20 text-center md:min-h-[720px]">
              <p className="mt-7 max-w-2xl text-pretty text-sm leading-6 text-landing-on-media-muted md:text-base">
                Eterna Sentinel helps public figures and organizations discover digital risk,
                preserve evidence and coordinate responsible action.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="landing-accent-fill text-landing-accent-foreground hover:brightness-110"
                >
                  <Link to="/waitinglist" search={{ source: "hero-demo" }}>
                    Book a demo <ArrowRight />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-landing-on-media/30 bg-landing-on-media/10 text-landing-on-media backdrop-blur hover:bg-landing-on-media/20 hover:text-landing-on-media"
                >
                  <a href="#platform">Explore the platform</a>
                </Button>
              </div>
            </div>

            <div className="landing-hero-status absolute bottom-6 left-6 z-10 hidden items-end gap-12 text-[10px] uppercase text-landing-on-media-muted md:flex">
              <div>
                <span className="mb-2 block opacity-60">Protection status</span>
                <span className="flex items-center gap-2 text-landing-on-media">
                  <i className="size-1.5 rounded-full bg-landing-accent" />
                  Sentinel ready
                </span>
              </div>
              <div>
                <span className="mb-2 block opacity-60">Approach</span>
                <span className="text-landing-on-media">Evidence before action</span>
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={toggleSound}
              aria-label={muted ? "Turn video sound on" : "Mute video"}
              className="absolute bottom-5 right-5 z-20 border-landing-on-media/30 bg-landing-on-media/10 text-landing-on-media backdrop-blur hover:bg-landing-on-media/20 hover:text-landing-on-media"
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>
          </div>
        </section>

        <section
          className="mx-auto grid max-w-6xl gap-px overflow-hidden border-x border-b border-landing-line bg-landing-line md:grid-cols-4"
          aria-label="Protection highlights"
        >
          {protections.map(({ icon: Icon, label, detail }) => (
            <div key={label} className="landing-highlight bg-landing px-6 py-7">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-landing-ink">
                <Icon className="size-4 text-landing-accent" />
                {label}
              </div>
              <p className="mt-3 text-xs leading-5 text-landing-muted">{detail}</p>
            </div>
          ))}
        </section>

        <section id="platform" className="border-t border-landing-line py-24 md:py-36">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal className="grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:items-end">
              <div>
                <p className="landing-kicker">The protection layer</p>
                <h1 className="mt-4 max-w-2xl text-balance text-4xl font-medium leading-[1.02] md:text-6xl">
                  A real protection partner,
                  <br />
                  not an alarm <span className="font-landing-serif italic">in disguise.</span>
                </h1>
              </div>
              <p className="max-w-md text-pretty text-base leading-7 text-landing-muted md:justify-self-end">
                Eterna connects verified identity, continuous discovery and a governed response
                workflow. You see what matters, why it matters and what can responsibly happen next.
              </p>
            </div>

            <div data-landing-reveal className="landing-stagger mt-16 grid gap-px overflow-hidden rounded-lg border border-landing-line bg-landing-line md:grid-cols-4">
              {features.map(({ icon: Icon, number, title, body }, index) => (
                <article
                  key={title}
                  className={`landing-feature-card min-h-[320px] bg-landing p-7 ${index === 0 ? "md:min-h-[370px]" : ""}`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-xs text-landing-muted">{number}</span>
                    <span className="grid size-10 place-items-center rounded-full bg-landing-soft text-landing-accent">
                      <Icon className="size-4" />
                    </span>
                  </div>
                  <div className="mt-24 md:mt-32">
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-landing-muted">{body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="protection" className="bg-landing-soft py-24 md:py-36">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal className="grid gap-12 md:grid-cols-[0.8fr_1.2fr] md:gap-20">
              <div>
                <p className="landing-kicker">One protected view</p>
                <h2 className="mt-4 text-4xl font-medium leading-[1.04] md:text-6xl">
                  From signal
                  <br />
                  to <span className="font-landing-serif italic">decision.</span>
                </h2>
                <p className="mt-6 max-w-sm text-sm leading-6 text-landing-muted">
                  Your team gets a coherent picture of identity risk without turning every mention,
                  appearance or face match into an enforcement claim.
                </p>
              </div>

              <div className="landing-console landing-console-interactive overflow-hidden rounded-lg border border-landing-console-line bg-landing-console text-landing-console-foreground">
                <div className="flex items-center justify-between border-b border-landing-console-line px-5 py-4">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <span className="size-2 rounded-full bg-landing-accent" />
                    Protection overview
                  </div>
                  <span className="text-[10px] uppercase text-landing-console-muted">
                    Evidence-led
                  </span>
                </div>
                <div className="grid gap-px bg-landing-console-line sm:grid-cols-3">
                  {[
                    ["Monitored", "Identity surfaces"],
                    ["Review", "Context required"],
                    ["Action", "Gates satisfied"],
                  ].map(([label, sub], index) => (
                    <div key={label} className="bg-landing-console p-5">
                      <div className="mb-9 flex items-center justify-between">
                        <span className="text-[10px] uppercase text-landing-console-muted">
                          0{index + 1}
                        </span>
                        <span
                          className={`size-2 rounded-full ${index === 2 ? "bg-landing-cyan" : "bg-landing-accent"}`}
                        />
                      </div>
                      <p className="font-medium">{label}</p>
                      <p className="mt-1 text-xs text-landing-console-muted">{sub}</p>
                    </div>
                  ))}
                </div>
                <div className="p-5">
                  <div className="mb-4 flex items-center justify-between text-[10px] uppercase text-landing-console-muted">
                    <span>Signal map</span>
                    <span>Live context</span>
                  </div>
                  <div className="relative h-56 overflow-hidden rounded-md border border-landing-console-line bg-landing-console-soft">
                    <SignalMap />
                    <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-md border border-landing-console-line bg-landing-console/80 px-4 py-3 backdrop-blur">
                      <div>
                        <p className="text-xs font-medium">Human review boundary</p>
                        <p className="mt-1 text-[10px] text-landing-console-muted">
                          Authorization · eligibility · evidence
                        </p>
                      </div>
                      <ShieldCheck className="size-5 text-landing-cyan" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div data-landing-reveal className="landing-stagger mt-16 grid gap-8 border-t border-landing-line pt-10 md:grid-cols-3">
              {[
                [
                  "Identity misuse",
                  "Impersonation and unauthorized identity use are distinguished from ordinary media appearances.",
                ],
                [
                  "Synthetic media",
                  "Deepfake and face-swap signals are assessed alongside provenance, context and confidence.",
                ],
                [
                  "Protected content",
                  "Copyright intelligence supports evidence and review; it does not create an automatic removal claim.",
                ],
              ].map(([title, body]) => (
                <div key={title}>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-landing-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="approach" className="py-24 md:py-36">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal className="text-center">
              <p className="landing-kicker">Built for careful action</p>
              <h2 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-medium leading-[1.04] md:text-6xl">
                Protection that works
                <br />
                <span className="font-landing-serif italic">with judgment.</span>
              </h2>
              <p className="mx-auto mt-6 max-w-xl text-sm leading-6 text-landing-muted">
                Technology finds the signal. Context, authorization and people decide what it means.
              </p>
            </div>

            <div data-landing-reveal className="landing-stagger mt-16 grid gap-6 md:grid-cols-3">
              {[
                {
                  icon: Mic2,
                  title: "For public figures",
                  body: "Protect your name, face, voice, reputation and public presence across changing digital surfaces.",
                },
                {
                  icon: Building2,
                  title: "For organizations",
                  body: "Coordinate brand, executive and content protection with clear roles and auditable evidence.",
                },
                {
                  icon: Users,
                  title: "For representatives",
                  body: "Give trusted teams a structured way to review findings, preserve context and manage cases.",
                },
              ].map(({ icon: Icon, title, body }) => (
                <article key={title} className="landing-audience-card rounded-lg border border-landing-line p-7">
                  <Icon className="size-5 text-landing-accent" />
                  <h3 className="mt-16 text-xl font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-landing-muted">{body}</p>
                  <Button asChild variant="link" className="mt-5 h-auto p-0 text-landing-ink">
                    <Link to="/waitinglist" search={{ source: "audience-demo" }}>
                      Book a demo <ArrowRight />
                    </Link>
                  </Button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="testimonials" className="border-t border-landing-line py-24 md:py-32">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal className="text-center">
              <p className="landing-kicker">Trusted in the public eye</p>
              <h2 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-medium leading-[1.04] md:text-6xl">
                Carried by the people
                <br />
                the internet <span className="font-landing-serif italic">watches most.</span>
              </h2>
              <p className="mx-auto mt-6 max-w-xl text-sm leading-6 text-landing-muted">
                Eterna protects leading figures from film and politics, and enterprises whose names
                carry real weight — with client identities kept confidential by default.
              </p>
            </div>

            <div data-landing-reveal className="landing-stagger mt-16 grid gap-6 md:grid-cols-3">
              {[
                {
                  icon: Mic2,
                  quote:
                    "My name and face travel further than I do. Eterna separates what is genuinely harmful from ordinary noise, and nothing happens without my team's approval.",
                  role: "Film industry public figure",
                  context: "Protected identity · Southern cinema",
                },
                {
                  icon: Building2,
                  quote:
                    "We needed discretion above everything. Evidence is preserved, reviewed and escalated through proper channels — exactly how a public office requires it.",
                  role: "Public affairs representative",
                  context: "Reputation monitoring · Political individual",
                },
                {
                  icon: Users,
                  quote:
                    "As an enterprise, our brand faces constant impersonation. Eterna gives us one protected view and a governed process instead of scattered takedown emails.",
                  role: "Enterprise client",
                  context: "Brand & executive protection",
                },
              ].map(({ icon: Icon, quote, role, context }) => (
                <figure
                  key={role}
                  className="landing-testimonial flex flex-col rounded-lg border border-landing-line p-7"
                >
                  <Icon className="size-5 text-landing-accent" />
                  <blockquote className="mt-6 flex-1 font-landing-serif text-lg leading-7 text-landing-ink">
                    “{quote}”
                  </blockquote>
                  <figcaption className="mt-8 border-t border-landing-line pt-4">
                    <p className="text-sm font-semibold">{role}</p>
                    <p className="mt-1 text-xs text-landing-muted">{context}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-landing-line bg-landing-ink py-20 text-landing md:py-28">
          <div data-landing-reveal className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-[0.9fr_1.1fr] md:items-center">
            <div>
              <p className="landing-kicker text-landing-accent">Control is part of protection</p>
              <h2 className="mt-4 text-4xl font-medium leading-[1.04] md:text-5xl">
                Evidence preserved.
                <br />
                Actions <span className="font-landing-serif italic">governed.</span>
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                "Verified authorization before enforcement",
                "Eligibility and route checks before submission",
                "Human approval for consequential actions",
                "Auditable evidence and case history",
              ].map((item) => (
                <div
                  key={item}
                  className="flex gap-3 border-t border-landing-on-dark-line pt-4 text-sm leading-6 text-landing-on-dark-muted"
                >
                  <Check className="mt-1 size-4 shrink-0 text-landing-accent" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="questions" className="py-24 md:py-32">
          <div data-landing-reveal className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-[0.75fr_1.25fr]">
            <div>
              <p className="landing-kicker">Questions</p>
              <h2 className="mt-4 text-4xl font-medium md:text-5xl">
                Clear answers,
                <br />
                <span className="font-landing-serif italic">before we begin.</span>
              </h2>
            </div>
            <Accordion type="single" collapsible className="border-t border-landing-line">
              {[
                [
                  "Who is Eterna Sentinel for?",
                  "Eterna is designed for public figures, creators, executives, organizations and authorized representatives managing visible identities and valuable digital assets.",
                ],
                [
                  "Does Eterna remove everything it finds?",
                  "No. A finding is not automatically actionable. Eterna separates monitoring and review from enforcement, and requires the relevant authorization, eligibility, evidence and human-approval checks.",
                ],
                [
                  "What does Eterna monitor?",
                  "Depending on your protection setup, Eterna can monitor public web, social, video and content surfaces for impersonation, synthetic media, reputation risk and unauthorized use.",
                ],
                [
                  "How do I learn about pricing?",
                  "Every protection setup depends on the people, assets and monitoring scope involved. Book a demo and our team will discuss the right coverage with you.",
                ],
              ].map(([question, answer]) => (
                <AccordionItem key={question} value={question} className="border-landing-line">
                  <AccordionTrigger className="py-6 text-left text-base hover:no-underline">
                    {question}
                  </AccordionTrigger>
                  <AccordionContent className="max-w-xl pb-6 leading-6 text-landing-muted">
                    {answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="mx-auto max-w-[1380px] px-4 pb-4 md:px-8 md:pb-8">
          <div data-landing-reveal className="landing-final-cta relative min-h-[460px] overflow-hidden rounded-lg">
            <video
              className="absolute inset-0 size-full object-cover"
              muted
              loop
              autoPlay
              playsInline
              preload="none"
              aria-hidden="true"
            >
              <source src={heroVideoWebm.url} type="video/webm" />
              <source src={heroVideo.url} type="video/mp4" />
            </video>
            <div className="landing-cta-overlay absolute inset-0" />
            <div className="relative z-10 flex min-h-[460px] flex-col items-center justify-center px-6 text-center text-landing-on-media">
              <EternaLogo
                src={eternaLogoWhite.url}
                alt=""
                className="h-5 opacity-90 md:h-7"
              />
              <h2 className="mt-5 max-w-3xl text-balance font-landing-serif text-5xl font-medium leading-none md:text-7xl">
                Meet your protection partner.
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-6 text-landing-on-media-muted">
                Tell us what you need to protect. We’ll show you how Eterna can support your team.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="bg-landing-accent text-landing-accent-foreground hover:bg-landing-accent/90"
                >
                  <Link to="/waitinglist" search={{ source: "footer-demo" }}>
                    Book a demo <ArrowRight />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-landing-on-media/30 bg-landing-on-media/10 text-landing-on-media hover:bg-landing-on-media/20 hover:text-landing-on-media"
                >
                  <Link to="/waitinglist" search={{ source: "contact" }}>
                    Contact us
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto grid max-w-[1380px] gap-10 px-6 py-12 md:grid-cols-[1fr_auto] md:px-10">
        <div>
            <EternaLogo src={eternaLogo.url} className="h-4 md:h-5" />
          <p className="mt-4 max-w-sm text-xs leading-5 text-landing-muted">
            Identity, reputation and content protection with evidence-led human review.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-xs text-landing-muted">
          <Link to="/auth" className="landing-link">
            Sign in
          </Link>
          <Link to="/privacy" className="landing-link">
            Privacy
          </Link>
          <Link to="/waitinglist" search={{ source: "footer-contact" }} className="landing-link">
            Contact us
          </Link>
        </div>
        <p className="text-[10px] uppercase text-landing-muted md:col-span-2">
          © 2026 Eterna Sentinel. Protection with judgment.
        </p>
      </footer>
    </div>
  );
}

function SignalMap() {
  return (
    <svg
      viewBox="0 0 700 260"
      className="absolute inset-0 size-full"
      role="img"
      aria-label="Signals flowing through evidence review"
    >
      <defs>
        <linearGradient id="landing-signal" x1="0" x2="1">
          <stop offset="0" stopColor="var(--landing-accent)" />
          <stop offset="1" stopColor="var(--landing-cyan)" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="var(--landing-console-line)" strokeWidth="1">
        <path d="M0 64 H700M0 130 H700M0 196 H700" />
        <path d="M110 0V260M240 0V260M370 0V260M500 0V260M630 0V260" />
      </g>
      <g fill="none" stroke="url(#landing-signal)" strokeWidth="2" className="landing-signal-path">
        <path d="M40 144 C120 144 120 68 206 68 S292 180 378 180 S454 90 540 90 S590 126 665 126" />
        <path d="M206 68 C248 68 255 34 292 34" />
        <path d="M378 180 C420 180 426 222 470 222" />
      </g>
      <g fill="var(--landing-accent)">
        <circle cx="40" cy="144" r="5" />
        <circle cx="206" cy="68" r="5" />
        <circle cx="378" cy="180" r="5" />
        <circle cx="292" cy="34" r="4" />
        <circle cx="470" cy="222" r="4" />
      </g>
      <circle cx="665" cy="126" r="7" fill="var(--landing-cyan)" className="landing-signal-node" />
    </svg>
  );
}
