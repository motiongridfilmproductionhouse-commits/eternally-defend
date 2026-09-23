import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  Copyright,
  Image as ImageIcon,
  Megaphone,
  Mic2,
  ShieldCheck,
  UserCheck,
  Users,
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

const CANONICAL = "https://protectbyeterna.com/ai-impersonation";

export const Route = createFileRoute("/ai-impersonation")({
  head: () => ({
    meta: [
      { title: "AI Impersonation Protection: Fake Profiles & Cloned Voices | Eterna Sentinel" },
      {
        name: "description",
        content:
          "Eterna's AI impersonation protection detects fake profiles, cloned voices, fake endorsements and identity misuse, then coordinates evidence-led, authorized response.",
      },
      { name: "robots", content: "index, follow" },
      {
        property: "og:title",
        content: "AI Impersonation Protection for Identities That Operate in Public",
      },
      {
        property: "og:description",
        content:
          "Fake profiles, cloned voices, fake endorsements and fraud attempts, detected and responded to with evidence and human review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: AiImpersonationPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "AI impersonation protection",
    name: "Eterna AI Impersonation Protection",
    description:
      "Detection, verification, evidence preservation and response for fake profiles, cloned voices, fake endorsements and AI-driven identity misuse.",
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

const impersonationTypes = [
  {
    icon: Users,
    title: "Fake social profiles",
    body: "Accounts created to pass as a real person or organization.",
  },
  {
    icon: ImageIcon,
    title: "Synthetic video",
    body: "Fabricated video used to impersonate a real identity.",
  },
  {
    icon: Mic2,
    title: "Voice cloning",
    body: "A cloned voice used in calls, messages or fabricated recordings.",
  },
  {
    icon: Megaphone,
    title: "Fake advertisements",
    body: "Ads built around a person's or brand's likeness without authorization.",
  },
  {
    icon: UserCheck,
    title: "Fake endorsements",
    body: "Content implying a person or brand endorsed something they didn't.",
  },
  {
    icon: ShieldCheck,
    title: "Fraud attempts",
    body: "Impersonation used to support financial or executive-fraud schemes.",
  },
  {
    icon: Copyright,
    title: "Copied photos",
    body: "Real photos reused elsewhere to build a false identity or profile.",
  },
  {
    icon: Building2,
    title: "AI-generated identity content",
    body: "Fabricated bios, posts or media built around a real person's identity.",
  },
] as const;

const responseLifecycle = [
  ["01", "Detect", "Identify suspected impersonation across agreed public surfaces."],
  ["02", "Verify", "Assess the finding against Eterna's four-part verification standard."],
  ["03", "Preserve", "Retain source, timestamp and context before anything else happens."],
  ["04", "Respond", "Coordinate an authorized, eligible and appropriate response."],
  ["05", "Monitor", "Track status, recurrence and re-appearance after initial response."],
] as const;

const faqs = [
  {
    q: "Is Eterna AI the same as this AI impersonation service?",
    a: "AI impersonation protection is one of the capabilities operating under Eterna AI, Eterna Sentinel's artificial intelligence protection and research capability. Eterna Sentinel is the company behind it.",
  },
  {
    q: "Can Eterna guarantee a fake account or fake endorsement will be removed?",
    a: "No. Removal depends on authorization, platform policy, eligibility and human review. Eterna coordinates the appropriate response rather than guaranteeing an outcome.",
  },
  {
    q: "How is impersonation different from a deepfake?",
    a: "Impersonation is broader: it includes fake accounts, copied photos and fabricated claims that don't necessarily involve AI-generated media. A deepfake, AI-generated synthetic video, imagery or audio, is one specific tool impersonation can use. See Deepfake Protection for that specific case.",
  },
  {
    q: "Does Eterna keep engagements confidential?",
    a: "Yes. Client identities and case details remain confidential by default and are not disclosed publicly without separate, explicit, written consent.",
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

const AI_REQUEST_PREFILL = {
  sourcePage: "ai-impersonation",
  sourceCta: "Request Protection",
  department: "protection",
  protectionService: "ai-impersonation",
} as const;

function AiImpersonationPage() {
  return (
    <PublicPage
      eyebrow="AI Impersonation"
      title="AI Impersonation Protection for Identities That Operate in Public"
      intro="Eterna helps authorized individuals and organizations detect, verify and respond to fake profiles, cloned voices, fake endorsements and other AI-driven identity misuse."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqSchema() }} />

      <section className="py-16 md:py-20">
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3 px-6">
          <EnquiryButton size="lg" prefill={AI_REQUEST_PREFILL}>
            Request Protection <ArrowRight />
          </EnquiryButton>
          <Button asChild size="lg" variant="outline">
            <Link to="/eterna-ai">About Eterna AI</Link>
          </Button>
        </div>
      </section>

      {/* The new impersonation problem */}
      <section className="border-t border-landing-line py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">The new impersonation problem</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Identity misuse now spreads across platforms at once.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              A fake profile, a cloned voice and a fabricated endorsement can appear on different
              platforms within the same window, each reinforcing the others. Generative AI has
              lowered the cost of producing convincing impersonation content, while the surfaces it
              can spread across have multiplied.
            </p>
            <p>
              Eterna treats impersonation as a pattern to investigate across platforms, not a single
              post to react to in isolation.
            </p>
          </div>
        </div>
      </section>

      {/* Types of impersonation */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">Types of impersonation</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-4xl">
            Identity misuse takes several forms.
          </h2>
          <div className="mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-4">
            {impersonationTypes.map(({ icon: Icon, title, body }) => (
              <article key={title} className="min-h-48 bg-landing p-6">
                <Icon className="size-5 text-landing-accent" />
                <h3 className="mt-10 text-sm font-semibold">{title}</h3>
                <p className="mt-3 text-xs leading-5 text-landing-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Eterna response lifecycle */}
      <section className="border-b border-landing-line bg-landing-ink py-20 text-landing md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <p className="landing-kicker text-landing-accent">Eterna response lifecycle</p>
              <h2 className="mt-4 text-3xl font-medium md:text-4xl">
                Detect. Verify. Preserve. Respond. Monitor.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-landing-on-dark-muted md:justify-self-end">
              Technology supports discovery. Authorization, evidence and human judgment govern every
              consequential step.
            </p>
          </div>
          <div className="mt-14 grid gap-px bg-landing-on-dark-line md:grid-cols-3">
            {responseLifecycle.map(([number, title, body]) => (
              <article key={number} className="bg-landing-ink p-7">
                <p className="text-xs text-landing-accent">{number}</p>
                <h3 className="mt-12 text-xl font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-on-dark-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Identity verification and evidence */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Identity verification and evidence</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Confirmed identity, then confirmed misuse.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Before Eterna acts on an impersonation case, both the affected identity and the
              finding itself are checked against Eterna's{" "}
              <Link to="/methodology" className="landing-link text-landing-ink">
                verification methodology
              </Link>
              : sourced, corroborated, attributable to a method, and authorized before enforcement.
            </p>
            <p>
              Access control, evidence handling and audit history are governed by{" "}
              <Link to="/security" className="landing-link text-landing-ink">
                Security &amp; Governance
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Platform-specific response pathways */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Platform-specific response pathways</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Different platforms, different eligible routes.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Impersonation policies vary by platform, and eligible response paths depend on the
              type of content, where it appears and what rights the affected person holds. Eterna
              reviews which route applies rather than pursuing one fixed process for every case,
              including where impersonation overlaps with{" "}
              <Link to="/deepfake-protection" className="landing-link text-landing-ink">
                deepfake protection
              </Link>{" "}
              or{" "}
              <Link to="/online-reputation-protection" className="landing-link text-landing-ink">
                online reputation
              </Link>{" "}
              concerns.
            </p>
          </div>
        </div>
      </section>

      {/* Public figure and organization protection */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">Public figure and organization protection</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-4xl">
            Built for identities that operate in public.
          </h2>
          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            {[
              [Mic2, "Public figures", "Actors, artists, creators and public-facing individuals."],
              [
                UserCheck,
                "Executives & founders",
                "Leaders whose identity carries organizational risk.",
              ],
              [
                Building2,
                "Organizations",
                "Brands facing impersonation or fraudulent endorsement.",
              ],
            ].map(([Icon, title, body]) => (
              <article
                key={title as string}
                className="landing-audience-card border border-landing-line p-7"
              >
                <Icon className="size-5 text-landing-accent" />
                <h3 className="mt-10 text-lg font-semibold">{title as string}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{body as string}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Confidential by design */}
      <section className="border-y border-landing-line bg-landing-soft py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex items-start gap-3 text-xs leading-6 text-landing-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-landing-accent" />
            <p>
              Confidential by design. Client identities and case details are not disclosed publicly
              without separate, explicit, written consent.
            </p>
          </div>
        </div>
      </section>

      {/* Related guidance */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-xs font-semibold uppercase text-landing-ink">Related guidance</h2>
          <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <Link
                to="/newsroom/ai-impersonation-reputation-damage"
                className="landing-link text-landing-ink"
              >
                AI Impersonation and Reputation Damage
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/fake-account-using-my-name-photos"
                className="landing-link text-landing-ink"
              >
                Fake Account Using My Name or Photos
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/impersonation-response-guide"
                className="landing-link text-landing-ink"
              >
                The Impersonation Response Guide
              </Link>
            </li>
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-landing-line py-20 md:py-28">
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
          <h2 className="landing-kicker">Request AI impersonation protection</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            Tell Eterna what needs protection, and the team will review the identity, exposure and
            appropriate scope.
          </p>
          <EnquiryButton size="lg" className="mt-8" prefill={AI_REQUEST_PREFILL}>
            Request Protection
          </EnquiryButton>

          <div className="mt-12 border-t border-landing-line pt-8 text-left">
            <h2 className="text-xs font-semibold uppercase text-landing-ink">
              Related protection areas
            </h2>
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <li>
                <Link to="/deepfake-protection" className="landing-link text-landing-ink">
                  Deepfake Protection
                </Link>
              </li>
              <li>
                <Link to="/online-reputation-protection" className="landing-link text-landing-ink">
                  Online Reputation Protection
                </Link>
              </li>
              <li>
                <Link to="/identity-response-observatory" className="landing-link text-landing-ink">
                  Identity Response Observatory
                </Link>
              </li>
              <li>
                <Link to="/security" className="landing-link text-landing-ink">
                  Security &amp; Governance
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
