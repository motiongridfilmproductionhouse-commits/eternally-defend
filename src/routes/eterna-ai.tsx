import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BrainCircuit,
  Eye,
  FileCheck2,
  Fingerprint,
  ScanFace,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PublicPage } from "@/components/public/PublicSite";
import { EnquiryButton } from "@/components/public/enquiry/enquiry-modal-context";

const CANONICAL = "https://protectbyeterna.com/eterna-ai";

export const Route = createFileRoute("/eterna-ai")({
  head: () => ({
    meta: [
      { title: "Eterna AI | AI Identity Protection, Deepfake Defense & Image Immunization" },
      {
        name: "description",
        content:
          "Eterna AI is the AI protection and research capability of Eterna Sentinel, focused on digital identity protection, deepfake defense, AI impersonation response and Eterna Image Immunization.",
      },
      { name: "robots", content: "index, follow" },
      {
        property: "og:title",
        content: "Eterna AI | AI Identity Protection, Deepfake Defense & Image Immunization",
      },
      {
        property: "og:description",
        content:
          "Eterna AI is the AI protection and research capability of Eterna Sentinel, focused on digital identity protection, deepfake defense, AI impersonation response and Eterna Image Immunization.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: EternaAiPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Eterna AI: Protecting Digital Identity in the Age of Generative AI",
    description:
      "Eterna AI is the AI protection and research capability of Eterna Sentinel, focused on digital identity protection, deepfake defense, AI impersonation response and Eterna Image Immunization.",
    publisher: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      alternateName: ["Eterna", "Eterna AI", "Protect by Eterna"],
      url: "https://protectbyeterna.com/",
    },
    about: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      alternateName: ["Eterna", "Eterna AI", "Protect by Eterna"],
    },
    mainEntityOfPage: CANONICAL,
  });
}

const faqs = [
  {
    q: "Is Eterna AI the same as Eterna Sentinel?",
    a: "Eterna AI refers to the artificial intelligence protection and research capabilities developed by Eterna Sentinel. Eterna Sentinel is the company and digital identity protection platform behind Eterna's deepfake defense, AI impersonation response and Eterna Image Immunization initiatives.",
  },
  {
    q: "What does Eterna AI protect against?",
    a: "Eterna AI is built to help identify and respond to deepfakes, synthetic media, AI impersonation, unauthorized likeness reuse and other emerging forms of synthetic identity misuse, using a combination of monitoring, verification and evidence-led human review.",
  },
  {
    q: "Is Eterna Image Immunization part of Eterna AI?",
    a: "Yes. Eterna Image Immunization (EIP) is one of Eterna AI's defensive identity-protection research initiatives: a pre-publication technology designed to reduce the risk of an authorized image being used for unauthorized AI identity replication.",
  },
  {
    q: "Does Eterna AI guarantee that deepfakes or impersonation will be removed?",
    a: "No. Eterna AI supports detection, verification and evidence preservation, but enforcement action depends on authorization, eligibility, applicable platform routes and human review. Eterna is not an automatic takedown service.",
  },
  {
    q: "How does Eterna AI verify a finding before treating it as confirmed?",
    a: "Eterna applies a four-part standard, sourced, corroborated, attributable to a method, and authorized before enforcement, before any impersonation, deepfake or content-misuse finding is treated as verified.",
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

const responseStages = [
  ["01", "Verify", "Establish identity, authority and protected assets."],
  ["02", "Monitor", "Discover relevant signals across agreed public surfaces."],
  ["03", "Investigate", "Separate ordinary appearances from genuine risk."],
  ["04", "Preserve Evidence", "Retain source, timestamp and context for review."],
  ["05", "Enforce", "Submit eligible, authorized and approved cases appropriately."],
  ["06", "Monitor Again", "Track status, recurrence and emerging exposure."],
] as const;

const EAI_REQUEST_PREFILL = {
  sourcePage: "eterna-ai",
  sourceCta: "Request Protection",
  department: "protection",
} as const;

function EternaAiPage() {
  return (
    <PublicPage
      eyebrow="Eterna AI"
      title="Eterna AI: Protecting Digital Identity in the Age of Generative AI"
      intro="Eterna AI is the artificial intelligence protection and research capability developed by Eterna Sentinel. It focuses on protecting people and organizations from deepfakes, AI impersonation, unauthorized likeness reuse and emerging forms of synthetic identity misuse."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqSchema() }} />

      {/* 1. What is Eterna AI? */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <BrainCircuit className="size-5 text-landing-accent" />
            <p className="landing-kicker mt-6">What is Eterna AI?</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              One protection and research capability, applied across every case.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Eterna AI combines monitoring, verification, evidence preservation, response systems
              and defensive research, including{" "}
              <Link to="/image-immunization" className="landing-link text-landing-ink">
                Eterna Image Immunization
              </Link>
              , into a single operating capability.
            </p>
            <p>
              Rather than a single product, Eterna AI is the name for how Eterna Sentinel applies
              artificial intelligence, evidence-led investigation and human judgment together, so
              that detection technology is never treated as a verdict on its own.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Eterna AI and Eterna Sentinel */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Eterna AI and Eterna Sentinel</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              One company. One protection capability.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Eterna Sentinel is the company and the managed digital identity protection platform.
              Eterna AI is not a separate business: it is the name for the artificial intelligence
              protection and research capability that Eterna Sentinel builds and operates.
            </p>
            <p>
              Every capability described on this page, deepfake defense, AI impersonation response,
              digital identity monitoring and Eterna Image Immunization, operates under Eterna
              Sentinel's authorization, evidence and human-review standards. Read more about{" "}
              <Link to="/about" className="landing-link text-landing-ink">
                who Eterna Sentinel is and how it operates
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* 3. Deepfake Protection */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <ScanFace className="size-5 text-landing-accent" />
            <p className="landing-kicker mt-6">Deepfake Protection</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Detecting and responding to synthetic media.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Eterna AI assesses synthetic and manipulated images, video and audio against protected
              references, and preserves source context so a suspected deepfake can be independently
              reviewed rather than judged on a confidence score alone.
            </p>
            <p>
              Findings are held to Eterna's{" "}
              <Link to="/methodology" className="landing-link text-landing-ink">
                verification methodology
              </Link>{" "}
              before they are treated as confirmed. For background on how deepfakes are made and
              identified, see{" "}
              <Link to="/newsroom/what-is-a-deepfake" className="landing-link text-landing-ink">
                What Is a Deepfake?
              </Link>{" "}
              and{" "}
              <Link
                to="/newsroom/deepfake-verification-guide"
                className="landing-link text-landing-ink"
              >
                the Deepfake Verification Guide
              </Link>
              . If you believe you've found one involving you, see{" "}
              <Link
                to="/newsroom/someone-made-a-deepfake-of-me"
                className="landing-link text-landing-ink"
              >
                Someone Made a Deepfake of Me
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* 4. AI Impersonation Protection */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <Users className="size-5 text-landing-accent" />
            <p className="landing-kicker mt-6">AI Impersonation Protection</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Surfacing fake accounts, cloned voices and identity misuse.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Impersonation increasingly extends beyond static fake accounts to AI-cloned voices,
              fabricated endorsements and executive-fraud attempts. Eterna AI monitors for these
              patterns and coordinates an evidence-led response once authorization is confirmed.
            </p>
            <p>
              For a closer look at impersonation's reputational impact and next steps, see{" "}
              <Link
                to="/newsroom/ai-impersonation-reputation-damage"
                className="landing-link text-landing-ink"
              >
                AI Impersonation and Reputation Damage
              </Link>
              ,{" "}
              <Link
                to="/newsroom/fake-account-using-my-name-photos"
                className="landing-link text-landing-ink"
              >
                Fake Account Using My Name or Photos
              </Link>{" "}
              and the{" "}
              <Link
                to="/newsroom/impersonation-response-guide"
                className="landing-link text-landing-ink"
              >
                Impersonation Response Guide
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* 5. Digital Identity Monitoring */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <Eye className="size-5 text-landing-accent" />
            <p className="landing-kicker mt-6">Digital Identity Monitoring</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Continuous visibility, governed by human review.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Eterna AI supports continuous discovery across agreed public surfaces, then routes
              signals into investigation, evidence preservation and case review rather than
              indiscriminate automatic action.
            </p>
            <p>
              Access control, authorization checks and audit history that govern this monitoring are
              described in{" "}
              <Link to="/security" className="landing-link text-landing-ink">
                Security &amp; Governance
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* 6. Eterna Image Immunization */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <Fingerprint className="size-5 text-landing-accent" />
            <p className="landing-kicker mt-6">Eterna Image Immunization</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Preventative protection, before misuse begins.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Eterna Image Immunization (EIP) is one of Eterna AI's defensive identity-protection
              research initiatives: a pre-publication technology, developed through Eterna's
              internal research and development and currently under validation, designed to reduce
              the risk of an authorized image being used for deepfake creation or unauthorized AI
              identity replication, while preserving the image's natural appearance.
            </p>
            <p>
              <Link
                to="/image-immunization"
                className="landing-link inline-flex items-center gap-1 font-semibold text-landing-ink"
              >
                Explore Eterna Image Immunization <ArrowRight className="size-3.5" />
              </Link>
              . See also{" "}
              <Link
                to="/newsroom/eterna-introduces-image-immunization"
                className="landing-link text-landing-ink"
              >
                Eterna Introduces Image Immunization
              </Link>{" "}
              and{" "}
              <Link
                to="/newsroom/what-is-image-immunization"
                className="landing-link text-landing-ink"
              >
                What Is Image Immunization?
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* 7. Research and Validation */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <FileCheck2 className="size-5 text-landing-accent" />
            <p className="landing-kicker mt-6">Research and Validation</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Documented process, including what's still in progress.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Eterna AI's research, including Eterna Image Immunization, is developed and validated
              against the same evidence standard Eterna applies to every case: sourced,
              corroborated, attributable to a method, and authorized before enforcement. See the
              full{" "}
              <Link to="/methodology" className="landing-link text-landing-ink">
                verification methodology
              </Link>{" "}
              and Eterna's{" "}
              <Link
                to="/identity-response-observatory"
                className="landing-link text-landing-ink"
              >
                Identity Response Observatory
              </Link>
              , its public record of documented digital-identity incidents.
            </p>
            <p>
              For how EIP validation is approached, and why detection alone is not treated as
              protection, see{" "}
              <Link
                to="/newsroom/how-eterna-validates-image-immunization-responsibly"
                className="landing-link text-landing-ink"
              >
                How Eterna Validates Image Immunization Responsibly
              </Link>{" "}
              and{" "}
              <Link
                to="/newsroom/detection-is-not-prevention"
                className="landing-link text-landing-ink"
              >
                Detection Is Not Prevention
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* 8. How Eterna Responds */}
      <section className="border-y border-landing-line bg-landing-ink py-20 text-landing md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <ShieldCheck className="size-5 text-landing-accent" />
              <p className="landing-kicker mt-6 text-landing-accent">How Eterna Responds</p>
              <h2 className="mt-4 text-3xl font-medium md:text-4xl">
                The same six-stage cycle, every time.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-landing-on-dark-muted md:justify-self-end">
              Eterna AI's detection and research feed the same governed operating cycle Eterna
              Sentinel applies to every protection engagement. Technology supports each stage;
              authorization, context and human judgment govern consequential action. Details on
              controls are in{" "}
              <Link to="/security" className="landing-link text-landing">
                Security &amp; Governance
              </Link>
              .
            </p>
          </div>
          <div className="mt-14 grid gap-px bg-landing-on-dark-line md:grid-cols-3">
            {responseStages.map(([number, title, body]) => (
              <article key={number} className="bg-landing-ink p-7">
                <p className="text-xs text-landing-accent">{number}</p>
                <h3 className="mt-12 text-xl font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-on-dark-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 9. FAQ */}
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

      {/* Closing CTA + related reading */}
      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="landing-kicker">Request protection from Eterna AI</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            Tell Eterna what needs protection, and the team will review the identity, exposure and
            appropriate scope.
          </p>
          <EnquiryButton size="lg" className="mt-8" prefill={EAI_REQUEST_PREFILL}>
            Request Protection
          </EnquiryButton>

          <div className="mt-12 border-t border-landing-line pt-8 text-left">
            <h2 className="text-xs font-semibold uppercase text-landing-ink">Related reading</h2>
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <li>
                <Link to="/image-immunization" className="landing-link text-landing-ink">
                  Eterna Image Immunization
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
                <Link to="/identity-response-observatory" className="landing-link text-landing-ink">
                  Identity Response Observatory
                </Link>
              </li>
              <li>
                <Link to="/about" className="landing-link text-landing-ink">
                  About Eterna Sentinel
                </Link>
              </li>
              <li>
                <Link to="/newsroom" className="landing-link text-landing-ink">
                  Newsroom &amp; Insights
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
