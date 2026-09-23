import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  Globe2,
  Newspaper,
  Scale,
  Search,
  ShieldAlert,
  TrendingDown,
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

const CANONICAL = "https://protectbyeterna.com/online-reputation-protection";

export const Route = createFileRoute("/online-reputation-protection")({
  head: () => ({
    meta: [
      {
        title:
          "Online Reputation Protection: Monitoring, Verification & Response | Eterna Sentinel",
      },
      {
        name: "description",
        content:
          "Eterna's online reputation protection monitors, verifies and responds to identity misuse, false claims and coordinated attacks across the surfaces that carry real risk, for individuals and organizations.",
      },
      { name: "robots", content: "index, follow" },
      {
        property: "og:title",
        content: "Online Reputation Protection: Monitoring, Verification & Response",
      },
      {
        property: "og:description",
        content:
          "Monitor, verify and respond to identity misuse and reputation attacks, with evidence and authorization behind every action.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: OnlineReputationProtectionPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Online reputation protection",
    name: "Eterna Online Reputation Protection",
    description:
      "Monitoring, verification and coordinated response for identity misuse, false claims and reputation attacks across high-risk digital surfaces.",
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

const riskAreas = [
  {
    icon: Newspaper,
    title: "False allegations",
    body: "Fabricated claims published to damage a person's or organization's standing.",
  },
  {
    icon: Users,
    title: "Fake profiles",
    body: "Accounts impersonating a real identity to mislead, defraud or defame.",
  },
  {
    icon: TrendingDown,
    title: "Coordinated attacks",
    body: "Organized campaigns designed to surface and amplify damaging material at scale.",
  },
  {
    icon: Search,
    title: "Harmful search visibility",
    body: "Damaging results that dominate what's visible when someone's name is searched.",
  },
  {
    icon: Globe2,
    title: "Cross-platform spread",
    body: "The same false claim or image reappearing across multiple surfaces over time.",
  },
  {
    icon: ShieldAlert,
    title: "Identity-based harassment",
    body: "Targeted harassment that relies on exposing or misrepresenting someone's identity.",
  },
] as const;

const responseFramework = [
  [
    "01",
    "Monitor",
    "Track agreed surfaces for identity misuse, false claims and coordinated activity.",
  ],
  ["02", "Verify", "Assess each finding against Eterna's four-part verification standard."],
  ["03", "Preserve", "Retain source, timestamp and context before any response is pursued."],
  ["04", "Respond", "Coordinate an authorized, eligible response appropriate to the finding."],
  ["05", "Monitor again", "Continue watching for recurrence after an initial response."],
] as const;

const audiences = [
  [Users, "Individuals", "People facing personal attacks, impersonation or false claims online."],
  [Building2, "Executives", "Leaders whose public standing carries organizational risk."],
  [Scale, "Organizations", "Brands and institutions facing coordinated reputation attacks."],
  [
    ShieldAlert,
    "Students & families",
    "Cases involving minors or family members, handled with care.",
  ],
] as const;

const faqs = [
  {
    q: "Is Eterna a reputation management or SEO agency?",
    a: "No. Eterna is an identity-protection and digital-risk technology company. Online reputation protection is one part of a broader capability that also includes deepfake defense, AI impersonation response and Eterna Image Immunization, not a standalone content-suppression or search-ranking service.",
  },
  {
    q: "Can Eterna guarantee negative content will be removed?",
    a: "No. Removal depends on authorization, platform eligibility, applicable policy and human review. Eterna coordinates the appropriate, eligible response rather than guaranteeing an outcome.",
  },
  {
    q: "How is this different from search engine optimization?",
    a: "SEO is about improving visibility. Eterna's work starts with verifying whether a claim or piece of content is false, misleading or misuses someone's identity, then pursuing an authorized response, monitoring and evidence preservation, not ranking manipulation.",
  },
  {
    q: "Does Eterna monitor for repeat attacks after a response?",
    a: "Yes. Continuous monitoring after an initial response is part of Eterna's operating cycle, since reputation attacks and false claims can recur or resurface on other surfaces over time.",
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

const ORP_REQUEST_PREFILL = {
  sourcePage: "online-reputation-protection",
  sourceCta: "Request Protection",
  department: "protection",
  protectionService: "online-reputation",
} as const;

function OnlineReputationProtectionPage() {
  return (
    <PublicPage
      eyebrow="Online Reputation Protection"
      title="Online Reputation Protection Built for High-Risk Digital Environments"
      intro="Eterna monitors, verifies and responds to identity misuse, false claims and coordinated attacks across the surfaces that carry real risk, for individuals and organizations."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqSchema() }} />

      <section className="py-16 md:py-20">
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3 px-6">
          <EnquiryButton size="lg" prefill={ORP_REQUEST_PREFILL}>
            Request Protection <ArrowRight />
          </EnquiryButton>
          <Button asChild size="lg" variant="outline">
            <Link to="/methodology">How Eterna Works</Link>
          </Button>
        </div>
      </section>

      {/* 01. What Eterna is, and isn't */}
      <section className="border-t border-landing-line py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">What Eterna is, and isn't</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              An identity-protection and digital-risk technology company.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Eterna is not a search-optimization service and not a content-removal shop that pushes
              links down a results page. Online reputation protection sits alongside deepfake
              defense, AI impersonation response and{" "}
              <Link to="/eterna-ai" className="landing-link text-landing-ink">
                Eterna AI
              </Link>{" "}
              as one part of a single identity-protection capability.
            </p>
            <p>
              Every case begins with verification, not visibility tactics. Eterna determines whether
              a claim is false, whether content misuses someone's identity, and what an authorized,
              eligible response looks like.
            </p>
          </div>
        </div>
      </section>

      {/* 02. What puts reputation at risk */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">What puts reputation at risk</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-4xl">
            Reputation risk online takes several forms.
          </h2>
          <div className="mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-3">
            {riskAreas.map(({ icon: Icon, title, body }) => (
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
                Monitor. Verify. Preserve. Respond. Monitor again.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-landing-on-dark-muted md:justify-self-end">
              Eterna is not an automatic takedown service. Every stage after monitoring depends on
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

      {/* 04. Verification before response */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Verification before response</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              A claim isn't treated as false until it's verified.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Every finding is checked against the same four-part{" "}
              <Link to="/methodology" className="landing-link text-landing-ink">
                verification methodology
              </Link>{" "}
              applied across Eterna's work: sourced, corroborated, attributable to a method, and
              authorized before enforcement.
            </p>
            <p>
              Evidence handling, access control and human review are governed by Eterna's{" "}
              <Link to="/security" className="landing-link text-landing-ink">
                Security &amp; Governance
              </Link>{" "}
              controls, applied consistently across every protection engagement.
            </p>
          </div>
        </div>
      </section>

      {/* 05. Related identity risks */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Related identity risks</p>
            <h2 className="mt-4 text-3xl font-medium md:text-4xl">
              Reputation attacks rarely stay in one lane.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              A false claim can arrive alongside manipulated media or an impersonating account.
              Eterna's{" "}
              <Link to="/deepfake-protection" className="landing-link text-landing-ink">
                deepfake protection
              </Link>{" "}
              and{" "}
              <Link to="/ai-impersonation" className="landing-link text-landing-ink">
                AI impersonation protection
              </Link>{" "}
              capabilities are reviewed alongside reputation cases when identity misuse is
              suspected, rather than treated as separate, unrelated problems.
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
              Attacks can resurface after an initial response.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              A single response doesn't end monitoring. Eterna continues watching agreed surfaces
              for recurrence after an initial finding, so a repeat attack is caught rather than
              treated as a new, unrelated case.
            </p>
          </div>
        </div>
      </section>

      {/* 07. For whom */}
      <section className="border-y border-landing-line bg-landing-soft py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">For whom</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-4xl">
            Built for people and organizations with public exposure.
          </h2>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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

      {/* 08. Related intelligence */}
      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-xs font-semibold uppercase text-landing-ink">Related intelligence</h2>
          <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <Link
                to="/newsroom/brand-reputation-risk-business-risk"
                className="landing-link text-landing-ink"
              >
                Brand Reputation Risk Is Business Risk
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/first-24-hours-online-reputation-crisis"
                className="landing-link text-landing-ink"
              >
                The First 24 Hours of an Online Reputation Crisis
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/negative-search-results-brand-reputation"
                className="landing-link text-landing-ink"
              >
                Negative Search Results and Brand Reputation
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/false-allegations-online-what-to-do"
                className="landing-link text-landing-ink"
              >
                False Allegations Online: What to Do
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/why-companies-need-reputation-monitoring"
                className="landing-link text-landing-ink"
              >
                Why Companies Need Reputation Monitoring
              </Link>
            </li>
            <li>
              <Link
                to="/newsroom/online-reputation-problems-business-growth"
                className="landing-link text-landing-ink"
              >
                Online Reputation Problems and Business Growth
              </Link>
            </li>
          </ul>
        </div>
      </section>

      {/* 09. FAQ */}
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

      {/* 10. Closing CTA + related solutions */}
      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="landing-kicker">Request reputation protection</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            Tell Eterna what's happening, and the team will review the identity, exposure and
            appropriate scope.
          </p>
          <EnquiryButton size="lg" className="mt-8" prefill={ORP_REQUEST_PREFILL}>
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
                <Link to="/ai-impersonation" className="landing-link text-landing-ink">
                  AI Impersonation Protection
                </Link>
              </li>
              <li>
                <Link to="/image-immunization" className="landing-link text-landing-ink">
                  Eterna Image Immunization
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
