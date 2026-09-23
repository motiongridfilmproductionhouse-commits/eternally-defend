import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileSearch, Fingerprint, Radar, ScrollText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";
import { EnquiryButton } from "@/components/public/enquiry/enquiry-modal-context";

const CANONICAL = "https://protectbyeterna.com/research";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      {
        title: "Eterna Research: Identity Protection in the Synthetic Media Era | Eterna Sentinel",
      },
      {
        name: "description",
        content:
          "Eterna Research develops and validates the verification methodology, initiatives and standards behind Eterna's identity-protection and digital-risk work, including Eterna Image Immunization.",
      },
      { name: "robots", content: "index, follow" },
      {
        property: "og:title",
        content: "Eterna Research: Identity Protection in the Synthetic Media Era",
      },
      {
        property: "og:description",
        content:
          "How Eterna researches, validates and documents its approach to identity protection as synthetic media evolves.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: ResearchPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Eterna Research",
    description:
      "Research and validation behind Eterna's identity-protection methodology, initiatives and standards.",
    isPartOf: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      alternateName: ["Eterna", "Eterna AI", "Protect by Eterna"],
      url: "https://protectbyeterna.com/",
    },
    mainEntityOfPage: CANONICAL,
  });
}

const researchAreas = [
  {
    icon: Fingerprint,
    title: "Eterna Image Immunization",
    body: "A preventative research initiative applied to an image before publication, currently under validation.",
    to: "/image-immunization",
  },
  {
    icon: ScrollText,
    title: "Identity Response Observatory",
    body: "The published standard behind how identity-related findings are verified and labeled.",
    to: "/identity-response-observatory",
  },
  {
    icon: FileSearch,
    title: "Verification methodology",
    body: "The four-part standard, sourced, corroborated, attributable, authorized, applied to every case.",
    to: "/methodology",
  },
  {
    icon: Radar,
    title: "Eterna AI",
    body: "The artificial intelligence protection and research capability that this work is developed under.",
    to: "/eterna-ai",
  },
] as const;

const distinctions = [
  {
    title: "Protection",
    body: "Ongoing monitoring and safeguards applied to an identity across agreed surfaces.",
  },
  {
    title: "Response",
    body: "The authorized, verified action taken once a finding meets Eterna's evidentiary standard.",
  },
  {
    title: "Research",
    body: "The work of developing, testing and validating the methods protection and response rely on.",
  },
  {
    title: "Prevention",
    body: "Measures like Eterna Image Immunization, applied before misuse occurs rather than after.",
  },
] as const;

const RESEARCH_INQUIRY_PREFILL = {
  sourcePage: "research",
  sourceCta: "Media & Research Inquiries",
  department: "media",
} as const;

function ResearchPage() {
  return (
    <PublicPage
      eyebrow="Eterna Research"
      title="Researching How Identity Survives the Synthetic Media Era"
      intro="Eterna Research develops and validates the methodology, initiatives and standards behind Eterna's identity-protection and digital-risk work."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />

      <section className="py-16 md:py-20">
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3 px-6">
          <Button asChild size="lg">
            <Link to="/eterna-ai">
              About Eterna AI <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/methodology">Verification Methodology</Link>
          </Button>
        </div>
      </section>

      {/* 01. Why this research exists */}
      <section className="border-t border-landing-line py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Why this research exists</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Identity protection has to keep pace with generative AI.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Synthetic media, cloned voices and AI-generated identity content are cheaper to
              produce and harder to distinguish from reality than they were even a short time ago.
              Eterna Research is the work of developing, testing and documenting the methods that
              Eterna's protection and response capabilities are built on.
            </p>
            <p>
              This is not a marketing claim of proprietary technology. It's the ongoing, disclosed
              work behind a published verification standard and a small number of active research
              initiatives, one of which, Eterna Image Immunization, is currently under validation
              rather than presented as a finished, guaranteed product.
            </p>
          </div>
        </div>
      </section>

      {/* 02. Research areas */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">Research areas</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-4xl">
            Four areas of active research and validation.
          </h2>
          <div className="mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2">
            {researchAreas.map(({ icon: Icon, title, body, to }) => (
              <article key={title} className="min-h-56 bg-landing p-7">
                <Icon className="size-5 text-landing-accent" />
                <h3 className="mt-10 text-sm font-semibold">{title}</h3>
                <p className="mt-3 text-xs leading-5 text-landing-muted">{body}</p>
                <Link
                  to={to}
                  className="landing-link mt-4 inline-flex items-center gap-1 text-xs font-semibold text-landing-ink"
                >
                  Learn more <ArrowRight className="size-3" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 03. Protection, response, research and prevention */}
      <section className="border-b border-landing-line bg-landing-ink py-20 text-landing md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker text-landing-accent">How the pieces fit together</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-4xl">
            Protection, response, research and prevention are distinct.
          </h2>
          <div className="mt-14 grid gap-px bg-landing-on-dark-line sm:grid-cols-2 lg:grid-cols-4">
            {distinctions.map(({ title, body }) => (
              <article key={title} className="bg-landing-ink p-7">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-3 text-xs leading-5 text-landing-on-dark-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 04. Responsible validation */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <ShieldCheck className="size-5 text-landing-accent" />
            <p className="landing-kicker mt-6">Responsible validation</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Research is disclosed, not overstated.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Eterna does not present research in progress as a finished capability. Where an
              initiative, like{" "}
              <Link to="/image-immunization" className="landing-link text-landing-ink">
                Eterna Image Immunization
              </Link>
              , is still under validation, that status is stated plainly rather than implied
              otherwise.
            </p>
            <p>
              The same standard applies to the{" "}
              <Link to="/identity-response-observatory" className="landing-link text-landing-ink">
                Identity Response Observatory
              </Link>
              : nothing published there is framed as an incident count, a case outcome or a claim of
              removal beyond what has actually been verified.
            </p>
          </div>
        </div>
      </section>

      {/* 05. Publications and reading */}
      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-xs font-semibold uppercase text-landing-ink">
            Related reading from Eterna Newsroom
          </h2>
          <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <Link
                to="/newsroom/what-is-image-immunization"
                className="landing-link text-landing-ink"
              >
                What Is Image Immunization?
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/how-eterna-validates-image-immunization-responsibly"
                className="landing-link text-landing-ink"
              >
                How Eterna Validates Image Immunization Responsibly
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/inside-eterna-image-immunization"
                className="landing-link text-landing-ink"
              >
                Inside Eterna Image Immunization
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/detection-is-not-prevention"
                className="landing-link text-landing-ink"
              >
                Detection Is Not Prevention
              </Link>
            </li>
            <li>
              <Link to="/newsroom/what-is-a-deepfake" className="landing-link text-landing-ink">
                What Is a Deepfake?
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/eterna-introduces-image-immunization"
                className="landing-link text-landing-ink"
              >
                Eterna Introduces Image Immunization
              </Link>
            </li>
          </ul>
        </div>
      </section>

      {/* 06. Closing CTA */}
      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="landing-kicker">Media &amp; research inquiries</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            For questions about Eterna's research, methodology or validation status, reach the team
            directly.
          </p>
          <EnquiryButton size="lg" className="mt-8" prefill={RESEARCH_INQUIRY_PREFILL}>
            Media &amp; Research Inquiries
          </EnquiryButton>

          <div className="mt-12 border-t border-landing-line pt-8 text-left">
            <h2 className="text-xs font-semibold uppercase text-landing-ink">Explore further</h2>
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <li>
                <Link to="/identity-response-observatory" className="landing-link text-landing-ink">
                  Identity Response Observatory
                </Link>
              </li>
              <li>
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Verification Methodology
                </Link>
              </li>
              <li>
                <Link to="/security" className="landing-link text-landing-ink">
                  Security &amp; Governance
                </Link>
              </li>
              <li>
                <Link to="/eterna-ai" className="landing-link text-landing-ink">
                  Eterna AI
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
