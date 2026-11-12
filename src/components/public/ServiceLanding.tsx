import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { DEFAULT_OG_IMAGE } from "@/lib/seo/og-image";
import { PUBLISHER, serviceNode } from "@/lib/seo/structured-data";
import { EnquiryButton } from "@/components/public/enquiry/enquiry-modal-context";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const SITE = "https://protectbyeterna.com";

type To = ComponentProps<typeof Link>["to"];

export type ServiceSection = {
  kicker: string;
  heading: string;
  body: string[];
  /** Optional bullet list shown after the paragraphs. */
  bullets?: string[];
  /** Optional contextual links (e.g. newsroom guides) shown after the body. */
  links?: { label: string; to: To }[];
};
export type ServiceFaq = { q: string; a: string };

export function faqPageSchema(faqs: ServiceFaq[]) {
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

/** FAQ accordion + FAQPage JSON-LD, styled like the other public pages. */
export function ServiceFaqSection({ heading, faqs }: { heading: string; faqs: ServiceFaq[] }) {
  return (
    <section className="border-t border-landing-line py-20 md:py-24">
      <div className="mx-auto max-w-3xl px-6">
        <p className="landing-kicker">Frequently asked questions</p>
        <h2 className="mt-4 text-3xl font-medium md:text-4xl">{heading}</h2>
        <Accordion type="multiple" className="mt-8">
          {faqs.map(({ q, a }) => (
            <AccordionItem key={q} value={q}>
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                {q}
              </AccordionTrigger>
              <AccordionContent forceMount className="text-sm leading-6 text-landing-muted data-[state=closed]:hidden">
                {a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqPageSchema(faqs) }} />
    </section>
  );
}

/** Alternating two-column content sections used on service pages. */
export function ServiceSectionList({ sections }: { sections: ServiceSection[] }) {
  return (
    <>
      {sections.map((s, i) => (
        <section
          key={s.heading}
          className={`border-t border-landing-line py-20 md:py-24 ${i % 2 ? "bg-landing-soft" : ""}`}
        >
          <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
            <div>
              <p className="landing-kicker">{s.kicker}</p>
              <h2 className="mt-4 text-3xl font-medium md:text-4xl">{s.heading}</h2>
            </div>
            <div className="space-y-5 text-sm leading-7 text-landing-muted">
              {s.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {s.bullets?.length ? (
                <ul className="list-disc space-y-2 pl-5">
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              {s.links?.length ? (
                <p className="flex flex-wrap gap-x-6 gap-y-2">
                  {s.links.map((l) => (
                    <Link key={l.label} to={l.to} className="landing-link font-semibold text-landing-ink">
                      {l.label}
                    </Link>
                  ))}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ))}

    </>
  );
}

/** Links to existing newsroom guides plus the request page. */
export function ServiceGuidesSection({ guides }: { guides: RelatedLink[] }) {
  return (
    <section className="border-t border-landing-line py-16">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-xl font-medium">Related guides</h2>
        <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          {guides.map((g) => (
            <li key={g.label}>
              <Link to={g.to} className="landing-link">
                {g.label}
              </Link>
            </li>
          ))}
          <li>
            <Link to="/request-protection" className="landing-link font-semibold text-landing-ink">
              Request digital identity protection
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
export type ServiceCard = { title: string; body: string };
export type RelatedLink = { label: string; to: To };

/** Standard head() block for public SEO landing pages. */
export function landingHead(opts: { path: string; title: string; description: string }) {
  const url = `${SITE}${opts.path}`;
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:url", content: url },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: opts.title },
      { name: "twitter:description", content: opts.description },
      ...(DEFAULT_OG_IMAGE.ENABLED
        ? [
            { property: "og:image", content: DEFAULT_OG_IMAGE.url },
            { name: "twitter:image", content: DEFAULT_OG_IMAGE.url },
          ]
        : []),
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

export function serviceSchema(opts: {
  path: string;
  name: string;
  serviceType: string;
  description: string;
}) {
  return JSON.stringify(
    serviceNode({ ...opts, url: `${SITE}${opts.path}` }),
  );
}

export function webPageSchema(opts: { path: string; name: string; description: string }) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: opts.name,
    description: opts.description,
    url: `${SITE}${opts.path}`,
    isPartOf: { "@type": "WebSite", name: "Eterna Sentinel", url: `${SITE}/` },
    publisher: PUBLISHER,
  });
}

export function ServiceLanding({
  eyebrow,
  title,
  intro,
  section,
  sourcePage,
  schema,
  sections,
  cards,
  cardsHeading,
  related,
  faqs,
  faqHeading,
  guides,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  /** Breadcrumb parent label, e.g. "Solutions" or "Platform". */
  section: string;
  sourcePage: string;
  schema: string;
  sections: ServiceSection[];
  cards?: ServiceCard[];
  cardsHeading?: string;
  related: RelatedLink[];
  faqs?: ServiceFaq[];
  faqHeading?: string;
  guides?: RelatedLink[];
  children?: ReactNode;
}) {
  return (
    <PublicPage
      eyebrow={eyebrow}
      title={title}
      intro={intro}
      breadcrumb={[{ label: "Home", to: "/" }, { label: section }, { label: eyebrow }]}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />

      <section className="py-14 md:py-16">
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-3 px-6">
          <EnquiryButton
            size="lg"
            prefill={{ sourcePage, sourceCta: "Request Protection", department: "protection" }}
          >
            Request Digital Identity Protection <ArrowRight />
          </EnquiryButton>
        </div>
      </section>

      <ServiceSectionList sections={sections} />

      {cards && cards.length > 0 ? (
        <section className="border-t border-landing-line py-20 md:py-24">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="max-w-3xl text-3xl font-medium md:text-4xl">{cardsHeading}</h2>
            <div className="mt-12 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => (
                <article key={c.title} className="min-h-40 bg-landing p-7">
                  <h3 className="text-sm font-semibold">{c.title}</h3>
                  <p className="mt-3 text-xs leading-5 text-landing-muted">{c.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {children}

      {faqs?.length ? <ServiceFaqSection heading={faqHeading ?? "Common questions"} faqs={faqs} /> : null}

      {guides?.length ? <ServiceGuidesSection guides={guides} /> : null}

      <section className="border-t border-landing-line bg-landing-soft py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-xl font-medium">Related Eterna Sentinel services</h2>
          <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {related.map((r) => (
              <li key={r.label}>
                <Link to={r.to} className="landing-link">
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </PublicPage>
  );
}
