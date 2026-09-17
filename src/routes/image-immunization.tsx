import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/image-immunization";

export const Route = createFileRoute("/image-immunization")({
  head: () => ({
    meta: [
      { title: "Eterna Image Immunization: Protect the Image Before Misuse Begins" },
      {
        name: "description",
        content:
          "Eterna Image Immunization (EIP), Eterna's proprietary pre-publication image protection technology. Developed through internal R&D, currently under validation.",
      },
      {
        property: "og:title",
        content: "Eterna Image Immunization: Protect the Image Before Misuse Begins",
      },
      {
        property: "og:description",
        content:
          "Eterna Image Immunization (EIP), Eterna's proprietary pre-publication image protection technology. Developed through internal R&D, currently under validation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: ImageImmunizationPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Eterna Image Immunization",
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    mainEntityOfPage: CANONICAL,
  });
}

function ImageImmunizationPage() {
  return (
    <PublicPage
      eyebrow="Eterna Image Immunization"
      title="Protect the Image Before Misuse Begins."
      intro="EIP, Eterna Image Immunization, is Eterna's proprietary pre-publication image protection technology: developed through Eterna's internal research and development, and currently under validation. EIP is designed to help reduce the risk of deepfake creation, AI identity replication and unauthorized likeness reuse, while preserving the image's natural appearance for people."
      image={{
        src: "/images/newsroom/image-immunization-hero.png",
        alt: "A glass-pane before-and-after portrait representing Eterna Image Immunization",
      }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <Button asChild size="lg">
            <Link to="/contact">Request EIP protection</Link>
          </Button>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-6 px-6 text-sm leading-7 text-landing-muted">
          <h2 className="landing-kicker">The AI identity problem</h2>
          <p>
            A single publicly available photo can be enough for common AI systems to reproduce or
            extend a person's likeness, often without their knowledge. As image-generation and
            identity-replication tools become more accessible, an ordinary photo can quietly become
            a source for something its owner never authorized.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-6 px-6 text-sm leading-7 text-landing-muted">
          <h2 className="landing-kicker">Why protection normally begins too late</h2>
          <p>
            Most protection today starts after an image has already been misused: once a deepfake
            exists, a likeness has been reused, or an impersonation has spread. EIP is built for the
            earlier moment, before an image is published or distributed at all.
          </p>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-6 px-6 text-sm leading-7 text-landing-muted">
          <h2 className="landing-kicker">What EIP is</h2>
          <p>
            EIP is Eterna's proprietary technology for preparing an authorized image before it goes
            out into the world. It's designed to reduce how useful that image is as a source for AI
            identity replication, without changing how the image looks to the people who see it.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="border-t border-landing-line pt-10">
            <h2 className="landing-kicker">Protecting the source image</h2>
            <p className="mt-4 text-sm leading-7 text-landing-muted">
              EIP is applied at the source, before an image is published or distributed, rather than
              after it has already been copied, reused or altered elsewhere. Protecting at the
              source is the design principle behind EIP: address an image's exposure before misuse
              has a chance to begin.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <div className="aspect-video w-full overflow-hidden border border-landing-line bg-landing-soft">
              <img
                src="/images/newsroom/image-immunization-the-problem.png"
                alt="A face dissolving into a particle network, representing why Image Immunization exists"
                width={1344}
                height={752}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <h2 className="landing-kicker">Human-visible appearance and machine identity use</h2>
              <p className="mt-4 text-sm leading-7 text-landing-muted">
                EIP is designed to preserve an image's natural, human-visible appearance while
                reducing its usefulness as a reusable machine identity source. The person in the
                photo looks the same to anyone who sees it; the design goal is to make that same
                image less useful to systems attempting to extract or reuse an identity from it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">Who EIP is designed for</h2>
          <p className="mt-4 text-sm leading-7 text-landing-muted">
            EIP is designed for anyone who shares images that could be reused without their consent:
            people with a public profile, and the organizations responsible for the images of the
            people they represent.
          </p>

          <div className="mt-10 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2">
            <div className="landing-feature-card bg-landing p-8">
              <h3 className="text-sm font-semibold text-landing-ink">Public figures</h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                A public role brings a wider surface for impersonation and reputational harm. EIP is
                designed to give public figures a way to prepare an image before it's shared
                publicly.
              </p>
            </div>
            <div className="landing-feature-card bg-landing p-8">
              <h3 className="text-sm font-semibold text-landing-ink">Executives and founders</h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Executive and founder images circulate widely, in press coverage, investor materials
                and company channels. EIP is designed to protect those images at the point they're
                prepared for release.
              </p>
            </div>
            <div className="landing-feature-card bg-landing p-8">
              <h3 className="text-sm font-semibold text-landing-ink">Creators</h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Creators share images constantly, often across platforms with limited control over
                how they're reused. EIP is designed to let creators authorize an image for its
                intended use while reducing its value as raw material for unauthorized AI reuse.
              </p>
            </div>
            <div className="landing-feature-card bg-landing p-8">
              <h3 className="text-sm font-semibold text-landing-ink">Students and families</h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Image sharing has become part of everyday life for students and families, often
                faster than most people think about what happens to an image afterward. EIP is
                designed for that everyday case, not only high-profile incidents.
              </p>
            </div>
            <div className="landing-feature-card bg-landing p-8 sm:col-span-2">
              <h3 className="text-sm font-semibold text-landing-ink">Organizations</h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Colleges, companies and organizations that publish images of the people they
                represent, students, staff, members, carry a responsibility for those images. EIP is
                designed to be applied at the point those images are prepared for publication.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16 md:[direction:rtl]">
            <div className="aspect-video w-full overflow-hidden border border-landing-line bg-landing-soft md:[direction:ltr]">
              <img
                src="/images/newsroom/image-immunization-identity-signal.png"
                alt="A duplicated ID-style portrait with a network visualization, representing how EIP fits Eterna's existing model"
                width={1344}
                height={752}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="md:[direction:ltr]">
              <h2 className="landing-kicker">How EIP fits into Eterna protection</h2>
              <p className="mt-4 text-sm leading-7 text-landing-muted">
                EIP is an additional layer of digital identity defense, applied before an image is
                published. It works alongside Eterna's{" "}
                <Link to="/security" className="landing-link text-landing-ink">
                  detection, monitoring and response services
                </Link>
                , which continue to operate for anything that reaches the public after publication.
                For the standard Eterna applies to a confirmed incident, see{" "}
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Methodology
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">Responsible protection</h2>
          <p className="mt-4 text-sm leading-7 text-landing-muted">
            Eterna develops EIP the same way it operates every part of its platform: with a
            documented process and a clear account of what's proven and what's still in progress.
            EIP is currently undergoing continued validation. Protection effectiveness may vary
            across systems, transformations and use cases.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">Frequently asked questions</h2>
          <Accordion type="single" collapsible className="mt-8">
            <AccordionItem value="protects-against">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                What does EIP protect against?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                EIP is designed to reduce the risk of deepfake creation, AI identity replication and
                unauthorized likeness reuse from an authorized image.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="changes-appearance">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                Does EIP change how my photo looks?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                No. EIP is designed to preserve the image's natural, human-visible appearance.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="guaranteed">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                Is EIP guaranteed to stop misuse?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                No. EIP is currently under validation, and protection effectiveness may vary across
                systems, transformations and use cases.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="replaces-response">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                Does EIP replace Eterna's detection and response services?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                No. EIP is an additional layer, applied before publication, alongside Eterna's
                existing services.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="landing-kicker">Request EIP protection</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            Reach out to request EIP protection for an authorized image.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/contact">Request EIP protection</Link>
          </Button>

          <div className="mt-12 border-t border-landing-line pt-8 text-left">
            <h2 className="text-xs font-semibold uppercase text-landing-ink">Related reading</h2>
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <li>
                <Link
                  to="/newsroom/eterna-introduces-image-immunization"
                  className="landing-link text-landing-ink"
                >
                  Eterna Introduces Image Immunization
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
                <Link
                  to="/newsroom/inside-eterna-image-immunization"
                  className="landing-link text-landing-ink"
                >
                  Inside Eterna Image Immunization
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
            </ul>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
