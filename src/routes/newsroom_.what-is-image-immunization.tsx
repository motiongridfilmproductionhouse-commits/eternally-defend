import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom/what-is-image-immunization";

export const Route = createFileRoute("/newsroom_/what-is-image-immunization")({
  head: () => ({
    meta: [
      { title: "What Is Image Immunization? — Eterna Sentinel" },
      {
        name: "description",
        content:
          "A plain-language introduction to what Image Immunization is and how it's designed to work.",
      },
      { property: "og:title", content: "What Is Image Immunization? — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "A plain-language introduction to what Image Immunization is and how it's designed to work.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: EducationalPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "What Is Image Immunization?",
    author: { "@type": "Organization", name: "Eterna Sentinel" },
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    mainEntityOfPage: CANONICAL,
  });
}

function EducationalPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title="What Is Image Immunization?"
      intro="Written for public figures, creators, executives, students, families and organizations, in plain language."
      image={{
        src: "/images/newsroom/image-immunization-audiences.png",
        alt: "A photographer and a group of people, representing who Image Immunization is designed for",
      }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Most photos travel further than the person in them expects. Once an image is posted, it
            can be copied, and today it can also be fed into AI tools that learn to recreate or
            reuse the way someone looks. Eterna Image Immunization (EIP) is Eterna's proprietary
            pre-publication image protection technology, developed through Eterna's internal
            research and development and currently under validation, designed to help reduce the
            risk of deepfake creation, AI identity replication and unauthorized likeness reuse by
            preparing an image before it's published.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">The simple version</h2>
          <p>
            Normal image → publication → possible AI reuse. That's the path most photos take today:
            a photo is taken, it's shared or published, and from that point on it can potentially be
            picked up and reused by AI systems without the person's knowledge.
          </p>
          <p>
            EIP's approach: authorized image → pre-publication protection → publication. EIP is
            applied before the image goes out, at the point its owner authorizes it for use, so the
            protection is already in place by the time anyone else sees it.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">A simple analogy</h2>
          <p>
            Think of it like a watermark, but invisible and aimed at machines instead of people. A
            visible watermark tells a person where an image came from without changing what they see
            in it. EIP is designed to work the same way for AI systems: the image looks completely
            normal to a person, while becoming harder for common AI systems to reuse or identify
            from.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Who this is for</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Public figures, whose images circulate widely and can be targeted for impersonation.
            </li>
            <li>
              Executives and founders, whose photos appear in press, investor and company materials.
            </li>
            <li>Creators, who share images across platforms with limited control over reuse.</li>
            <li>Students and families, for everyday photos, not just high-profile cases.</li>
            <li>
              Organizations, protecting images of the students, staff or members they represent.
            </li>
          </ul>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What this isn't</h2>
          <p>
            EIP isn't a guarantee that an image can never be misused, and it isn't a replacement for
            Eterna's existing detection and response services. It's designed to be an additional
            layer, applied earlier, alongside the protection Eterna already provides.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Where this is going</h2>
          <p>
            EIP is currently undergoing continued validation. Protection effectiveness may vary
            across systems, transformations and use cases. For the full account of how that
            validation works, see{" "}
            <Link
              to="/newsroom/how-eterna-validates-image-immunization-responsibly"
              className="landing-link text-landing-ink"
            >
              How Eterna Validates Image Immunization Responsibly
            </Link>
            . For the complete Image Immunization overview, see the{" "}
            <Link to="/image-immunization" className="landing-link text-landing-ink">
              Image Immunization
            </Link>{" "}
            page.
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
                  to="/newsroom/eterna-introduces-image-immunization"
                  className="landing-link text-landing-ink"
                >
                  Eterna Introduces Image Immunization — the announcement
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
