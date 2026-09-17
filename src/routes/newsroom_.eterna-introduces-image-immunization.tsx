import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom/eterna-introduces-image-immunization";

export const Route = createFileRoute("/newsroom_/eterna-introduces-image-immunization")({
  head: () => ({
    meta: [
      { title: "Eterna Introduces Image Immunization — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Eterna Sentinel introduces Image Immunization, a proprietary pre-publication image protection technology.",
      },
      { property: "og:title", content: "Eterna Introduces Image Immunization — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Eterna Sentinel introduces Image Immunization, a proprietary pre-publication image protection technology.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: AnnouncementPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Eterna Introduces Image Immunization for a New Era of Digital Identity Protection",
    author: { "@type": "Organization", name: "Eterna Sentinel" },
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    mainEntityOfPage: CANONICAL,
  });
}

function AnnouncementPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Company announcement"
      title="Eterna Introduces Image Immunization for a New Era of Digital Identity Protection"
      intro="EIP, Eterna Image Immunization, is a proprietary pre-publication image protection technology developed through Eterna's internal research and development and currently under validation."
      image={{
        src: "/images/newsroom/image-immunization-hero.png",
        alt: "A glass-pane before-and-after portrait representing Eterna Image Immunization",
      }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Eterna Sentinel today introduced Eterna Image Immunization (EIP), a proprietary
            pre-publication image protection technology developed through Eterna's internal research
            and development and currently under validation. EIP is designed to help reduce the risk
            of deepfake creation, AI identity replication and unauthorized likeness reuse,
            protecting an authorized image at the source, before it is published or distributed.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            The problem: AI identity misuse starts with an ordinary photo
          </h2>
          <p>
            A single publicly available photo can be enough for common AI systems to reproduce or
            extend a person's likeness, often without their knowledge or consent. As
            image-generation and identity-replication tools become more accessible, that exposure
            grows for anyone who shares images online.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why reactive protection alone isn't enough
          </h2>
          <p>
            Eterna's existing detection, monitoring and response services find and act on misuse
            after it happens: a deepfake is identified, an impersonation is reported, evidence is
            preserved, and a response is coordinated. That work remains essential. EIP addresses the
            stage before it, the moment an image is prepared for publication.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What EIP does</h2>
          <p>
            EIP is applied to an authorized image before it's published or distributed. It's
            designed to preserve the image's natural, human-visible appearance while reducing its
            usefulness as a source for AI identity replication, protecting at the source rather than
            responding after the fact. Learn more on the{" "}
            <Link to="/image-immunization" className="landing-link text-landing-ink">
              Image Immunization
            </Link>{" "}
            page.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            A new preventive layer in Eterna's protection system
          </h2>
          <p>
            EIP does not replace Eterna's detection and response services. It adds an earlier layer,
            protection applied before publication, working alongside the monitoring and enforcement
            Eterna already provides after content reaches the public.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Who EIP is for</h2>
          <p>
            EIP is designed for public figures, executives and founders, creators, students and
            families, and the organizations responsible for the images of the people they represent.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Responsible validation</h2>
          <p>
            EIP is currently undergoing continued validation. Protection effectiveness may vary
            across systems, transformations and use cases. See{" "}
            <Link
              to="/newsroom/how-eterna-validates-image-immunization-responsibly"
              className="landing-link text-landing-ink"
            >
              How Eterna Validates Image Immunization Responsibly
            </Link>{" "}
            for the full account.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">About Eterna Sentinel</h2>
          <p>
            Eterna Sentinel provides digital identity protection, reputation monitoring, and
            evidence-led response for people and organizations in the public eye. Learn more at{" "}
            <Link to="/image-immunization" className="landing-link text-landing-ink">
              protectbyeterna.com/image-immunization
            </Link>
            .
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Related reading</h2>
            <ul className="mt-4 space-y-2 text-xs">
              <li>
                <Link
                  to="/newsroom/what-is-image-immunization"
                  className="landing-link text-landing-ink"
                >
                  What Is Image Immunization? — a plain-language introduction
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/inside-eterna-image-immunization"
                  className="landing-link text-landing-ink"
                >
                  Inside Eterna Image Immunization — the technical view
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
