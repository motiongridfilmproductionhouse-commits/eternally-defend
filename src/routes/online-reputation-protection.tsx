import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/online-reputation-protection";

export const Route = createFileRoute("/online-reputation-protection")({
  head: () => ({
    meta: [
      { title: "Online Reputation Protection: Eterna Sentinel" },
      {
        name: "description",
        content:
          "Reputation defense, evidence-led response to defamatory content, impersonation, manipulated media and coordinated attacks, as distinct from general reputation management.",
      },
      { property: "og:title", content: "Online Reputation Protection: Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Reputation defense, evidence-led response to defamatory content, impersonation, manipulated media and coordinated attacks, as distinct from general reputation management.",
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
    "@type": "WebPage",
    name: "Online Reputation Protection: Eterna Sentinel",
    description:
      "Reputation defense, evidence-led response to defamatory content, impersonation, manipulated media and coordinated attacks, as distinct from general reputation management.",
    publisher: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      url: "https://protectbyeterna.com/",
    },
    mainEntityOfPage: CANONICAL,
  });
}

const threatTypes = [
  {
    title: "Defamatory content",
    description:
      "False statements of fact, published as if true, that damage a person's or organization's reputation.",
  },
  {
    title: "Reputation attacks",
    description:
      "Coordinated or repeated efforts to damage someone's standing, sometimes combining several of the tactics on this list at once.",
  },
  {
    title: "Impersonation",
    description:
      "Fake accounts, profiles or communications built to pass as a real person or organization.",
  },
  {
    title: "Manipulated media",
    description:
      "Edited, staged or AI-generated images, video or audio presented as authentic to mislead about what someone said or did.",
  },
  {
    title: "Unauthorized content",
    description:
      "Real material, photos, footage, private communications, published or reused without the subject's consent.",
  },
  {
    title: "Fake endorsements",
    description:
      "Content fabricated to make it look like someone endorses a product, cause or claim they have no actual connection to.",
  },
  {
    title: "Coordinated amplification",
    description:
      "Networks of accounts working together to spread damaging content further and faster than it would spread organically, making it look more prevalent or credible than it is.",
  },
];

const lifecycle = [
  {
    stage: "Detect",
    body: "Identify that damaging content exists, through monitoring, direct reports, or someone flagging it.",
  },
  {
    stage: "Verify",
    body: "Confirm what the content actually is and how it was made, against the same sourced, corroborated, method-attributable standard used across Eterna's work. See Methodology.",
  },
  {
    stage: "Preserve",
    body: "Capture evidence, the content itself, its source, its spread, before it can be deleted, edited or buried.",
  },
  {
    stage: "Assess",
    body: "Evaluate scope and severity: how far it has spread, who's seeing it, and what's actually at stake.",
  },
  {
    stage: "Respond",
    body: "Act on the assessment: platform reporting, direct outreach, or another appropriate response, matched to what was actually found.",
  },
  {
    stage: "Escalate",
    body: "Where a platform's own tools don't resolve it, escalate through formal channels, or bring in legal counsel where the situation calls for it.",
  },
  {
    stage: "Monitor",
    body: "Continue watching after the initial response. Reputation harm can resurface, spread to new platforms, or return in a different form.",
  },
];

function OnlineReputationProtectionPage() {
  return (
    <PublicPage
      eyebrow="Online Reputation Protection"
      title="Reputation Defense: Responding to Real Harm, Not Managing Perception"
      intro="What online reputation protection actually involves when the problem is real, documented harm, defamatory content, impersonation, manipulated media or a coordinated attack, and how that's different from general reputation management."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <h2 className="landing-kicker">Reputation management</h2>
              <p className="mt-4 text-sm leading-7 text-landing-muted">
                Reputation management, as the term is generally used, is proactive and ongoing:
                shaping how someone or something is perceived online, building positive visibility,
                and influencing what shows up in search results over time. It's a marketing and
                communications discipline, and it doesn't require anything to have gone wrong first.
              </p>
            </div>
            <div>
              <h2 className="landing-kicker">Reputation defense</h2>
              <p className="mt-4 text-sm leading-7 text-landing-muted">
                Reputation defense is different: it's a response to something specific that has
                already happened, defamatory content, impersonation, manipulated media, a
                coordinated attack, and it starts with establishing what actually happened before
                deciding what to do about it. It's evidence-led rather than perception-led. This
                page, and Eterna's work in this area, is about reputation defense.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="landing-kicker">What reputation defense responds to</h2>
          <div className="mt-10 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-3">
            {threatTypes.map((threat) => (
              <div key={threat.title} className="landing-feature-card bg-landing p-6">
                <h3 className="text-sm font-semibold text-landing-ink">{threat.title}</h3>
                <p className="mt-3 text-xs leading-6 text-landing-muted">{threat.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">The Eterna reputation defense lifecycle</h2>
          <p className="mt-4 text-sm leading-7 text-landing-muted">
            A general shape this kind of work follows, from first noticing a problem through to
            making sure it doesn't quietly return.
          </p>
          <ol className="mt-10 space-y-6">
            {lifecycle.map((item, index) => (
              <li
                key={item.stage}
                className="flex gap-5 border-t border-landing-line pt-6 first:border-t-0 first:pt-0"
              >
                <span className="landing-kicker shrink-0 text-landing-accent">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-landing-ink">{item.stage}</h3>
                  <p className="mt-2 text-sm leading-6 text-landing-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-sm leading-7 text-landing-muted">
          <h2 className="landing-kicker">Why monitoring matters even after resolution</h2>
          <p className="mt-4">
            Damaging content rarely stays in one place. A single successful takedown doesn't
            guarantee the same content, or a variation of it, won't resurface on another platform,
            or that a coordinated effort won't simply regroup elsewhere. Ongoing monitoring is what
            catches that, rather than treating one resolved incident as the end of the exposure.
          </p>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">How this connects to Eterna's other work</h2>
          <p className="mt-4 text-sm leading-7 text-landing-muted">
            Verification here follows the same standard used across Eterna's work, see{" "}
            <Link to="/methodology" className="landing-link text-landing-ink">
              Methodology
            </Link>
            . Where the harm involves deepfakes or synthetic media specifically, see{" "}
            <Link to="/deepfake-protection" className="landing-link text-landing-ink">
              Deepfake Protection
            </Link>
            . Where the goal is reducing exposure before content is even published, see{" "}
            <Link to="/image-immunization" className="landing-link text-landing-ink">
              Eterna Image Immunization
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">Frequently asked questions</h2>
          <Accordion type="single" collapsible className="mt-8">
            <AccordionItem value="management-vs-defense">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                What's the difference between reputation management and reputation defense?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                Reputation management is proactive, shaping perception and visibility over time, and
                doesn't require anything to have gone wrong. Reputation defense responds to
                something specific that already happened, and starts with verifying what actually
                occurred before acting.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="guarantee-removal">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                Can you guarantee damaging content will be removed?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                No. Outcomes depend on the platform involved, the nature of the content, and
                applicable law. No responsible service can guarantee a specific removal outcome or
                timeline.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="legal-vs-platform">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                Do I need a lawyer for this?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                Sometimes, and it depends on the specifics, jurisdiction, the type of harm, and
                whether platform-level reporting is sufficient. This page isn't legal advice; where
                a legal question is involved, that's a question for qualified counsel.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="landing-kicker">Talk through a specific situation</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            Reach out to discuss a reputation-related incident or ask what protection could look
            like.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/contact">Contact Eterna</Link>
          </Button>

          <div className="mt-12 border-t border-landing-line pt-8 text-left">
            <h2 className="text-xs font-semibold uppercase text-landing-ink">Related reading</h2>
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <li>
                <Link to="/deepfake-protection" className="landing-link text-landing-ink">
                  Deepfake Protection
                </Link>
              </li>
              <li>
                <Link to="/image-immunization" className="landing-link text-landing-ink">
                  Eterna Image Immunization
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/impersonation-response-guide"
                  className="landing-link text-landing-ink"
                >
                  Impersonation Response Guide
                </Link>
              </li>
              <li>
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Methodology
                </Link>
              </li>
              <li>
                <Link to="/case-studies" className="landing-link text-landing-ink">
                  Case Studies
                </Link>
              </li>
              <li>
                <Link to="/identity-response-observatory" className="landing-link text-landing-ink">
                  Identity Response Observatory
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
