import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleCta } from "@/components/public/ArticleCta";
import { articleCommon, type ArticleAuthor } from "@/lib/seo/structured-data";

/**
 * Data-driven Newsroom article template (same markup as the hand-written guides).
 * Paragraph text supports inline links written as [label](/path) or [label](https://...).
 */
export type ArticleBlock =
  | { h2: string }
  | { p: string }
  | { steps: string[] }
  | { bullets: string[] }
  | { callout: "evidence" | "distinction" | "mistake" | "matters" | "steps" | "means"; title?: string; text: string };

export type ArticleFaq = { q: string; a: string };

export type NewsroomArticleData = {
  path: string;
  /** On-page H1 and schema headline. */
  title: string;
  /** <title> tag, max 60 chars with suffix. */
  headTitle: string;
  description: string;
  published: string;
  category: string;
  readTime: string;
  icon: LucideIcon;
  concept: string;
  blocks: ArticleBlock[];
  faqs: ArticleFaq[];
  related: { to: string; title: string; description: string }[];
  cta: { text: string; to: ComponentProps<typeof Link>["to"] };
  author?: ArticleAuthor;
};

const SITE = "https://protectbyeterna.com";

export function newsroomArticleHead(a: NewsroomArticleData) {
  const url = `${SITE}${a.path}`;
  return {
    meta: [
      { title: a.headTitle },
      { name: "description", content: a.description },
      { property: "og:title", content: a.headTitle },
      { property: "og:description", content: a.description },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "article:published_time", content: a.published },
      { property: "og:url", content: url },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

function schema(a: NewsroomArticleData) {
  const url = `${SITE}${a.path}`;
  return JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: a.title,
      description: a.description,
      datePublished: a.published,
      dateModified: a.published,
      ...articleCommon({ url, author: a.author }),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Newsroom", item: `${SITE}/newsroom` },
        { "@type": "ListItem", position: 3, name: a.title, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: a.faqs.map(({ q, a: ans }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: ans },
      })),
    },
  ]);
}

/** Render [label](href) links inside plain text. */
export function richText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, label, href] = m;
    out.push(
      href.startsWith("http") ? (
        <a key={m.index} href={href} target="_blank" rel="noopener noreferrer" className="landing-link text-landing-ink">
          {label}
        </a>
      ) : (
        <Link key={m.index} to={href as never} className="landing-link text-landing-ink">
          {label}
        </Link>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function NewsroomArticle({ a }: { a: NewsroomArticleData }) {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title={a.title}
      intro={a.description}
      breadcrumb={[
        { label: "Home", to: "/" as const },
        { label: "Newsroom", to: "/newsroom" as const },
        { label: a.title },
      ]}
      category={a.category}
      publishedDate={a.published}
      readTime={a.readTime}
      heroPlaceholder={{ icon: a.icon, concept: a.concept }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema(a) }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          {a.blocks.map((b, i) => {
            if ("h2" in b)
              return (
                <h2 key={i} className="pt-4 text-xl font-semibold text-landing-ink">
                  {b.h2}
                </h2>
              );
            if ("p" in b) return <p key={i}>{richText(b.p)}</p>;
            if ("steps" in b)
              return (
                <ol key={i} className="list-decimal space-y-3 pl-5">
                  {b.steps.map((s) => (
                    <li key={s}>{richText(s)}</li>
                  ))}
                </ol>
              );
            if ("bullets" in b)
              return (
                <ul key={i} className="list-disc space-y-3 pl-5">
                  {b.bullets.map((s) => (
                    <li key={s}>{richText(s)}</li>
                  ))}
                </ul>
              );
            return (
              <ArticleCallout key={i} kind={b.callout} label={b.title}>
                <p>{richText(b.text)}</p>
              </ArticleCallout>
            );
          })}

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              {a.faqs.map(({ q, a: ans }) => (
                <p key={q}>
                  <span className="font-semibold text-landing-ink">{q}</span> {ans}
                </p>
              ))}
            </div>
          </div>

          <RelatedReading items={a.related} />

          <ArticleCta text={a.cta.text} to={a.cta.to} />

          <div className="flex flex-wrap gap-3 border-t border-landing-line pt-8">
            <Link to="/request-protection" className="landing-link inline-flex items-center gap-1 font-semibold text-landing-ink">
              Request digital identity protection <ArrowRight className="size-3.5" />
            </Link>
            <Link to="/newsroom" className="landing-link inline-flex items-center gap-1 text-landing-ink">
              Back to Newsroom <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
