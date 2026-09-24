import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  Copyright,
  Eye,
  FileCheck2,
  FileSearch,
  Fingerprint,
  Mic2,
  Radar,
  ScanFace,
  ShieldCheck,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { CountUpMetric } from "@/components/public/CountUpMetric";
import { ClientShuffleCards } from "@/components/public/ClientShuffle";
import { PlatformLogos } from "@/components/public/PlatformLogos";
import { EternaLogo, PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import {
  EnquiryButton,
  EnquiryModalProvider,
  useEnquiryModal,
} from "@/components/public/enquiry/enquiry-modal-context";
import heroVideo from "@/assets/eterna-hero.mp4.asset.json";
import heroVideoWebm from "@/assets/eterna-hero.webm.asset.json";
import newHeroVideo from "@/assets/eterna-hero-new.mp4.asset.json";
import newHeroVideoWebm from "@/assets/eterna-hero-new.webm.asset.json";
import newHeroPoster from "@/assets/eterna-hero-new-poster.jpg.asset.json";

const CANONICAL = "https://protectbyeterna.com/";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Eterna Sentinel: Digital Identity Protection" },
      {
        name: "description",
        content:
          "Digital identity protection for people and organizations in the public eye, with evidence-led investigation and human review.",
      },
      { property: "og:title", content: "Eterna Sentinel: Digital Identity Protection" },
      {
        property: "og:description",
        content:
          "Detect impersonation, synthetic media, unauthorized content and emerging reputation threats.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Eterna Sentinel: Digital Identity Protection" },
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
  alternateName: ["Eterna", "Eterna AI", "Protect by Eterna"],
  url: CANONICAL,
  description:
    "Digital identity protection for people and organizations in the public eye, with evidence-led investigation and human review.",
  sameAs: [],
});

const protections = [
  [ScanFace, "Deepfake & synthetic media", "Assess synthetic and unauthorized identity use."],
  [Users, "Impersonation", "Surface suspicious accounts and identity misuse."],
  [Copyright, "Unauthorized content", "Review video and content platforms for unauthorized use."],
  [Eye, "Reputation risk", "Track emerging public-web risk and context."],
] as const;

const processSteps = [
  {
    number: "01",
    label: "Report Content",
    title: "Report defamatory content",
    body: "Share the link to a post, video, article, or other content. Our team reviews it and identifies the appropriate response.",
    Illustration: ReportCaseIllustration,
  },
  {
    number: "02",
    label: "Evidence Record",
    title: "Create an evidence record",
    body: "We document available links, screenshots, timestamps, and relevant context to create a clear case record.",
    Illustration: EvidenceRecordIllustration,
  },
  {
    number: "03",
    label: "Request & Updates",
    title: "Submit a removal request and send updates",
    body: "Where an appropriate reporting route applies, we submit the request and notify you when the case changes, including if content is removed, rejected, or needs more information.",
    Illustration: CaseStatusIllustration,
  },
] as const;

const governanceChecks = [
  "Verified authorization before enforcement",
  "Eligibility and route checks before submission",
  "Human approval for consequential actions",
  "Auditable evidence and case history",
] as const;

const audiences = [
  {
    icon: Mic2,
    title: "Public Figures",
    description: "Individuals whose name, face and voice are publicly recognized.",
  },
  {
    icon: UserCheck,
    title: "Executives & Founders",
    description: "Leaders whose identity is closely tied to an organization's reputation.",
  },
  {
    icon: Building2,
    title: "Organizations & Brands",
    description:
      "Businesses and institutions facing impersonation, synthetic media or reputation threats.",
  },
] as const;

const standardExposureSteps = [
  { step: "01", title: "Original image published", detail: "Shared publicly, as usual." },
  {
    step: "02",
    title: "Image becomes reusable in AI systems",
    detail: "Public images can be collected and reused.",
  },
  {
    step: "03",
    title: "Identity may be replicated, manipulated or misused",
    detail: "Face and likeness put at risk.",
  },
] as const;

const eipProtectionSteps = [
  {
    step: "01",
    title: "Authorized image prepared with EIP",
    detail: "Applied before publication, with authorization.",
  },
  {
    step: "02",
    title: "Natural human-visible appearance retained",
    detail: "Looks unchanged to the human eye.",
  },
  {
    step: "03",
    title: "Designed to reduce unauthorized AI identity reuse",
  },
] as const;

const whyEternaPillars = [
  {
    icon: Fingerprint,
    title: "Prevent",
    description: "Protection begins before publication.",
  },
  {
    icon: Radar,
    title: "Detect",
    description: "Continuous visibility across public digital surfaces.",
  },
  {
    icon: FileSearch,
    title: "Investigate",
    description: "Human judgment, not automated verdicts.",
  },
  {
    icon: ShieldCheck,
    title: "Respond",
    description: "Governed, authorized action.",
  },
] as const;

const protectionPrograms = [
  {
    icon: Mic2,
    name: "Public Figure Protection",
    audience: "For actors, creators, athletes and public personalities.",
    services: [
      "Deepfake monitoring",
      "Impersonation monitoring",
      "Content protection",
      "Reputation intelligence",
      "Incident response",
    ],
  },
  {
    icon: UserCheck,
    name: "Executive Protection",
    audience: "For founders and senior leadership.",
    services: [
      "Executive impersonation",
      "Voice and face misuse",
      "Scam detection",
      "Reputation monitoring",
      "Evidence-led response",
    ],
  },
  {
    icon: Building2,
    name: "Enterprise Protection",
    audience: "For organizations and institutional teams.",
    services: [
      "Brand monitoring",
      "Executive coverage",
      "Threat investigation",
      "Evidence management",
      "Multi-platform response",
    ],
  },
  {
    icon: AlertTriangle,
    name: "Incident Response",
    audience: "For an active problem already spreading.",
    services: [
      "Rapid assessment",
      "Evidence preservation",
      "Eligibility review",
      "Platform coordination",
      "Recurrence monitoring",
    ],
  },
  {
    icon: ScanFace,
    name: "Image Immunization",
    audience: "For images before publication.",
    services: [
      "EIP preprocessing",
      "Protected asset management",
      "Validation reporting",
      "Ongoing protection monitoring",
    ],
  },
] as const;

const onboardingSteps = [
  { step: "01", title: "Request", detail: "Tell Eterna what needs protection." },
  {
    step: "02",
    title: "Verify",
    detail: "Identity, representation and protected assets are established.",
  },
  {
    step: "03",
    title: "Assess",
    detail: "Existing exposure and relevant public surfaces are reviewed.",
  },
  { step: "04", title: "Define", detail: "Protection scope and operating coverage are agreed." },
  { step: "05", title: "Activate", detail: "Monitoring and protection workflows begin." },
] as const;

function LandingPage() {
  return (
    <EnquiryModalProvider>
      <LandingPageContent />
    </EnquiryModalProvider>
  );
}

function LandingPageContent() {
  const { openEnquiryModal } = useEnquiryModal();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("enquiry") !== "protection") return;

    const source = params.get("source");
    const safeSource =
      source && source.length <= 80 && /^[a-zA-Z0-9._-]+$/.test(source) ? source : null;
    openEnquiryModal({
      sourcePage: "legacy-waitinglist",
      sourceCta: safeSource ? `legacy-${safeSource}` : "legacy-request-protection",
      department: "protection",
    });
    void navigate({
      to: "/",
      search: {
        enquiry: undefined,
        source: undefined,
        utm_source: undefined,
        utm_medium: undefined,
        utm_campaign: undefined,
        utm_term: undefined,
        utm_content: undefined,
        referral: undefined,
      },
      replace: true,
    });
  }, [navigate, openEnquiryModal]);
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
                  type="button"
                  size="lg"
                  className="landing-accent-fill text-landing-accent-foreground"
                  onClick={() =>
                    openEnquiryModal({
                      sourcePage: "hero-request",
                      sourceCta: "Request Protection",
                      department: "protection",
                    })
                  }
                >
                  Request Protection <ArrowRight />
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
              <CountUpMetric value={13800} suffix="+" label="Signals detected" />
              <CountUpMetric value={2700} suffix="+" label="Specialist findings" />
              <CountUpMetric displayValue="24/7" label="Continuous monitoring" />
              <CountUpMetric
                displayValue="MULTI-PLATFORM"
                label="Digital threat coverage"
                detail="Verified coverage"
              />
            </div>
            <PlatformLogos />
            <p className="mt-4 text-[11px] leading-5 text-landing-muted">
              Activity figures reflect verified records processed within the Eterna platform.
              Monitoring and investigation volumes are continuously updated. They do not represent
              removals, successful outcomes or unique threats.
            </p>
          </div>
        </section>

        <section className="py-20 md:py-28" aria-labelledby="problem-framing-heading">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal>
              <p className="landing-kicker">How EIP changes the image lifecycle</p>
              <div className="mt-4 grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-end">
                <h2
                  id="problem-framing-heading"
                  className="max-w-[740px] text-4xl font-medium md:text-5xl"
                >
                  Public images have become reusable.
                </h2>
                <p className="text-sm leading-6 text-landing-muted md:pb-1">
                  Once published, an image can be collected and reused by AI systems. Eterna Image
                  Immunization (EIP) prepares authorized images before publication, so protection
                  starts before exposure.
                </p>
              </div>
            </div>

            <div data-landing-reveal className="mt-8">
              <EipLifecycleVisual />
              <p className="mt-5 text-sm">
                <Link
                  to="/image-immunization"
                  className="landing-link inline-flex items-center gap-1 font-semibold text-landing-ink"
                >
                  Learn how Image Immunization works <ArrowRight className="size-3.5" />
                </Link>
              </p>
            </div>
          </div>
        </section>

        <section id="why-eterna" className="py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal>
              <p className="landing-kicker">Why Eterna</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-medium md:text-6xl">
                Protection across the entire identity lifecycle.
              </h2>
            </div>
            <div
              data-landing-reveal
              className="landing-stagger mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-4"
            >
              {whyEternaPillars.map(({ icon: Icon, title, description }) => (
                <article key={title} className="landing-highlight min-h-52 bg-landing p-6">
                  <Icon className="size-5 text-landing-accent" />
                  <h3 className="mt-12 text-sm font-semibold">{title}</h3>
                  <p className="mt-3 text-xs leading-5 text-landing-muted">{description}</p>
                </article>
              ))}
            </div>
            <p
              data-landing-reveal
              className="mt-10 max-w-2xl border-t border-landing-line pt-6 text-sm leading-6 text-landing-muted"
            >
              Eterna connects pre-publication protection with evidence-led monitoring, investigation
              and response.
            </p>
          </div>
        </section>

        <section id="solutions" className="bg-landing-soft py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal>
              <p className="landing-kicker">What Eterna protects</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-medium md:text-6xl">
                Identity, reputation and content, seen together.
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
                <p className="mt-5 text-sm">
                  <Link
                    to="/eterna-ai"
                    className="landing-link inline-flex items-center gap-1 font-semibold text-landing-ink"
                  >
                    See how the technology works <ArrowRight className="size-3.5" />
                  </Link>
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
          aria-labelledby="how-it-works-heading"
          className="border-y border-landing-line bg-landing py-20 md:py-32"
        >
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal className="grid gap-10 md:grid-cols-2 md:items-end">
              <div>
                <p className="landing-kicker">How it works</p>
                <h2 id="how-it-works-heading" className="mt-4 text-4xl font-medium md:text-6xl">
                  From report to removal request.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-landing-muted md:justify-self-end">
                Our team handles each case from first report to final status. Where a reporting
                route applies, we submit the request, and the platform or host makes the decision.
              </p>
            </div>

            <HowItWorksSteps />

            <div
              data-landing-reveal
              className="mt-20 grid gap-10 border-t border-landing-line pt-10 md:grid-cols-[0.8fr_1.2fr]"
            >
              <div>
                <p className="text-sm font-semibold">Clear support. Updates at every step.</p>
                <p className="mt-2 max-w-sm text-sm leading-6 text-landing-muted">
                  We review each case and submit eligible requests through the appropriate platform
                  or host channel. We keep you informed as your case progresses; the platform or
                  host makes the final decision.
                </p>
              </div>
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {governanceChecks.map((item) => (
                  <div
                    key={item}
                    className="flex gap-3 border-t border-landing-line pt-4 text-sm leading-6"
                  >
                    <Check className="mt-1 size-4 shrink-0 text-landing-accent" />
                    {item}
                  </div>
                ))}
                <Link
                  to="/security"
                  className="landing-link inline-flex items-center gap-1 text-sm font-semibold text-landing-ink"
                >
                  Read Security & Governance <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="programs" className="bg-landing-soft py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div data-landing-reveal>
              <p className="landing-kicker">Protection Programs</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-medium md:text-6xl">
                Protection built around exposure.
              </h2>
            </div>
            <div
              data-landing-reveal
              className="landing-stagger mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3"
            >
              {protectionPrograms.map(({ icon: Icon, name, audience, services }) => (
                <article
                  key={name}
                  className="landing-audience-card rounded-md border border-landing-line bg-landing p-7"
                >
                  <Icon className="size-5 text-landing-accent" />
                  <h3 className="mt-8 text-lg font-semibold">{name}</h3>
                  <p className="mt-3 text-sm leading-6 text-landing-muted">{audience}</p>
                  <ul className="mt-5 space-y-2 border-t border-landing-line pt-4">
                    {services.map((service) => (
                      <li
                        key={service}
                        className="flex items-center gap-2 text-xs text-landing-muted"
                      >
                        <Check className="size-3.5 shrink-0 text-landing-accent" />
                        {service}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <EnquiryButton
              className="landing-accent-fill mt-10 text-landing-accent-foreground"
              prefill={{
                sourcePage: "protection-programs",
                sourceCta: "Request Private Assessment",
                department: "protection",
              }}
            >
              Request Private Assessment <ArrowRight />
            </EnquiryButton>
          </div>
        </section>

        <section id="who-we-protect" className="py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div
              data-landing-reveal
              className="grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-end"
            >
              <div>
                <p className="landing-kicker">Who Eterna protects</p>
                <h2 className="mt-4 max-w-[740px] text-4xl font-medium md:text-5xl">
                  Protection for identities that operate in public.
                </h2>
              </div>
              <div className="md:pb-1">
                <p className="text-sm leading-6 text-landing-muted">
                  Engagements are confidential and authorized, managed directly or through
                  authorized representatives. Client identities remain private unless explicit
                  permission is provided for public disclosure.
                </p>
                <p className="mt-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-landing-muted">
                  <i className="size-1.5 rounded-full bg-landing-accent" aria-hidden="true" />
                  Confidential by design
                </p>
              </div>
            </div>
            <div data-landing-reveal className="landing-stagger mt-14 grid gap-6 md:grid-cols-3">
              {audiences.map(({ icon: Icon, title, description }, index) => (
                <article
                  key={title}
                  className="landing-audience-card rounded-md border border-landing-line bg-landing p-7"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-landing-accent">0{index + 1}</span>
                    <Icon className="size-5 text-landing-accent" />
                  </div>
                  <h3 className="mt-10 text-lg font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-landing-muted">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="clients"
          className="border-t border-landing-line bg-landing-soft py-20 md:py-28"
          aria-labelledby="clients-heading"
        >
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div data-landing-reveal>
              <p className="landing-kicker">Clients</p>
              <h2
                id="clients-heading"
                className="mt-4 max-w-[520px] text-4xl font-medium md:text-5xl"
              >
                Feedback from the people we protect.
              </h2>
              <p className="mt-5 max-w-md text-sm leading-6 text-landing-muted">
                Engagements are confidential, so feedback is shared by role with permission —
                never by name. Every account reflects the managed, human-reviewed way Eterna
                operates.
              </p>
              <p className="mt-6 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-landing-muted">
                <i className="size-1.5 rounded-full bg-landing-accent" aria-hidden="true" />
                Shared with permission · Names confidential
              </p>
            </div>
            <div data-landing-reveal className="pb-6">
              <ClientShuffleCards />
            </div>
          </div>
        </section>

        <section className="border-t border-landing-line py-20 md:py-28">
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

        <section id="onboarding" className="bg-landing-soft py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6">
            <div
              data-landing-reveal
              className="grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-end"
            >
              <div>
                <p className="landing-kicker">How onboarding works</p>
                <h2 className="mt-4 max-w-2xl text-4xl font-medium md:text-6xl">
                  Starting protection is confidential.
                </h2>
              </div>
              <EnquiryButton
                className="landing-accent-fill justify-self-start text-landing-accent-foreground md:justify-self-end"
                size="lg"
                prefill={{
                  sourcePage: "onboarding",
                  sourceCta: "Start a confidential assessment",
                  department: "protection",
                }}
              >
                Start a confidential assessment <ArrowRight />
              </EnquiryButton>
            </div>
            <div
              data-landing-reveal
              className="landing-stagger mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-5"
            >
              {onboardingSteps.map(({ step, title, detail }) => (
                <article key={step} className="bg-landing p-6">
                  <p className="text-xs text-landing-accent">{step}</p>
                  <h3 className="mt-10 text-sm font-semibold">{title}</h3>
                  <p className="mt-3 text-xs leading-5 text-landing-muted">{detail}</p>
                </article>
              ))}
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
                  "Public figures, executives and founders, and organizations and brands, including authorized representatives acting on their behalf.",
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
                  type="button"
                  size="lg"
                  className="landing-accent-fill text-landing-accent-foreground"
                  onClick={() =>
                    openEnquiryModal({
                      sourcePage: "footer-request",
                      sourceCta: "Request Protection",
                      department: "protection",
                    })
                  }
                >
                  Request Protection <ArrowRight />
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="border-landing-on-media/30 bg-landing-on-media/10 text-landing-on-media hover:bg-landing-on-media/20 hover:text-landing-on-media"
                  onClick={() =>
                    openEnquiryModal({
                      sourcePage: "footer-contact",
                      sourceCta: "Contact us",
                    })
                  }
                >
                  Contact us
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

type EipFlow = "standard" | "eip";
type EipStep = { step: string; title: string; detail?: string };

function EipLifecycleRow({
  flow,
  label,
  steps,
  activeKey,
  activeFlow,
  onActivate,
  onDeactivate,
}: {
  flow: EipFlow;
  label: string;
  steps: readonly EipStep[];
  activeKey: string | null;
  activeFlow: EipFlow | null;
  onActivate: (key: string) => void;
  onDeactivate: () => void;
}) {
  return (
    <div className="eip-row">
      <p className="eip-flow-label">{label}</p>
      <div
        data-landing-reveal
        className={cn(
          "landing-stagger mt-4 grid gap-3 sm:grid-cols-3",
          flow === "eip" ? "eip-row--eip" : "eip-row--standard",
        )}
      >
        {steps.map((item, index) => {
          const key = `${flow}-${index}`;
          const isActive = activeKey === key;
          const isDimmed = activeKey !== null && !isActive && activeFlow !== flow;
          return (
            <article
              key={key}
              tabIndex={0}
              onMouseEnter={() => onActivate(key)}
              onMouseLeave={onDeactivate}
              onFocus={() => onActivate(key)}
              onBlur={onDeactivate}
              className={cn(
                "eip-panel rounded-2xl p-5",
                flow === "eip" ? "eip-panel--eip" : "eip-panel--standard",
                isActive && "is-active",
                isDimmed && "is-dimmed",
              )}
            >
              <span
                className={cn(
                  "text-xs",
                  flow === "eip" ? "text-landing-accent" : "text-landing-muted",
                )}
              >
                {item.step}
              </span>
              <h3 className="mt-3 text-sm font-semibold leading-5">{item.title}</h3>
              {item.detail && (
                <p className="mt-2 text-xs leading-5 text-landing-muted">{item.detail}</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function EipLifecycleVisual() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeFlow = (activeKey?.split("-")[0] as EipFlow | undefined) ?? null;

  return (
    <div className="eip-visual-frame mt-6 rounded-lg border border-landing-line p-6 md:p-8">
      <EipLifecycleRow
        flow="standard"
        label="Standard image exposure"
        steps={standardExposureSteps}
        activeKey={activeKey}
        activeFlow={activeFlow}
        onActivate={setActiveKey}
        onDeactivate={() => setActiveKey(null)}
      />
      <div className="my-6 flex items-center gap-3 md:my-8" aria-hidden="true">
        <span className="h-px flex-1 bg-landing-line" />
        <ArrowRight className="size-3.5 rotate-90 text-landing-accent" />
        <span className="h-px flex-1 bg-landing-line" />
      </div>
      <EipLifecycleRow
        flow="eip"
        label="Eterna EIP protection flow"
        steps={eipProtectionSteps}
        activeKey={activeKey}
        activeFlow={activeFlow}
        onActivate={setActiveKey}
        onDeactivate={() => setActiveKey(null)}
      />
    </div>
  );
}

type PlatformTabId =
  "threat-overview" | "investigations" | "evidence" | "enforcement" | "monitoring";

const platformTabs: readonly { id: PlatformTabId; label: string }[] = [
  { id: "threat-overview", label: "Threat Overview" },
  { id: "investigations", label: "Investigations" },
  { id: "evidence", label: "Evidence" },
  { id: "enforcement", label: "Enforcement" },
  { id: "monitoring", label: "Monitoring" },
];

const threatOverviewColumns = [
  "Detected link",
  "Source platform",
  "Identity match",
  "Status",
  "Risk",
] as const;
const threatOverviewRows = [
  ["██████████████", "Social platform", "Match", "Reviewed", "Low"],
  ["██████████████", "Video platform", "Possible match", "Active", "Medium"],
  ["██████████████", "Forum", "Match", "Escalated", "High"],
] as const;

const evidenceColumns = [
  "URL",
  "Timestamp",
  "Screenshots",
  "Evidence integrity",
  "Source status",
] as const;
const evidenceRows = [
  ["██████████████", "Captured", "Preserved", "Verified", "Live"],
  ["██████████████", "Captured", "Preserved", "Verified", "Removed"],
  ["██████████████", "Captured", "Preserved", "Pending review", "Live"],
] as const;

const investigationStages = ["New", "Reviewing", "Verified", "Dismissed", "Escalated"] as const;
const enforcementStages = [
  "Submitted",
  "Under review",
  "Removed",
  "Rejected",
  "Escalated",
] as const;

const monitoringMetrics = [
  { label: "Recurrence", value: "Tracked" },
  { label: "New sources", value: "Monitored" },
  { label: "Reuploads", value: "Flagged" },
  { label: "Active alerts", value: "Live" },
] as const;

function ConsoleTable({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-landing-console-line">
      <table className="w-full min-w-[560px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-landing-console-line bg-landing-console-soft">
            {columns.map((column) => (
              <th
                key={column}
                className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-landing-console-muted"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.join("|")}
              className="border-b border-landing-console-line last:border-b-0"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={`${cell}-${cellIndex}`}
                  className="px-4 py-3 text-landing-console-foreground"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StageTracker({ stages }: { stages: readonly string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {stages.map((stage, index) => (
        <div key={stage} className="flex items-center gap-2">
          <span className="rounded-full border border-landing-console-line bg-landing-console-soft px-3 py-1.5 text-[11px] font-medium">
            {stage}
          </span>
          {index < stages.length - 1 && (
            <ArrowRight className="size-3 shrink-0 text-landing-console-muted" aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  );
}

function PlatformInterface() {
  const [activeTab, setActiveTab] = useState<PlatformTabId>("threat-overview");
  const activeLabel = platformTabs.find((tab) => tab.id === activeTab)?.label ?? "";

  return (
    <div className="landing-console landing-console-interactive overflow-hidden rounded-lg border border-landing-console-line bg-landing-console text-landing-console-foreground">
      <div className="flex items-center justify-between border-b border-landing-console-line px-5 py-4">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <i className="size-2 rounded-full bg-landing-accent" />
          {activeLabel}
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

      <div
        role="tablist"
        aria-label="Eterna platform views"
        className="flex flex-wrap gap-1 border-b border-landing-console-line bg-landing-console-soft px-3 py-2"
      >
        {platformTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
              activeTab === tab.id
                ? "bg-landing-console text-landing-console-foreground"
                : "text-landing-console-muted hover:text-landing-console-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {activeTab === "threat-overview" && (
          <div className="space-y-5">
            <div className="relative h-40 overflow-hidden rounded-md border border-landing-console-line bg-landing-console-soft">
              <SignalMap />
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between rounded-md border border-landing-console-line bg-landing-console/80 px-4 py-2.5 backdrop-blur">
                <div>
                  <p className="text-xs font-medium">Monitoring history</p>
                  <p className="mt-1 text-[10px] text-landing-console-muted">
                    Signal → review → evidence
                  </p>
                </div>
                <ShieldCheck className="size-5 text-landing-cyan" />
              </div>
            </div>
            <ConsoleTable columns={threatOverviewColumns} rows={threatOverviewRows} />
          </div>
        )}

        {activeTab === "investigations" && (
          <div className="space-y-5">
            <StageTracker stages={investigationStages} />
            <p className="max-w-md text-xs leading-5 text-landing-console-muted">
              Every surfaced case moves through a single reviewed pipeline. Nothing is treated as
              confirmed before a specialist reaches a verified determination.
            </p>
          </div>
        )}

        {activeTab === "evidence" && <ConsoleTable columns={evidenceColumns} rows={evidenceRows} />}

        {activeTab === "enforcement" && (
          <div className="space-y-5">
            <StageTracker stages={enforcementStages} />
            <p className="max-w-md text-xs leading-5 text-landing-console-muted">
              Only eligible, authorized cases are submitted. Status is tracked through to resolution
              or escalation.
            </p>
          </div>
        )}

        {activeTab === "monitoring" && (
          <div className="grid gap-px overflow-hidden rounded-md border border-landing-console-line bg-landing-console-line sm:grid-cols-2 lg:grid-cols-4">
            {monitoringMetrics.map(({ label, value }) => (
              <div key={label} className="bg-landing-console p-5">
                <p className="text-[10px] uppercase text-landing-console-muted">{label}</p>
                <p className="mt-6 text-sm font-medium">{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HowItWorksSteps() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAutoplay(false);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.35,
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoplay || paused || !inView) return;
    const id = window.setInterval(() => {
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      setActive((current) => (current + 1) % processSteps.length);
    }, 5200);
    return () => window.clearInterval(id);
  }, [autoplay, paused, inView]);

  const selectStep = (index: number) => {
    setActive(index);
    setAutoplay(false);
  };

  return (
    <div
      ref={rootRef}
      data-landing-reveal
      className="hiw-steps mt-16 md:mt-24"
      style={{ "--hiw-progress": active / (processSteps.length - 1) } as React.CSSProperties}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <div role="group" aria-label="Process steps" className="hidden grid-cols-3 md:grid">
        {processSteps.map(({ number, label }, index) => (
          <button
            key={number}
            type="button"
            aria-pressed={active === index}
            aria-controls={`hiw-panel-${number}`}
            onClick={() => selectStep(index)}
            className={cn(
              "hiw-pill",
              index === 0 && "justify-self-start",
              index === 1 && "justify-self-center",
              index === 2 && "justify-self-end",
            )}
            style={{ "--hiw-i": index } as React.CSSProperties}
          >
            {label}
          </button>
        ))}
      </div>

      <div aria-hidden="true" className="hiw-track hidden md:block">
        <span className="hiw-track-line" />
        <span className="hiw-track-progress" />
        {processSteps.map(({ number }, index) => (
          <span
            key={number}
            className="hiw-marker"
            data-active={active === index || undefined}
            style={
              {
                "--hiw-i": index,
                left: `${(index / (processSteps.length - 1)) * 100}%`,
                "--hiw-x": `${(index / (processSteps.length - 1)) * -100}%`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <ol className="grid md:grid-cols-3">
        {processSteps.map(({ number, label, title, body, Illustration }, index) => (
          <li
            key={number}
            id={`hiw-panel-${number}`}
            aria-current={active === index ? "step" : undefined}
            data-active={active === index || undefined}
            onClick={() => selectStep(index)}
            className="hiw-step"
            style={{ "--hiw-i": index } as React.CSSProperties}
          >
            <p className="mb-4 text-xs font-semibold text-landing-accent md:hidden">
              Step {number} · {label}
            </p>
            <h3 className="hiw-step-title text-xl font-medium">{title}</h3>
            <p className="hiw-step-body mt-4 max-w-sm text-sm leading-6 text-landing-muted">
              {body}
            </p>
            <div className="hiw-illustration">
              <div className="hiw-float">
                <Illustration />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* How it works — step illustrations. Decorative: each step's text carries the meaning. */
function ReportCaseIllustration() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <rect x="20.5" y="14.5" width="279" height="171" rx="10" className="hiw-s-surface" />
      <circle cx="36" cy="30" r="3" className="hiw-s-line" />
      <circle cx="46" cy="30" r="3" className="hiw-s-line" />
      <circle cx="56" cy="30" r="3" className="hiw-s-line" />
      <rect x="72" y="23" width="170" height="14" rx="7" className="hiw-s-soft" />
      <text x="82" y="32.6" fontSize="7.5" className="hiw-s-muted-text">
        social.example/post/48213
      </text>
      <path d="M21 45.5h278" className="hiw-s-rule" />
      <circle cx="44" cy="66" r="10" className="hiw-s-soft" />
      <rect x="62" y="59" width="68" height="6" rx="3" className="hiw-s-line" />
      <rect x="62" y="70" width="42" height="5" rx="2.5" className="hiw-s-soft" />
      <rect
        x="30.5"
        y="86.5"
        width="240"
        height="42"
        rx="5"
        className="hiw-s-highlight hiw-report-highlight"
      />
      <rect x="38" y="94" width="196" height="6" rx="3" className="hiw-s-line" />
      <rect x="38" y="105" width="222" height="6" rx="3" className="hiw-s-line" />
      <rect x="38" y="116" width="150" height="6" rx="3" className="hiw-s-line" />
      <g className="hiw-report-flag">
        <circle cx="272" cy="66" r="11" className="hiw-s-ring hiw-pulse" />
        <circle cx="272" cy="66" r="11" className="hiw-s-accent" />
        <path d="M268.5 72V60.5h7.5l-1.8 3 1.8 3h-7.5" className="hiw-s-on-accent" />
      </g>
      <g className="hiw-report-status">
        <rect x="30" y="146" width="104" height="24" rx="12" className="hiw-s-accent-tint" />
        <circle cx="44" cy="158" r="3.5" className="hiw-s-accent" />
        <text x="53" y="161.2" fontSize="9" fontWeight="600" className="hiw-s-ink-text">
          Case received
        </text>
        <text x="288" y="161.2" fontSize="7.5" textAnchor="end" className="hiw-s-muted-text">
          Under review
        </text>
      </g>
    </svg>
  );
}

function EvidenceRecordIllustration() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <g
        className="hiw-evidence-card"
        style={
          {
            "--hiw-card": 0,
            "--hiw-from-x": "-18px",
            "--hiw-from-y": "-10px",
            "--hiw-from-r": "-4deg",
          } as React.CSSProperties
        }
      >
        <rect x="30.5" y="16.5" width="220" height="44" rx="8" className="hiw-s-surface" />
        <rect x="42" y="28" width="20" height="20" rx="5" className="hiw-s-accent-tint" />
        <path
          d="M50 40l4-4m-5.5 2.5-1.3 1.3a2.6 2.6 0 0 0 3.7 3.7l1.3-1.3m3.3-5.7 1.3-1.3a2.6 2.6 0 0 0-3.7-3.7l-1.3 1.3"
          className="hiw-s-stroke-accent"
        />
        <text x="72" y="34.5" fontSize="7" className="hiw-s-muted-text">
          Source URL
        </text>
        <text x="72" y="47" fontSize="8.5" className="hiw-s-ink-text">
          news.example/article/2291
        </text>
      </g>
      <g
        className="hiw-evidence-card"
        style={
          {
            "--hiw-card": 1,
            "--hiw-from-x": "22px",
            "--hiw-from-y": "-4px",
            "--hiw-from-r": "3deg",
          } as React.CSSProperties
        }
      >
        <rect x="46.5" y="52.5" width="220" height="80" rx="8" className="hiw-s-surface" />
        <rect x="58" y="63" width="74" height="58" rx="4" className="hiw-s-soft" />
        <circle cx="118" cy="76" r="5" className="hiw-s-line" />
        <path d="M62 117l17-19 12 12 8-8 29 15z" className="hiw-s-line" />
        <text x="144" y="75" fontSize="7" className="hiw-s-muted-text">
          Screenshot
        </text>
        <rect x="144" y="83" width="96" height="5" rx="2.5" className="hiw-s-line" />
        <rect x="144" y="93" width="72" height="5" rx="2.5" className="hiw-s-line" />
        <text x="144" y="115" fontSize="7" className="hiw-s-muted-text">
          1440 × 900 · PNG
        </text>
      </g>
      <g
        className="hiw-evidence-card"
        style={
          {
            "--hiw-card": 2,
            "--hiw-from-x": "-6px",
            "--hiw-from-y": "18px",
            "--hiw-from-r": "-2deg",
          } as React.CSSProperties
        }
      >
        <rect x="62.5" y="124.5" width="220" height="56" rx="8" className="hiw-s-surface" />
        <circle cx="84" cy="152.5" r="10" className="hiw-s-accent-tint" />
        <path d="M84 147v5.5l3.5 2.2" className="hiw-s-stroke-accent" />
        <text x="102" y="148.5" fontSize="7" className="hiw-s-muted-text">
          Captured
        </text>
        <text x="102" y="161" fontSize="8.5" className="hiw-s-ink-text">
          14 Mar 2026 · 09:42 UTC
        </text>
        <circle cx="262" cy="152.5" r="10" className="hiw-s-accent" />
        <path d="M257.5 152.7l3 3 6-6.2" className="hiw-s-on-accent hiw-evidence-check" />
      </g>
    </svg>
  );
}

function CaseStatusIllustration() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" focusable="false">
      <defs>
        <filter id="hiw-notification-shadow" x="-20%" y="-30%" width="140%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" className="hiw-s-shadow" />
        </filter>
      </defs>
      <rect x="12.5" y="24.5" width="172" height="150" rx="10" className="hiw-s-surface" />
      <text x="26" y="44" fontSize="7" className="hiw-s-muted-text">
        Removal request
      </text>
      <text x="26" y="57" fontSize="10" fontWeight="600" className="hiw-s-ink-text">
        Case ET-2841
      </text>
      <path d="M13 68.5h171" className="hiw-s-rule" />
      <path d="M31 87v63" className="hiw-s-rule" />
      <circle cx="31" cy="84" r="5" className="hiw-s-accent" />
      <path d="M28.8 84.1l1.6 1.6 3-3.2" className="hiw-s-on-accent" />
      <text x="44" y="87" fontSize="8" className="hiw-s-ink-text">
        Evidence recorded
      </text>
      <circle cx="31" cy="106" r="5" className="hiw-s-accent" />
      <path d="M28.8 106.1l1.6 1.6 3-3.2" className="hiw-s-on-accent" />
      <text x="44" y="109" fontSize="8" className="hiw-s-ink-text">
        Submitted
      </text>
      <circle cx="31" cy="128" r="5" className="hiw-s-ring hiw-pulse hiw-status-pulse" />
      <circle cx="31" cy="128" r="5" className="hiw-s-surface hiw-s-ring-solid" />
      <circle cx="31" cy="128" r="2" className="hiw-s-accent" />
      <text x="44" y="131" fontSize="8" fontWeight="600" className="hiw-s-ink-text">
        Under review
      </text>
      <circle cx="31" cy="150" r="5" className="hiw-s-surface" />
      <text x="44" y="153" fontSize="8" className="hiw-s-muted-text">
        Update received
      </text>
      <g className="hiw-notification">
        <rect
          x="172.5"
          y="40.5"
          width="136"
          height="60"
          rx="10"
          filter="url(#hiw-notification-shadow)"
          className="hiw-s-surface"
        />
        <circle cx="192" cy="70" r="10" className="hiw-s-accent-tint" />
        <path
          d="M187.5 73h9l-1.2-1.6v-3.2a3.3 3.3 0 0 0-6.6 0v3.2zm3.1 2.3a1.6 1.6 0 0 0 2.8 0"
          className="hiw-s-stroke-accent"
        />
        <circle cx="198" cy="62.5" r="2.6" className="hiw-s-accent hiw-notification-dot" />
        <text x="208" y="64" fontSize="8.5" fontWeight="600" className="hiw-s-ink-text">
          Case updated
        </text>
        <text x="208" y="76" fontSize="7.5" className="hiw-s-muted-text">
          Now under review
        </text>
        <text x="208" y="88" fontSize="6.8" className="hiw-s-muted-text">
          Just now
        </text>
      </g>
    </svg>
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
