import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/ai-impersonation";

export const Route = createFileRoute("/ai-impersonation")({
  head: () => ({
    meta: [
      { title: "AI Impersonation: Celebrity Scams, Executive Fraud & Cloned Voices" },
      {
        name: "description",
        content:
          "How AI impersonation shows up in practice, celebrity endorsement scams, executive impersonation, fake founder videos, fake product endorsements and cloned voices, and how to respond.",
      },
      {
        property: "og:title",
        content: "AI Impersonation: Celebrity Scams, Executive Fraud & Cloned Voices",
      },
      {
        property: "og:description",
        content:
          "How AI impersonation shows up in practice, celebrity endorsement scams, executive impersonation, fake founder videos, fake product endorsements and cloned voices, and how to respond.",
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
    "@type": "WebPage",
    name: "AI Impersonation: Celebrity Scams, Executive Fraud & Cloned Voices",
    description:
      "How AI impersonation shows up in practice, celebrity endorsement scams, executive impersonation, fake founder videos, fake product endorsements and cloned voices, and how to respond.",
    publisher: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      url: "https://protectbyeterna.com/",
    },
    mainEntityOfPage: CANONICAL,
  });
}

const patterns = [
  {
    title: "Celebrity endorsement scams",
    description:
      "AI-generated video, audio or images used to make it look like a well-known public figure is endorsing a product, investment or opportunity they have no connection to. Often paired with fabricated news-style framing to appear more credible.",
    watchFor:
      "An endorsement that's out of character, appears only in ads or unfamiliar accounts, or pushes urgency ('limited time,' 'invest now').",
  },
  {
    title: "Executive impersonation",
    description:
      "Fabricated video, audio or messaging made to look like it came from a company's own executive, used to pressure employees, vendors or partners into acting quickly, approving a payment, sharing credentials, changing account details.",
    watchFor:
      "An unusual request delivered outside normal channels, especially one that pushes urgency and discourages verification through a second channel.",
  },
  {
    title: "Fake founder videos",
    description:
      "Synthetic video of a startup or company founder announcing something they never announced, a product launch, a funding round, a partnership, used to manipulate investors, customers or markets.",
    watchFor:
      "An announcement that doesn't appear on the company's own official channels, or that surfaces first on an unfamiliar account.",
  },
  {
    title: "Fake product endorsements",
    description:
      "AI-generated content presenting a product as endorsed, used or recommended by someone who never actually reviewed or used it, distinct from celebrity-specific scams in that it can target any recognizable figure, including ordinary customers or micro-influencers.",
    watchFor:
      "A testimonial with no verifiable original source, or one that appears simultaneously across many unrelated accounts.",
  },
  {
    title: "Cloned voices",
    description:
      "AI-generated audio built to sound like a specific real person, used in phone calls, voicemails or as the audio track for a fabricated video, sometimes as the whole scam, sometimes as one component of a larger one.",
    watchFor:
      "A call requesting urgent action, money or sensitive information, especially one that discourages hanging up and calling back through a known number.",
  },
];

function AiImpersonationPage() {
  return (
    <PublicPage
      eyebrow="AI Impersonation"
      title="AI Impersonation: How It Shows Up, and How to Respond"
      intro="AI impersonation isn't one thing, it's a set of related patterns, celebrity endorsement scams, executive impersonation, fake founder videos, fake product endorsements and cloned voices, that share a common mechanism: synthetic media built to pass as a real, recognizable person."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-6 px-6 text-sm leading-7 text-landing-muted">
          <h2 className="landing-kicker">Why this category is broader than "deepfakes"</h2>
          <p>
            "Deepfake" usually brings to mind manipulated video. AI impersonation is wider than
            that: it includes cloned voice alone, in a phone call with no video at all, and
            text-based impersonation using a fabricated quote or statement with no generated media
            at all. What connects these patterns isn't the technique, it's the goal: making an
            audience believe a specific, real, recognizable person said or did something they
            didn't.
          </p>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="landing-kicker">Five common patterns</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            {patterns.map((pattern) => (
              <div
                key={pattern.title}
                className="landing-feature-card border border-landing-line bg-landing p-8"
              >
                <h3 className="text-base font-semibold text-landing-ink">{pattern.title}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{pattern.description}</p>
                <p className="mt-4 border-t border-landing-line pt-4 text-xs leading-5 text-landing-muted">
                  <span className="font-semibold text-landing-ink">What to watch for: </span>
                  {pattern.watchFor}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">Two different angles on this problem</h2>
          <p className="mt-4 text-sm leading-7 text-landing-muted">
            AI impersonation touches two different groups, and the practical response differs
            depending on which one applies to your situation.
          </p>
          <div className="mt-10 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2">
            <div className="landing-feature-card bg-landing p-8">
              <h3 className="text-sm font-semibold text-landing-ink">
                If you're the person being impersonated
              </h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                The priority is detection, evidence and takedown, plus, where the impersonation
                targets your public image specifically, reducing how usable your existing public
                images are as source material going forward. See{" "}
                <Link
                  to="/newsroom/someone-made-a-deepfake-of-me"
                  className="landing-link text-landing-ink"
                >
                  Someone Made a Deepfake of Me
                </Link>{" "}
                for the step-by-step response, and{" "}
                <Link to="/image-immunization" className="landing-link text-landing-ink">
                  Image Immunization
                </Link>{" "}
                for the preventative side.
              </p>
            </div>
            <div className="landing-feature-card bg-landing p-8">
              <h3 className="text-sm font-semibold text-landing-ink">
                If you might be the target of the scam
              </h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                The priority is verification before acting: confirming a request, endorsement or
                announcement through a separate, known channel, a direct call to a known number, an
                official company page, rather than trusting the video, audio or message in front of
                you at face value, especially when it involves money, credentials or urgency.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">Frequently asked questions</h2>
          <Accordion type="single" collapsible className="mt-8">
            <AccordionItem value="how-convincing">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                How convincing can AI impersonation actually get?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                It varies significantly by technique, source material and effort involved. Some
                content is easy to spot on close inspection; other content is not. Rather than
                relying on being able to visually or audibly detect a fake, verifying through a
                separate known channel is the more reliable approach when something matters.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="companies-do">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                What can a company do about executive impersonation risk?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                Establishing a clear, known verification process for high-stakes requests, payment
                changes, credential resets, urgent approvals, so employees have a defined second
                channel to confirm through, is a practical, general step. Specific security
                procedures should be developed with your organization's own security and legal
                teams.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="report-scam">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                What should I do if I see a celebrity endorsement scam?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                Report it through the platform's tools rather than engaging with it, and avoid
                interacting with links or contact details in the content itself. If it impersonates
                someone you represent professionally, preserve evidence and follow the response
                steps in{" "}
                <Link
                  to="/newsroom/someone-made-a-deepfake-of-me"
                  className="landing-link text-landing-ink"
                >
                  Someone Made a Deepfake of Me
                </Link>
                .
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="landing-kicker">Dealing with an active impersonation issue</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            Reach out to discuss a specific impersonation incident or ask about protection.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/contact">Contact Eterna</Link>
          </Button>

          <div className="mt-12 border-t border-landing-line pt-8 text-left">
            <h2 className="text-xs font-semibold uppercase text-landing-ink">Related reading</h2>
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <li>
                <Link
                  to="/newsroom/someone-made-a-deepfake-of-me"
                  className="landing-link text-landing-ink"
                >
                  Someone Made a Deepfake of Me?
                </Link>
              </li>
              <li>
                <Link to="/deepfake-protection" className="landing-link text-landing-ink">
                  Deepfake Protection
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/executive-first-hour-playbook"
                  className="landing-link text-landing-ink"
                >
                  Executive First-Hour Response Playbook
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
                <Link to="/online-reputation-protection" className="landing-link text-landing-ink">
                  Online Reputation Protection
                </Link>
              </li>
              <li>
                <Link to="/image-immunization" className="landing-link text-landing-ink">
                  Eterna Image Immunization
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
