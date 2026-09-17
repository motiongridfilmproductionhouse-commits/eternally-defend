import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom/inside-eterna-image-immunization";

export const Route = createFileRoute("/newsroom_/inside-eterna-image-immunization")({
  head: () => ({
    meta: [
      { title: "Inside Eterna Image Immunization — Eterna Sentinel" },
      {
        name: "description",
        content:
          "A technically grounded, public-safe look at how Image Immunization approaches pre-publication protection.",
      },
      { property: "og:title", content: "Inside Eterna Image Immunization — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "A technically grounded, public-safe look at how Image Immunization approaches pre-publication protection.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: TechnicalBlogPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline:
      "Inside Eterna Image Immunization: How Image Privacy Can Be Designed Before Misuse Happens",
    author: { "@type": "Organization", name: "Eterna Sentinel" },
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    mainEntityOfPage: CANONICAL,
  });
}

function TechnicalBlogPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Technical"
      title="Inside Eterna Image Immunization: How Image Privacy Can Be Designed Before Misuse Happens"
      intro="EIP, Eterna's proprietary pre-publication image protection technology, is developed through Eterna's internal research and development and currently under validation, designed to help reduce the risk of deepfake creation, AI identity replication and unauthorized likeness reuse."
      image={{
        src: "/images/newsroom/image-immunization-identity-signal.png",
        alt: "A duplicated ID-style portrait with a network visualization, representing Eterna Image Immunization",
      }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Most of what's written about deepfake defense focuses on catching misuse after it
            happens; this is about the earlier question, what makes an ordinary photograph usable as
            raw material for AI identity replication in the first place, and what it means to design
            against that before an image is ever published.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why an ordinary photograph is a machine-readable identity source
          </h2>
          <p>
            To a person, a photo is a picture. To a modern image or generative model, it's also a
            set of extractable signals: facial geometry, distinguishing features, and patterns a
            model can learn to recognize or reproduce. Publishing an image publicly doesn't just
            share how someone looks with other people; it can also hand that same information to
            systems designed to learn from it. That gap, between what an image communicates to a
            person and what it exposes to a machine, is the starting point for Image Immunization.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Human-visible appearance versus machine identity utility
          </h2>
          <p>
            These are two different properties of the same image, and they don't have to move
            together. Human-visible appearance is what a person sees when they look at the photo.
            Machine identity utility is how usable that image is as a source for a system trying to
            extract or reproduce an identity from it. EIP is designed to work on the second property
            while leaving the first alone, so the image still looks like an ordinary photograph to
            anyone who sees it.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Pre-publication protection
          </h2>
          <p>
            EIP is applied before an image is published or distributed, at the point its owner
            authorizes it for use. That timing is deliberate: protection applied after an image is
            already circulating has to work against every copy, repost and derivative that followed
            it. Protection applied at the source only has to be present once, at the point of
            publication.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why proactive protection complements detection and enforcement
          </h2>
          <p>
            EIP does not replace Eterna's detection, monitoring and response services, and it isn't
            designed to. Detection and enforcement remain necessary for anything that happens after
            an image is already public: misuse of images that predate protection, content shared
            outside Eterna's reach, and cases that need evidence, platform reporting and human
            judgment. EIP is an earlier layer aimed at reducing how much of that work is needed in
            the first place, not a substitute for it.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why no single protective layer should be treated as universal
          </h2>
          <p>
            No image protection technique, including EIP, should be described as working against
            every AI system, every transformation, or every future model. Systems evolve, and an
            image can be copied, cropped, recompressed or otherwise altered in ways that affect any
            protective technique differently. EIP is currently undergoing continued validation, and
            protection effectiveness may vary across systems, transformations and use cases. That's
            a design constraint worth being honest about, not a footnote to bury. See{" "}
            <Link
              to="/newsroom/how-eterna-validates-image-immunization-responsibly"
              className="landing-link text-landing-ink"
            >
              How Eterna Validates Image Immunization Responsibly
            </Link>{" "}
            for the full account.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Frequently asked questions
          </h2>
          <p>
            <strong className="text-landing-ink">Is Image Immunization available today?</strong>{" "}
            Launch timing and access details will be announced separately.
          </p>
          <p>
            <strong className="text-landing-ink">
              Does it guarantee an image can't be misused?
            </strong>{" "}
            No. No protective layer can guarantee that, and EIP does not claim to.
          </p>
          <p>
            <strong className="text-landing-ink">Will it change how my photo looks?</strong> No. EIP
            is designed to preserve the image's natural, human-visible appearance.
          </p>
          <p>
            <strong className="text-landing-ink">
              Does this replace Eterna's detection and response services?
            </strong>{" "}
            No. It's an additional layer, applied before publication, alongside them.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Related reading</h2>
            <ul className="mt-4 space-y-2 text-xs">
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
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Methodology
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
