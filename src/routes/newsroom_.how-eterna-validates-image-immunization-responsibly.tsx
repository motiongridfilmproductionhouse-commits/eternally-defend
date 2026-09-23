import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL =
  "https://protectbyeterna.com/newsroom/how-eterna-validates-image-immunization-responsibly";

export const Route = createFileRoute(
  "/newsroom_/how-eterna-validates-image-immunization-responsibly",
)({
  head: () => ({
    meta: [
      { title: "How Eterna Validates Image Immunization Responsibly — Eterna Sentinel" },
      {
        name: "description",
        content:
          "How Eterna validates Image Immunization responsibly, including what's still in progress.",
      },
      {
        property: "og:title",
        content: "How Eterna Validates Image Immunization Responsibly — Eterna Sentinel",
      },
      {
        property: "og:description",
        content:
          "How Eterna validates Image Immunization responsibly, including what's still in progress.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: ResponsibleValidationPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How Eterna Validates Image Immunization Responsibly",
    author: { "@type": "Organization", name: "Eterna Sentinel" },
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    mainEntityOfPage: CANONICAL,
  });
}

function ResponsibleValidationPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Responsible validation"
      title="How Eterna Validates Image Immunization Responsibly"
      intro="EIP, Eterna's proprietary pre-publication image protection technology, is developed through Eterna's internal research and development and currently under validation, designed to help reduce the risk of deepfake creation, AI identity replication and unauthorized likeness reuse. Eterna is publishing this article alongside that introduction because a protection claim without an honest account of its limits isn't a protection claim worth trusting."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>This is where that account lives.</p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Controlled evaluation</h2>
          <p>
            Eterna's internal research and development evaluates EIP under controlled conditions,
            comparing protected and unprotected versions of the same image against a defined set of
            tests before any claim is made publicly. The specific test design, models and datasets
            used internally remain confidential; what matters publicly is that the evaluation is
            structured and repeatable, not anecdotal.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Different AI systems behave differently
          </h2>
          <p>
            EIP is evaluated against more than one kind of AI system, because a result on one system
            doesn't automatically transfer to another. Internal evaluation has found that effects
            are not uniform: some systems respond more consistently than others, and that variation
            is expected to continue as new systems are released. Eterna does not describe EIP as
            working against every AI model, because that hasn't been shown and may never be shown.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Transformation testing</h2>
          <p>
            Images rarely stay exactly as they were first protected: they get cropped, recompressed,
            resized or otherwise altered as they move across platforms. Eterna's internal testing
            includes evaluating how well EIP's effect holds up under these common transformations.
            Some transformations can weaken the protective effect; that's tracked internally as part
            of ongoing validation, not hidden from it.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Quality review</h2>
          <p>
            Before any version of EIP is considered for release, Eterna reviews protected images for
            visible quality, confirming the design goal of preserving natural, human-visible
            appearance is actually being met, not just assumed.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Ongoing validation</h2>
          <p>
            Validation isn't a single event; it continues as EIP evolves and as the AI systems it's
            evaluated against change. Eterna's roadmap includes moving toward independent, outside
            validation, and this article will be updated as that progresses.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Limitations</h2>
          <p>
            Stated plainly: EIP is not effective against every AI system, transformation, or every
            future model. Protecting one image does not extend that protection to other images of
            the same person. These are limitations Eterna is tracking and working against, not
            claims Eterna is prepared to make go away with marketing language.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why Eterna does not make universal claims
          </h2>
          <p>
            A claim like "works against every AI model" or "permanent protection" would be easier to
            write and harder to stand behind. Eterna's existing verification standard, published on
            the{" "}
            <Link to="/methodology" className="landing-link text-landing-ink">
              Methodology
            </Link>{" "}
            page, exists specifically to avoid that gap between what's claimed and what's actually
            been shown. EIP is held to the same standard: currently undergoing continued validation,
            with effectiveness that may vary across systems, transformations and use cases.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What Eterna will publish as validation progresses
          </h2>
          <p>
            Eterna will update this article and the{" "}
            <Link to="/image-immunization" className="landing-link text-landing-ink">
              Image Immunization
            </Link>{" "}
            page as validation milestones are reached, including when independent, outside
            validation is complete. Confidential test results, internal methodology, model names,
            thresholds and datasets used in development are not published, to avoid providing a
            roadmap for circumventing the protection itself.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Related reading</h2>
            <ul className="mt-4 space-y-2 text-xs">
              <li>
                <Link
                  to="/newsroom/inside-eterna-image-immunization"
                  className="landing-link text-landing-ink"
                >
                  Inside Eterna Image Immunization — the technical view
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
                <Link to="/research" className="landing-link text-landing-ink">
                  Eterna Research
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
