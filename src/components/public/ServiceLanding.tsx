import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { EnquiryButton } from "@/components/public/enquiry/enquiry-modal-context";

export const SITE = "https://protectbyeterna.com";

type To = ComponentProps<typeof Link>["to"];

export type ServiceSection = { kicker: string; heading: string; body: string[] };
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
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    serviceType: opts.serviceType,
    description: opts.description,
    provider: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      url: `${SITE}/`,
    },
    areaServed: "Worldwide",
    url: `${SITE}${opts.path}`,
  });
}

export function webPageSchema(opts: { path: string; name: string; description: string }) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: opts.name,
    description: opts.description,
    url: `${SITE}${opts.path}`,
    isPartOf: { "@type": "WebSite", name: "Eterna Sentinel", url: `${SITE}/` },
    publisher: { "@type": "Organization", name: "Eterna Sentinel", url: `${SITE}/` },
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
            </div>
          </div>
        </section>
      ))}

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
