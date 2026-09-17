import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom/detection-is-not-prevention";

export const Route = createFileRoute("/newsroom_/detection-is-not-prevention")({
  head: () => ({
    meta: [
      { title: "Detection Is Not Prevention — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Monitoring and takedown work after an image has already been misused. Why prevention has to start earlier, and how detection and prevention fit together.",
      },
      { property: "og:title", content: "Detection Is Not Prevention — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Monitoring and takedown work after an image has already been misused. Why prevention has to start earlier, and how detection and prevention fit together.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: DetectionIsNotPreventionPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Detection Is Not Prevention",
    author: { "@type": "Organization", name: "Eterna Sentinel" },
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    mainEntityOfPage: CANONICAL,
  });
}

function DetectionIsNotPreventionPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title="Detection Is Not Prevention."
      intro="Most digital-identity protection, Eterna's included, has historically worked the same way: something is published, then it's found. That order matters more than it usually gets credit for."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            "Protection" is used to describe a lot of different things: monitoring tools, takedown
            services, watermarking, legal response. Many of them are useful. Few of them operate at
            the same point in time. That distinction, when protection actually happens relative to
            when an image is published, is one of the more consequential and least discussed parts
            of digital-identity protection.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What detection actually does
          </h2>
          <p>
            Detection and monitoring find things that have already happened: an impersonating
            account, a manipulated image, a synthetic-media clip circulating without authorization.
            Done well, detection is genuinely valuable. It surfaces signals a person would likely
            never find on their own, it preserves evidence before it disappears, and it gives a
            response team a documented starting point instead of a rumor. Eterna's own
            detect-verify-preserve-respond-monitor workflow exists because this stage matters.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What detection can't do</h2>
          <p>
            Detection cannot undo exposure. By the time a monitoring system flags a misused image,
            that image has typically already been seen, copied, or in the case of AI systems,
            potentially processed. Removal and enforcement can reduce ongoing harm and address a
            specific instance, but they don't reach copies that were already made before the finding
            occurred. Detection, by definition, operates after the fact. That isn't a flaw in
            detection tools; it's a structural limit of working only at that stage.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why prevention has to start earlier
          </h2>
          <p>
            If the goal is to reduce how often that after-the-fact response is even needed, the
            intervention has to move earlier, to before an image is published or distributed, not
            after. That's the premise behind Eterna Image Immunization (EIP): Eterna's proprietary
            pre-publication image protection technology, developed through Eterna's internal
            research and development and currently under validation. EIP is designed to help reduce
            the risk of deepfake creation, AI identity replication and unauthorized likeness reuse,
            while preserving the image's natural, human-visible appearance. It targets the same
            underlying problem detection responds to, at an earlier point in the image's lifecycle.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Eterna's approach: both, not either
          </h2>
          <p>
            Prevention doesn't replace detection, and detection doesn't replace prevention. An image
            prepared with EIP before publication can still be monitored afterward; a protection
            program built only on monitoring is, by construction, always one step behind. Eterna
            operates both: an evidence-led detection and response workflow for what's already
            public, and EIP as an additional, earlier layer for images not yet published. Neither is
            presented as sufficient on its own.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What this isn't</h2>
          <p>
            This isn't a claim that prevention makes detection unnecessary, or that EIP guarantees
            an image can never be misused. No protective layer, preventive or reactive, can make
            that guarantee, and Eterna does not make it. EIP is designed to reduce risk and is still
            undergoing validation; detection and response remain part of Eterna's protection model
            for exactly the cases prevention can't reach; images already public, or published before
            protection was in place.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Related reading</h2>
            <ul className="mt-4 space-y-2 text-xs">
              <li>
                <Link to="/image-immunization" className="landing-link text-landing-ink">
                  Image Immunization — the complete overview
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/what-is-image-immunization"
                  className="landing-link text-landing-ink"
                >
                  What Is Image Immunization?
                </Link>
              </li>
              <li>
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Eterna's verification methodology
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

          <div className="flex flex-wrap gap-3 border-t border-landing-line pt-8">
            <Link
              to="/newsroom"
              className="landing-link inline-flex items-center gap-1 text-landing-ink"
            >
              Back to Newsroom <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
