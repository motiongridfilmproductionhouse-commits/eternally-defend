import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, SearchX } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/negative-search-results-brand-reputation";
const PUBLISHED = "2026-09-19";
const TITLE = "What Happens When Negative Search Results Start Defining Your Brand?";
const DESCRIPTION =
  "The results for your company's own name aren't neutral — and negative content can dominate them long after the original story fades. Here's why, and what to do.";

export const Route = createFileRoute("/newsroom_/negative-search-results-brand-reputation")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "When Your Own Search Results Stop Reflecting Your Brand" },
      {
        property: "og:description",
        content:
          "A single incident can end up defining a company's branded search results for years. Here's how that happens and what actually helps.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: NegativeSearchResultsPage,
});

function schema() {
  return JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      description: DESCRIPTION,
      author: { "@type": "Organization", name: "Eterna Sentinel" },
      publisher: { "@type": "Organization", name: "Eterna Sentinel" },
      datePublished: PUBLISHED,
      dateModified: PUBLISHED,
      mainEntityOfPage: CANONICAL,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://protectbyeterna.com/" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Newsroom",
          item: "https://protectbyeterna.com/newsroom",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Reputation Protection",
          item: "https://protectbyeterna.com/newsroom",
        },
        { "@type": "ListItem", position: 4, name: TITLE, item: CANONICAL },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Can a negative search result be removed?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Sometimes — if it violates a platform's own policies, there may be grounds for removal at the source. Content that's simply negative but not policy-violating is harder to remove outright and often calls for a different approach.",
          },
        },
        {
          "@type": "Question",
          name: "Does deleting the original post fix search results?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Not on its own. Search engines can have indexed copies, discussions and related coverage independently, and those can continue to rank even after the source is gone.",
          },
        },
        {
          "@type": "Question",
          name: "How long does it take to change what ranks for a company's name?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "It varies widely depending on how established the existing content is and what's replacing it. This is generally a gradual process, not an overnight one.",
          },
        },
        {
          "@type": "Question",
          name: "Is this the same as SEO?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "It overlaps with SEO, but the goal is different — SEO usually aims to rank new content higher; reputation-focused search work is also concerned with what's already ranking and why, and whether it's accurate.",
          },
        },
      ],
    },
  ]);
}

function NegativeSearchResultsPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title={TITLE}
      intro={DESCRIPTION}
      breadcrumb={[
        { label: "Home", to: "/" as const },
        { label: "Newsroom", to: "/newsroom" as const },
        { label: "Reputation Protection" },
        { label: TITLE },
      ]}
      category="Reputation Protection"
      publishedDate={PUBLISHED}
      readTime="7-minute read"
      heroPlaceholder={{ icon: SearchX, concept: "Search results as the front door" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Type a company's name into a search engine and the results that come back aren't
            neutral. They're a ranked, editable-by-nobody-in-particular summary of what the internet
            currently thinks is most relevant about that name — and for a growing number of
            companies, that summary is being written by whichever piece of content happened to rank,
            not by anything the company actually published.
          </p>
          <p>
            Most businesses only notice this the first time it goes wrong: a customer mentions "that
            thing I saw when I looked you up," and nobody on the team can immediately picture what
            that thing is.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Search results are a first impression the company doesn't control
          </h2>
          <p>
            A company's own website, social accounts and press coverage compete for space on that
            first page with everything else that mentions its name — review sites, forum threads,
            news coverage, and any viral post that happened to use the company's name in a way
            search engines found relevant. When something negative ranks well, it isn't because
            search engines are biased against the company. It's usually because that piece of
            content generated more engagement, more links, or more direct searches than anything the
            company itself published — which negative, emotionally charged content often does,
            structurally, regardless of what it's about.
          </p>
          <p>
            The result is a branded search page — the results for the company's own name — that no
            longer reflects what the company would choose to show a prospective customer meeting it
            for the first time.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why this matters more than a single bad review
          </h2>
          <p>
            A single negative review sits inside a review platform, next to other reviews, with
            context. A negative search result sits at the top of the exact query a prospective
            customer, candidate or journalist runs before forming any other opinion — often before
            they've seen anything else the company has to say. It's not competing for attention with
            the company's own narrative; for a moment, it is the company's narrative, because it's
            the only thing visible.
          </p>
          <p>
            This compounds because branded search is disproportionately used by people already close
            to a decision. Someone searching a company's name isn't casually browsing — they're
            often verifying something before signing, applying, investing or partnering. A negative
            result at that exact moment carries more weight than the same content would carry almost
            anywhere else.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            How one incident becomes a persistent search problem
          </h2>
          <p>
            A single post rarely ranks well on its own the day it's published. What actually pushes
            something to the top of branded search is what happens after: it gets discussed, quoted,
            screenshotted and linked to by other sites, and each of those becomes a separate piece
            of content search engines can index — all still tied to the same underlying incident.
            This is why an issue from a year or more ago can still dominate a brand's search results
            long after the original conversation has ended: the derivative content (news coverage,
            forum discussion, aggregator sites) often outlives the original post and keeps ranking
            on its own.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common mistake is assuming that getting the original content removed fixes
              search visibility. It doesn't, automatically — search engines have often indexed
              copies, discussions and related coverage independently of the source, and those can
              keep ranking even after the original is gone. The second is assuming that publishing
              more positive content will simply outrank the negative result on its own timeline. It
              can help, but it's a gradual process that depends on how established the negative
              content already is, and it rarely works as a stand-alone fix for something actively
              ranking on page one. The third is waiting to look at branded search results until a
              customer or partner brings up a concern. By then, the content has usually had time to
              accumulate the links, discussion and engagement that make it hard to dislodge quickly.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What to do about it</h2>
          <p>
            Managing this well starts with knowing what's actually showing up for the company's own
            name on a regular basis — not just checking once during a crisis. From there, the
            response depends on what's actually ranking: content that violates a platform's policies
            can sometimes be reported and removed at the source; content that's simply outdated or
            unrepresentative may call for a longer-term approach involving accurate, substantive
            content that search engines find genuinely relevant to the same query. What matters most
            is that the response is proportionate to what's actually there — not a reflex to "get it
            off page one" without understanding why it's ranking in the first place.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When professional help may be needed
          </h2>
          <p>
            Basic branded-search monitoring is something most companies can do themselves. It
            becomes harder once negative content involves synthetic or manipulated media, spans many
            separate pieces of content across different sites, or requires the kind of sustained,
            technically informed effort that search visibility work actually takes — work that
            benefits from experience most internal marketing teams don't build up, because they
            don't face this problem often.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            How long-term protection actually works
          </h2>
          <ArticleCallout kind="matters">
            <p>
              The organizations that handle this well tend to monitor branded search continuously
              rather than periodically, so they see an emerging issue while it's still one or two
              pieces of content — not after it's compounded into a dozen. Eterna's own approach
              treats detection as only the first step: findings are verified against a documented
              standard before anything is treated as confirmed, and response happens with human
              authorization rather than automatically, which matters because search visibility work
              can affect what a company's own customers and partners see.
            </p>
          </ArticleCallout>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Can a negative search result be removed?
                </span>{" "}
                Sometimes — if it violates a platform's own policies, there may be grounds for
                removal at the source. Content that's simply negative but not policy-violating is
                harder to remove outright and often calls for a different approach.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Does deleting the original post fix search results?
                </span>{" "}
                Not on its own. Search engines can have indexed copies, discussions and related
                coverage independently, and those can continue to rank even after the source is
                gone.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  How long does it take to change what ranks for a company's name?
                </span>{" "}
                It varies widely depending on how established the existing content is and what's
                replacing it. This is generally a gradual process, not an overnight one.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">Is this the same as SEO?</span> It
                overlaps with SEO, but the goal is different — SEO usually aims to rank new content
                higher; reputation-focused search work is also concerned with what's already ranking
                and why, and whether it's accurate.
              </p>
            </div>
          </div>

          <RelatedReading
            items={[
              {
                to: "/newsroom/removing-one-post-does-not-solve-reputation-problem",
                title: "Why Removing One Harmful Post Does Not Always Solve a Reputation Problem",
                description: "Why removal and resolution aren't the same thing.",
              },
              {
                to: "/newsroom/content-removal-vs-search-suppression-vs-reputation-recovery",
                title: "Content Removal vs Search Suppression vs Reputation Recovery",
                description:
                  "The difference between removal, suppression and recovery — and which applies when.",
              },
              {
                to: "/newsroom/online-reputation-problems-business-growth",
                title: "How Online Reputation Problems Can Affect Business Growth",
                description:
                  "How reputation risk moves through sales, hiring, partnerships and investor trust.",
              },
            ]}
          />

          <ArticleCta
            text="Explore Eterna's approach to digital reputation protection"
            to="/methodology"
          />

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
