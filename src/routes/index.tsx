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
  Mic2,
  Radar,
  ScanFace,
  ShieldCheck,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { EternaLogo, PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import heroVideo from "@/assets/eterna-hero.mp4.asset.json";
import heroVideoWebm from "@/assets/eterna-hero.webm.asset.json";
import newHeroVideo from "@/assets/eterna-hero-new.mp4.asset.json";
import newHeroVideoWebm from "@/assets/eterna-hero-new.webm.asset.json";
import newHeroPoster from "@/assets/eterna-hero-new-poster.jpg.asset.json";

const CANONICAL = "https://protectbyeterna.com/";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Eterna Sentinel — Digital Identity Protection" },
      {
        name: "description",
        content:
          "Digital identity protection for people and organizations in the public eye, with evidence-led investigation and human review.",
      },
      { property: "og:title", content: "Eterna Sentinel — Digital Identity Protection" },
      {
        property: "og:description",
        content:
          "Detect impersonation, synthetic media, unauthorized content and emerging reputation threats.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Eterna Sentinel — Digital Identity Protection" },
      {
        name: "twitter:description",
        content:
          "Detect impersonation, synthetic media, unauthorized content and emerging reputation threats.",
      },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: LandingPage,
});

const organizationSchema = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Eterna Sentinel",
  url: CANONICAL,
  description:
    "Digital identity protection for people and organizations in the public eye, with evidence-led investigation and human review.",
  sameAs: [],
});

const protections = [
  [ScanFace, "Face & deepfake protection", "Assess synthetic and unauthorized identity use."],
  [Users, "Impersonation monitoring", "Surface suspicious accounts and identity misuse."],
  [Copyright, "Copyright intelligence", "Preserve evidence for human-reviewed action."],
  [Eye, "Reputation monitoring", "Track emerging public-web risk and context."],
  [Youtube, "Video monitoring", "Review channels and video platforms for misuse."],
  [Archive, "Evidence preservation", "Retain source context for case review."],
  [UserCheck, "Verified onboarding", "Establish who and what is protected."],
  [FileBarChart2, "Risk assessments", "Structure exposure findings with clear context."],
] as const;

const process = [
  ["01", "Verify", "Establish identity, authority and protected assets."],
  ["02", "Monitor", "Discover relevant signals across agreed public surfaces."],
  ["03", "Investigate", "Separate ordinary appearances from genuine risk."],
  ["04", "Preserve Evidence", "Retain source, timestamp and context for review."],
  ["05", "Enforce", "Submit eligible, authorized and approved cases appropriately."],
  ["06", "Monitor Again", "Track status, recurrence and emerging exposure."],
] as const;

function LandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    void video.play().catch(() => undefined);
  }, []);
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-landing-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }),
      { rootMargin: "0px 0px -10%", threshold: 0.12 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !muted;
    setMuted(!muted);
    if (video.paused) void video.play();
  };
  const moveHeroLight = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--hero-pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--hero-pointer-y", `${event.clientY - bounds.top}px`);
  };

  return (
    <div className="landing-shell min-h-screen bg-landing text-landing-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: organizationSchema }} />
      <PublicHeader />
      <main>
        <section
          className="mx-auto max-w-[1380px] px-4 md:px-8"
          aria-label="Eterna Sentinel identity protection"
        >
          <div
            className="landing-hero relative min-h-[650px] overflow-hidden rounded-lg md:min-h-[750px]"
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
            <div className="landing-hero-content relative z-10 flex min-h-[650px] flex-col items-center justify-end px-5 pb-24 pt-20 text-center text-landing-on-media md:min-h-[750px]">
              <p className="landing-kicker text-landing-accent">Protection with judgment</p>
              <h1 className="mt-5 max-w-5xl text-balance text-5xl font-medium leading-[0.98] md:text-7xl">
                Digital identity protection for people and organizations in the public eye.
              </h1>
              <p className="mt-7 max-w-3xl text-pretty text-sm leading-6 text-landing-on-media-muted md:text-base">
                Eterna Sentinel detects impersonation, synthetic media, unauthorized content and
                emerging reputation threats. Our team preserves evidence, assesses each case and
                coordinates appropriate platform and enforcement action.
              </p>
              <p className="mt-5 text-xs font-semibold">
                Eterna Sentinel · Managed protection operation
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="landing-accent-fill text-landing-accent-foreground"
                >
                  <Link to="/waitinglist" search={{ source: "hero-request" }}>
                    Request Protection <ArrowRight />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-landing-on-media/30 bg-landing-on-media/10 text-landing-on-media backdrop-blur hover:bg-landing-on-media/20 hover:text-landing-on-media"
                >
                  <a href="#platform">Explore the Platform</a>
                </Button>
              </div>
            </div>
            <div className="landing-hero-status absolute bottom-6 left-6 z-10 hidden gap-12 text-[10px] uppercase text-landing-on-media-muted md:flex">
              <div>
                <span className="mb-2 block opacity-60">Operating principle</span>
                <span className="text-landing-on-media">Evidence before action</span>
              </div>
              <div>
                <span className="mb-2 block opacity-60">Decision boundary</span>
                <span className="text-landing-on-media">Human review</span>
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

        <section className="border-b border-landing-line py-14" aria-label="Operational scale">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex flex-col justify-between gap-3 border-b border-landing-line pb-5 sm:flex-row">
              <p className="text-sm font-semibold">Operational scale</p>
              <p className="text-xs text-landing-muted">VERIFIED OPERATIONAL DATA</p>
            </div>
            <div className="grid gap-px bg-landing-line sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["13,800+", "Signals detected"],
                ["2,700+", "Specialist findings"],
                ["24/7", "Continuous monitoring"],
                ["MULTI-PLATFORM", "Digital threat coverage"],
              ].map(([value, label]) => (
                <div key={label} className="bg-landing py-8 sm:px-6">
                  <p className="text-4xl font-medium">{value}</p>
                  <p className="mt-2 text-xs text-landing-muted">{label}</p>
                  {label === "Digital threat coverage" && (
                    <p className="mt-3 text-[10px] uppercase tracking-wide text-landing-muted">
                      YouTube · Instagram · Facebook · X · Reddit · TikTok · Web
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-5 text-landing-muted">
              Activity figures reflect verified records processed within the Eterna platform.
              Monitoring and investigation volumes are continuously updated. They do not represent
              removals, successful outcomes or unique threats.
            </p>
          </div>
        </section>

        <section className="py-20 md:py-28">
          <div data-landing-reveal className="mx-auto max-w-6xl px-6">
            <p className="landing-kicker">Protected engagements</p>
            <h2 className="mt-4 max-w-3xl text-4xl font-medium md:text-6xl">
              Trusted to protect identities that operate in the public eye.
            </h2>
            <p className="mt-6 max-w-2xl text-sm leading-6 text-landing-muted">
              Client identities remain confidential. These categories reflect real protected-account
              types without presenting names, photographs or endorsements.
            </p>
            <div className="landing-stagger mt-12 grid gap-px border border-landing-line bg-landing-line md:grid-cols-3">
              {[
                [Mic2, "Film industry public figure", "Identity protection"],
                [Building2, "Organization", "Brand and executive protection"],
                [Users, "Public-facing individual", "Impersonation monitoring"],
              ].map(([Icon, title, service]) => (
                <article key={title as string} className="landing-feature-card bg-landing p-8">
                  <Icon className="size-5 text-landing-accent" />
                  <h3 className="mt-16 text-xl font-semibold">{title as string}</h3>
                  <p className="mt-2 text-sm text-landing-muted">{service as string}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="solutions" className="bg-landing-soft py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal>
              <p className="landing-kicker">What Eterna protects</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-medium md:text-6xl">
                Identity, reputation and content—seen together.
              </h2>
            </div>
            <div
              data-landing-reveal
              className="landing-stagger mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-4"
            >
              {protections.map(([Icon, label, detail]) => (
                <article key={label} className="landing-highlight min-h-52 bg-landing p-6">
                  <Icon className="size-5 text-landing-accent" />
                  <h3 className="mt-12 text-sm font-semibold">{label}</h3>
                  <p className="mt-3 text-xs leading-5 text-landing-muted">{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="platform" className="py-20 md:py-32">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal className="grid gap-10 md:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="landing-kicker">The Eterna platform</p>
                <h2 className="mt-4 text-4xl font-medium md:text-6xl">
                  From signal to governed decision.
                </h2>
                <p className="mt-6 max-w-sm text-sm leading-6 text-landing-muted">
                  One operating view connects detected assets, investigations, preserved evidence,
                  enforcement status and monitoring history.
                </p>
              </div>
              <PlatformInterface />
            </div>
            <p className="mt-4 text-center text-[11px] text-landing-muted">
              Actual Eterna platform interface. Client-identifying information has been removed.
            </p>
          </div>
        </section>

        <section
          id="how-it-works"
          className="border-y border-landing-line bg-landing-ink py-20 text-landing md:py-28"
        >
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal className="grid gap-10 md:grid-cols-2">
              <div>
                <p className="landing-kicker text-landing-accent">How Eterna operates</p>
                <h2 className="mt-4 text-4xl font-medium md:text-6xl">
                  A continuous protection cycle.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-landing-on-dark-muted md:justify-self-end">
                Technology supports each stage. Authorization, context and human judgment govern
                consequential action.
              </p>
            </div>
            <div
              data-landing-reveal
              className="landing-stagger mt-14 grid gap-px bg-landing-on-dark-line md:grid-cols-3"
            >
              {process.map(([number, title, body]) => (
                <article key={number} className="bg-landing-ink p-7">
                  <p className="text-xs text-landing-accent">{number}</p>
                  <h3 className="mt-12 text-xl font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-landing-on-dark-muted">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal>
              <p className="landing-kicker">Protection in practice</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-medium md:text-6xl">
                Verified activity, without manufactured outcomes.
              </h2>
            </div>
            <div data-landing-reveal className="landing-stagger mt-12 grid gap-6 md:grid-cols-3">
              {[
                [
                  Users,
                  "Impersonation case",
                  "Potential identity misuse discovered, source evidence retained and a case opened for review.",
                ],
                [
                  ScanFace,
                  "Synthetic-media case",
                  "Specialist signals assessed against protected references with context preserved for human investigation.",
                ],
                [
                  FileCheck2,
                  "Content protection case",
                  "Potential unauthorized use reviewed against ownership, eligibility and available platform routes.",
                ],
              ].map(([Icon, title, body]) => (
                <article
                  key={title as string}
                  className="landing-audience-card border border-landing-line p-7"
                >
                  <Icon className="size-5 text-landing-accent" />
                  <h3 className="mt-14 text-xl font-semibold">{title as string}</h3>
                  <p className="mt-3 text-sm leading-6 text-landing-muted">{body as string}</p>
                  <p className="mt-6 border-t border-landing-line pt-4 text-[11px] text-landing-muted">
                    Status: operating activity recorded; no removal outcome claimed.
                  </p>
                </article>
              ))}
            </div>
            <Button asChild variant="link" className="mt-7 h-auto p-0 text-landing-ink">
              <Link to="/case-studies">
                View anonymized case studies <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>

        <section className="bg-landing-soft py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal className="text-center">
              <p className="landing-kicker">Who Eterna serves</p>
              <h2 className="mx-auto mt-4 max-w-3xl text-4xl font-medium md:text-6xl">
                Protection for people and teams carrying public exposure.
              </h2>
            </div>
            <div data-landing-reveal className="landing-stagger mt-12 grid gap-6 md:grid-cols-3">
              {[
                [Mic2, "Public figures", "Names, faces, voices and public presence."],
                [Building2, "Organizations", "Brand, executive and protected-content exposure."],
                [
                  Users,
                  "Authorized representatives",
                  "Structured review and case coordination for trusted teams.",
                ],
              ].map(([Icon, title, body]) => (
                <article key={title as string} className="landing-audience-card bg-landing p-7">
                  <Icon className="size-5 text-landing-accent" />
                  <h3 className="mt-14 text-xl font-semibold">{title as string}</h3>
                  <p className="mt-3 text-sm text-landing-muted">{body as string}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 md:py-28">
          <div
            data-landing-reveal
            className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-[0.8fr_1.2fr]"
          >
            <div>
              <p className="landing-kicker">Trust & governance</p>
              <h2 className="mt-4 text-4xl font-medium md:text-5xl">
                Control is part of protection.
              </h2>
              <p className="mt-5 text-sm leading-6 text-landing-muted">
                Eterna is not an automatic takedown service.
              </p>
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
                  className="flex gap-3 border-t border-landing-line pt-4 text-sm leading-6"
                >
                  <Check className="mt-1 size-4 shrink-0 text-landing-accent" />
                  {item}
                </div>
              ))}
              <Button asChild variant="link" className="h-auto justify-start p-0 text-landing-ink">
                <Link to="/security">
                  Read Security & Governance <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <section id="questions" className="border-y border-landing-line py-20 md:py-28">
          <div
            data-landing-reveal
            className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-[0.75fr_1.25fr]"
          >
            <div>
              <p className="landing-kicker">Questions</p>
              <h2 className="mt-4 text-4xl font-medium md:text-5xl">
                Clear answers before protection begins.
              </h2>
            </div>
            <Accordion type="single" collapsible className="border-t border-landing-line">
              {[
                [
                  "Who is Eterna Sentinel for?",
                  "Public figures, executives, organizations and authorized representatives managing visible identities and valuable digital assets.",
                ],
                [
                  "Does Eterna remove everything it finds?",
                  "No. A finding is not automatically actionable. Authorization, eligibility, evidence, route checks and human approval determine appropriate next steps.",
                ],
                [
                  "What does Eterna monitor?",
                  "Depending on the agreed scope, Eterna can monitor public web, social, video and content surfaces for impersonation, synthetic media, reputation risk and unauthorized use.",
                ],
                [
                  "How do I discuss coverage?",
                  "Request protection and Eterna will review the identity, assets and monitoring scope involved.",
                ],
              ].map(([question, answer]) => (
                <AccordionItem key={question} value={question} className="border-landing-line">
                  <AccordionTrigger className="py-6 text-left hover:no-underline">
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

        <section className="py-20 md:py-28">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
            <div>
              <p className="landing-kicker">Eterna operations</p>
              <h2 className="mt-4 text-4xl font-medium">A managed digital protection operation.</h2>
              <p className="mt-5 max-w-md text-sm leading-6 text-landing-muted">
                Eterna Sentinel combines software-supported discovery with human investigation,
                evidence handling and case coordination.
              </p>
            </div>
            <dl className="grid gap-px bg-landing-line sm:grid-cols-2">
              {[
                ["Company", "Eterna Sentinel"],
                ["Operating model", "Technology + human review"],
                ["Client categories", "Individuals, representatives, organizations"],
                ["Protection areas", "Identity, reputation, content"],
              ].map(([term, description]) => (
                <div key={term} className="bg-landing p-6">
                  <dt className="text-[10px] uppercase text-landing-muted">{term}</dt>
                  <dd className="mt-3 text-sm font-semibold">{description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-[1380px] px-4 pb-4 md:px-8 md:pb-8">
          <div
            data-landing-reveal
            className="landing-final-cta relative min-h-[460px] overflow-hidden rounded-lg"
          >
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
              <EternaLogo inverse className="h-5 opacity-90 md:h-7" alt="" />
              <h2 className="mt-5 max-w-3xl font-landing-serif text-5xl font-medium leading-none md:text-7xl">
                Meet your protection partner.
              </h2>
              <p className="mt-5 max-w-xl text-sm leading-6 text-landing-on-media-muted">
                Tell us what needs protection. Eterna will review the identity, exposure and
                appropriate scope.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="landing-accent-fill text-landing-accent-foreground"
                >
                  <Link to="/waitinglist" search={{ source: "footer-request" }}>
                    Request Protection <ArrowRight />
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
      <PublicFooter />
    </div>
  );
}

function PlatformInterface() {
  return (
    <div className="landing-console landing-console-interactive overflow-hidden rounded-lg border border-landing-console-line bg-landing-console text-landing-console-foreground">
      <div className="flex items-center justify-between border-b border-landing-console-line px-5 py-4">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <i className="size-2 rounded-full bg-landing-accent" />
          Threat overview
        </span>
        <span className="text-[10px] uppercase text-landing-console-muted">Redacted client</span>
      </div>
      <div className="grid gap-px bg-landing-console-line sm:grid-cols-3">
        {[
          ["Detected assets", "Reviewed"],
          ["Investigations", "Active"],
          ["Evidence records", "Preserved"],
        ].map(([label, status], index) => (
          <div key={label} className="bg-landing-console p-5">
            <span className="text-[10px] text-landing-console-muted">0{index + 1}</span>
            <p className="mt-8 text-sm font-medium">{label}</p>
            <p className="mt-1 text-xs text-landing-console-muted">{status}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 p-5 md:grid-cols-[1.3fr_0.7fr]">
        <div className="relative h-56 overflow-hidden rounded-md border border-landing-console-line bg-landing-console-soft">
          <SignalMap />
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-md border border-landing-console-line bg-landing-console/80 px-4 py-3 backdrop-blur">
            <div>
              <p className="text-xs font-medium">Monitoring history</p>
              <p className="mt-1 text-[10px] text-landing-console-muted">
                Signal → review → evidence
              </p>
            </div>
            <ShieldCheck className="size-5 text-landing-cyan" />
          </div>
        </div>
        <div className="space-y-3">
          {["Risk assessment", "Evidence status", "Enforcement status"].map((item, index) => (
            <div key={item} className="border border-landing-console-line p-4">
              <p className="text-[10px] uppercase text-landing-console-muted">{item}</p>
              <p className="mt-4 text-xs">
                {index === 0 ? "Context review" : index === 1 ? "Preserved" : "Human approval"}
              </p>
            </div>
          ))}
        </div>
      </div>
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
      </g>
      <circle cx="665" cy="126" r="7" fill="var(--landing-cyan)" className="landing-signal-node" />
    </svg>
  );
}
