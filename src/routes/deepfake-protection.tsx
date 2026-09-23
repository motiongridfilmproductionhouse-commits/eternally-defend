import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  Fingerprint,
  Image as ImageIcon,
  Megaphone,
  Mic2,
  ScanFace,
  ShieldAlert,
  Users,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PublicPage } from "@/components/public/PublicSite";
import { EnquiryButton } from "@/components/public/enquiry/enquiry-modal-context";

const CANONICAL = "https://protectbyeterna.com/deepfake-protection";

export const Route = createFileRoute("/deepfake-protection")({
  head: () => ({
    meta: [
      { title: "Deepfake Protection: Detection, Verification & Response | Eterna Sentinel" },
      {
        name: "description",
        content:
          "Eterna's deepfake protection identifies, verifies, preserves evidence around and responds to manipulated video, imagery, audio and identity misuse for public figures, executives and organizations.",
      },
      { name: "robots", content: "index, follow" },
      {
        property: "og:title",
        content: "Deepfake Protection: Detection, Verification & Response",
      },
      {
        property: "og:description",
        content:
          "Identify, verify, preserve evidence around and respond to manipulated media and identity misuse, with human review at every consequential step.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: DeepfakeProtectionPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Deepfake protection",
    name: "Eterna Deepfake Protection",
    description:
      "Identification, verification, evidence preservation and response for manipulated video, imagery, audio and identity misuse.",
    provider: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      alternateName: ["Eterna", "Eterna AI", "Protect by Eterna"],
      url: "https://protectbyeterna.com/",
    },
    areaServed: "Worldwide",
    mainEntityOfPage: CANONICAL,
  });
}

const threats = [
  {
    icon: Video,
    title: "Synthetic video",
    body: "Fabricated footage generated to depict a real person doing or saying something they didn't.",
  },
  {
    icon: ScanFace,
    title: "Face swaps",
    body: "A likeness mapped onto another person's video or image, often without consent.",
  },
  {
    icon: ImageIcon,
    title: "AI-generated imagery",
    body: "Fabricated photos built from a person's likeness using generative image tools.",
  },
  {
    icon: Mic2,
    title: "Voice cloning",
    body: "A cloned voice used to fabricate statements, calls or endorsements a person never made.",
  },
  {
    icon: Megaphone,
    title: "Fake endorsements",
    body: "Synthetic media used to imply a person or brand endorsed something they didn't.",
  },
  {
    icon: ShieldAlert,
    title: "Explicit manipulated content",
    body: "Non-consensual explicit imagery generated or altered using a person's likeness.",
  },
  {
    icon: Fingerprint,
    title: "Fraudulent identity use",
    body: "Synthetic media used to support fraud, impersonation or unauthorized identity claims.",
  },
] as const;

const responseFramework = [
  ["01", "Detect", "Identify suspected synthetic or manipulated media across agreed surfaces."],
  ["02", "Verify", "Assess the finding against Eterna's four-part verification standard."],
  ["03", "Preserve", "Retain source, timestamp and context before anything else happens."],
  ["04", "Respond", "Coordinate an authorized, eligible and appropriate response."],
  ["05", "Monitor", "Track status, recurrence and re-upload after initial response."],
] as const;

const audiences = [
  [Mic2, "Public figures", "Actors, artists, creators and other people with public exposure."],
  [Users, "Executives", "Leaders whose identity carries organizational and financial risk."],
  [ScanFace, "Creators", "People whose face, voice or content is a primary public asset."],
  [Building2, "Organizations", "Brands and institutions facing synthetic-media misuse."],
  [
    ShieldAlert,
    "Students & families",
    "Cases involving minors or family members, handled with care.",
  ],
] as const;

const faqs = [
  {
    q: "Can Eterna guarantee a deepfake will be removed?",
    a: "No. Eterna is not an automatic takedown service. Removal depends on authorization, platform eligibility, applicable policy and human review; Eterna coordinates the appropriate response rather than guaranteeing an outcome.",
  },
  {
    q: "How does Eterna verify that something is actually a deepfake?",
    a: "Eterna applies a four-part standard, sourced, corroborated, attributable to a method, and authorized before enforcement, before any finding is treated as verified. See the full verification methodology.",
  },
  {
    q: "What's the difference between deepfake protection and Eterna Image Immunization?",
    a: "Deepfake protection responds to manipulated media that already exists. Eterna Image Immunization (EIP) is a separate, preventative capability applied before an image is published, designed to reduce the risk of it being used to create a deepfake in the first place.",
  },
  {
    q: "Does Eterna monitor for the same deepfake reappearing later?",
    a: "Yes. Continuous monitoring after an initial response is part of Eterna's operating cycle, since manipulated media can recur or resurface on other surfaces after an initial finding.",
  },
] as const;

function faqSchema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  });
}

const DF_REQUEST_PREFILL = {
  sourcePage: "deepfake-protection",
  sourceCta: "Request Protection",
  department: "protection",
  protectionService: "deepfake",
} as const;

function DeepfakeProtectionPage() {
  return (
    <PublicPage
      eyebrow="Deepfake Protection"
      title="Deepfake Protection for Public Identities and Organizations"
      intro="Eterna helps authorized individuals and organizations identify, verify, preserve evidence around, respond to and monitor manipulated media and identity misuse."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqSchema() }} />

      <section className="py-16 md:py-20">
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3 px-6">
          <EnquiryButton size="lg" prefill={DF_REQUEST_PREFILL}>
            Request Protection <ArrowRight />
          </EnquiryButton>
          <Button asChild size="lg" variant="outline">
            <Link to="/methodology">How Eterna Works</Link>
          </Button>
        </div>
      </section>

      {/* 01. The deepfake threat */}
      <section className="border-t border-landing-line py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">The deepfake threat</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Manipulated media is now cheap to make and hard to spot.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Generative tools can now produce synthetic video, imagery and cloned voices from a
              small amount of public source material. The result is manipulated media and identity
              misuse that spreads quickly across platforms, often before the person depicted is even
              aware it exists.
            </p>
            <p>
              Visual inspection alone is not a reliable way to tell real from synthetic. Eterna
              treats every suspected deepfake as a case to be verified, not a judgment to be made on
              appearance alone.
            </p>
          </div>
        </div>
      </section>

      {/* 02. What Eterna protects against */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">What Eterna protects against</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-4xl">
            Manipulated media takes several forms.
          </h2>
          <div className="mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-3">
            {threats.map(({ icon: Icon, title, body }) => (
              <article key={title} className="min-h-48 bg-landing p-7">
                <Icon className="size-5 text-landing-accent" />
                <h3 className="mt-10 text-sm font-semibold">{title}</h3>
                <p className="mt-3 text-xs leading-5 text-landing-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 03. Eterna response framework */}
      <section className="border-b border-landing-line bg-landing-ink py-20 text-landing md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <p className="landing-kicker text-landing-accent">Eterna response framework</p>
              <h2 className="mt-4 text-3xl font-medium md:text-4xl">
                Detect. Verify. Preserve. Respond. Monitor.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-landing-on-dark-muted md:justify-self-end">
              Eterna is not an automatic takedown service. Every stage after detection depends on
              authorization, eligibility and human review before consequential action is taken.
            </p>
          </div>
          <div className="mt-14 grid gap-px bg-landing-on-dark-line md:grid-cols-3">
            {responseFramework.map(([number, title, body]) => (
              <article key={number} className="bg-landing-ink p-7">
                <p className="text-xs text-landing-accent">{number}</p>
                <h3 className="mt-12 text-xl font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-on-dark-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 04. Evidence before enforcement */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Evidence before enforcement</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Verification and evidence come before any response.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Before Eterna classifies a finding as actionable, it is checked against the same
              four-part{" "}
              <Link to="/methodology" className="landing-link text-landing-ink">
                verification methodology
              </Link>{" "}
              applied to every case: sourced, corroborated, attributable to a method, and authorized
              before enforcement.
            </p>
            <p>
              Evidence handling, access control and human review are governed by Eterna's{" "}
              <Link to="/security" className="landing-link text-landing-ink">
                Security &amp; Governance
              </Link>{" "}
              controls, the same controls that apply across every protection engagement.
            </p>
          </div>
        </div>
      </section>

      {/* 05. Deepfake response */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Deepfake response</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              The right response path depends on the case.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Once a finding is verified and authorized, Eterna reviews which response paths apply,
              which can include platform reporting under impersonation, privacy or copyright
              policies, depending on the platform, the content and the rights held by the affected
              person.
            </p>
            <p>
              Which paths are available, and how they're pursued, depends on jurisdiction, platform
              rules and the specifics of each case. Eterna coordinates the eligible route rather
              than pursuing a single fixed process for every incident.
            </p>
          </div>
        </div>
      </section>

      {/* 06. Continuous monitoring */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Continuous monitoring</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Manipulated media can resurface after a response.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              A single response doesn't end monitoring. Eterna continues watching agreed surfaces
              for recurrence or re-upload after an initial finding, so a resurfaced copy is caught
              rather than treated as a new, unrelated case.
            </p>
          </div>
        </div>
      </section>

      {/* 07. Image Immunization */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <Fingerprint className="size-5 text-landing-accent" />
            <p className="landing-kicker mt-6">Eterna Image Immunization</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              A separate, preventative layer, before misuse begins.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Everything above responds to manipulated media that already exists. Eterna Image
              Immunization (EIP) is a different, preventative capability, developed through Eterna's
              internal research and currently under validation, applied to an authorized image
              before it's published, designed to reduce the risk of it being used to create a
              deepfake in the first place.
            </p>
            <p>
              <Link
                to="/image-immunization"
                className="landing-link inline-flex items-center gap-1 font-semibold text-landing-ink"
              >
                Explore Eterna Image Immunization <ArrowRight className="size-3.5" />
              </Link>{" "}
              , one of the research initiatives under{" "}
              <Link to="/eterna-ai" className="landing-link text-landing-ink">
                Eterna AI
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* 08. For whom */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">For whom</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-4xl">
            Built for people and organizations with public exposure.
          </h2>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {audiences.map(([Icon, title, body]) => (
              <article
                key={title as string}
                className="landing-audience-card border border-landing-line p-6"
              >
                <Icon className="size-5 text-landing-accent" />
                <h3 className="mt-10 text-sm font-semibold">{title as string}</h3>
                <p className="mt-3 text-xs leading-5 text-landing-muted">{body as string}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 09. Related intelligence */}
      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-xs font-semibold uppercase text-landing-ink">Related intelligence</h2>
          <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <Link to="/newsroom/what-is-a-deepfake" className="landing-link text-landing-ink">
                What Is a Deepfake?
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/deepfake-verification-guide"
                className="landing-link text-landing-ink"
              >
                The Deepfake Verification Guide
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/someone-made-a-deepfake-of-me"
                className="landing-link text-landing-ink"
              >
                Someone Made a Deepfake of Me
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/deepfake-reuploads-after-removal"
                className="landing-link text-landing-ink"
              >
                Deepfake Reuploads After Removal
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/college-student-deepfakes"
                className="landing-link text-landing-ink"
              >
                College Student Deepfakes
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/ai-generated-explicit-images-student-safety-guide"
                className="landing-link text-landing-ink"
              >
                AI-Generated Explicit Images: A Student Safety Guide
              </Link>
            </li>
          </ul>
        </div>
      </section>

      {/* 10. FAQ */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-3xl px-6">
          <p className="landing-kicker">Frequently asked questions</p>
          <Accordion type="single" collapsible className="mt-8">
            {faqs.map(({ q, a }) => (
              <AccordionItem key={q} value={q}>
                <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                  {q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-6 text-landing-muted">
                  {a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Closing CTA + related solutions */}
      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="landing-kicker">Request deepfake protection</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            Tell Eterna what needs protection, and the team will review the identity, exposure and
            appropriate scope.
          </p>
          <EnquiryButton size="lg" className="mt-8" prefill={DF_REQUEST_PREFILL}>
            Request Protection
          </EnquiryButton>

          <div className="mt-12 border-t border-landing-line pt-8 text-left">
            <h2 className="text-xs font-semibold uppercase text-landing-ink">
              Related protection areas
            </h2>
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <li>
                <Link to="/ai-impersonation" className="landing-link text-landing-ink">
                  AI Impersonation Protection
                </Link>
              </li>
              <li>
                <Link to="/online-reputation-protection" className="landing-link text-landing-ink">
                  Online Reputation Protection
                </Link>
              </li>
              <li>
                <Link to="/eterna-ai" className="landing-link text-landing-ink">
                  Eterna AI
                </Link>
              </li>
              <li>
                <Link to="/research" className="landing-link text-landing-ink">
                  Eterna Research
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
