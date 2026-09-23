import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2 } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/brand-reputation-risk-business-risk";
const PUBLISHED = "2026-09-19";
const TITLE = "Why Brand Reputation Risk Is Becoming a Business Risk";
const DESCRIPTION =
  "Reputation risk moves faster, spreads further and persists longer than it used to. Here's why more companies are managing it like any other core business risk.";

export const Route = createFileRoute("/newsroom_/brand-reputation-risk-business-risk")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Reputation Risk Belongs on the Risk Register" },
      {
        property: "og:description",
        content:
          "Speed, fabrication and persistence have changed how reputation risk behaves — and why it increasingly needs the same planning as any other business risk.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: BrandReputationRiskPage,
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
          name: "Isn't reputation risk too unpredictable to plan for?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The specific incident is unpredictable, but the categories — impersonation, fabricated claims, leaked content, coordinated campaigns — are known, and each can have a defined response plan in place before anything happens.",
          },
        },
        {
          "@type": "Question",
          name: "Does this only matter for large, public companies?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Smaller organizations often have less of a track record for buyers, candidates or partners to fall back on, which can make them more exposed to a single unresolved incident, not less.",
          },
        },
        {
          "@type": "Question",
          name: "Who should own reputation risk internally?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "This varies by company, but it works best when one person or small group has clear authority to confirm claims and authorize a response — decided in advance, not during an active incident.",
          },
        },
        {
          "@type": "Question",
          name: "How is this different from a communications plan?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "A communications plan covers what to say. A risk-management approach also covers what to monitor, how a claim gets verified before it's treated as fact, and who's authorized to escalate — the decisions that need to happen before a response can be written.",
          },
        },
      ],
    },
  ]);
}

function BrandReputationRiskPage() {
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
      heroPlaceholder={{ icon: Building2, concept: "Reputation risk, mapped like any other risk" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A company's enterprise risk register usually has a line for cybersecurity, a line for
            supply chain, a line for regulatory exposure. It rarely has a line for "a fabricated
            story about us spreads faster than we can correct it." That gap isn't because the risk
            is small. It's because reputation risk has historically been hard to quantify, so it
            gets treated as a communications concern instead of a business risk with the other kind
            — the kind with a budget, an owner and a plan.
          </p>
          <p>
            That's starting to change, and not because reputation suddenly matters more than it used
            to. It's because the mechanics of how reputation gets damaged have shifted in ways that
            make it behave more like the risks a board already takes seriously.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What changed</h2>
          <p>
            Three shifts explain why reputation risk increasingly gets discussed in risk-management
            terms rather than purely PR terms.
          </p>
          <ArticleCallout kind="distinction">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-landing-ink">Speed.</span> A claim can reach a
                company's entire customer base before anyone internally has confirmed whether it's
                true. Traditional crisis communications assumed a window — hours, sometimes a full
                news cycle — to gather facts before responding. That window has compressed to the
                point that many companies now form their public understanding of an incident at the
                same pace their customers do, which is a fundamentally different starting position
                than crisis teams were built around.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">Fabrication.</span> The World
                Economic Forum's Global Risks Report has named misinformation and disinformation a
                top short-term global risk for two consecutive years, specifically because of how
                easily fabricated content now erodes trust in institutions and, by extension, in the
                organizations connected to them. A generated image, an out-of-context clip or an
                AI-written "leaked memo" doesn't need to be well made to spread — it needs to be
                plausible enough to share before anyone checks.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">Persistence.</span> Content that
                would once have faded from relevance within a news cycle now persists indefinitely
                in search results, screenshots and archives. A reputation event from three years ago
                can resurface with the same force as one from three days ago, simply because it's
                still findable.
              </li>
            </ul>
          </ArticleCallout>
          <p>
            Each of these shifts is exactly the kind of thing risk-management frameworks exist to
            handle: fast-moving, hard to predict precisely, capable of causing real financial harm,
            and manageable — not eliminated, but manageable — through preparation rather than
            improvisation.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why "we'll handle it if it happens" doesn't hold up anymore
          </h2>
          <p>
            Most other risk categories on a company's register get this treatment: identify what
            could go wrong, decide who owns the response, put basic monitoring in place, and revisit
            the plan periodically. Reputation risk, for many companies, skips straight to the third
            step — monitoring, if it happens at all — without the first two ever having been decided
            deliberately. That means when something does happen, the first conversation is about
            who's in charge, not about what to actually do, which costs time that a fast-moving
            incident doesn't allow for.
          </p>
          <p>
            The companies that treat reputation as a business risk rather than a PR afterthought
            tend to have already answered three questions before anything goes wrong: who has the
            authority to confirm a claim and authorize a public response, what counts as sufficient
            evidence before internal teams treat something as fact, and which platforms and channels
            actually matter enough to monitor continuously. None of that requires predicting the
            specific incident. It requires deciding the process in advance.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Where this shows up on a balance sheet, even when it isn't labeled "reputation"
          </h2>
          <p>
            Reputation risk rarely appears as its own line item in financial results, which is part
            of why it's underweighted in planning — but its effects show up inside categories that
            are already tracked. Sales cycles lengthen when prospects pause to "do more diligence."
            Recruiting costs rise when offers require more convincing. Cost of capital can tick up
            when a lender or investor prices in reputational uncertainty they can't quite quantify
            but also can't ignore. None of these show up on a dashboard labeled "reputation," which
            makes the underlying cause easy to miss even when the financial effect is real.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common mistake is treating reputation risk as unpredictable and therefore
              unplannable. It's true that the specific incident can't be predicted — but the
              categories of risk can be: impersonation, fabricated claims, leaked or manipulated
              content, coordinated negative campaigns. A plan doesn't need to anticipate the exact
              story; it needs to define how the organization responds to each category when it
              appears. A second mistake is assuming this is only a large-company or public-company
              problem. Smaller and mid-sized organizations often have less resilience to absorb a
              reputation event precisely because they have fewer alternative signals — no long track
              record, no large existing customer base to reassure new prospects — for a buyer to
              fall back on.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What to do about it</h2>
          <p>
            Treating reputation as a business risk starts with putting it on the same register as
            everything else the board already reviews — not as a separate conversation that only
            happens during a crisis. From there, the practical steps look familiar to anyone who's
            built a risk-management process before: assign clear ownership, define escalation
            triggers in advance, and build in continuous monitoring so the organization finds out
            about an emerging issue from its own process rather than from a customer or journalist.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When professional help may be needed
          </h2>
          <p>
            Internal teams can usually handle policy-setting and day-to-day monitoring. Outside
            expertise tends to matter most for the harder, less frequent problems: verifying whether
            content is genuinely synthetic or manipulated, preserving evidence in a way that holds
            up if legal action becomes necessary, and coordinating a response across multiple
            platforms at once — work that requires standing infrastructure and practiced judgment
            most internal teams don't need often enough to build in-house.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            How long-term protection actually works
          </h2>
          <ArticleCallout kind="matters">
            <p>
              A mature reputation-risk program looks less like crisis response and more like the
              risk-management functions a company already runs: ongoing monitoring, a documented
              verification standard, clear authorization requirements before anything gets escalated
              publicly, and periodic review of what's working. Eterna's own operating approach is
              built around a comparable structure — a four-part verification standard (sourced,
              corroborated, attributable to a stated method, and authorized before enforcement)
              applied consistently rather than case by case.
            </p>
          </ArticleCallout>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Isn't reputation risk too unpredictable to plan for?
                </span>{" "}
                The specific incident is unpredictable, but the categories — impersonation,
                fabricated claims, leaked content, coordinated campaigns — are known, and each can
                have a defined response plan in place before anything happens.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Does this only matter for large, public companies?
                </span>{" "}
                No. Smaller organizations often have less of a track record for buyers, candidates
                or partners to fall back on, which can make them more exposed to a single unresolved
                incident, not less.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Who should own reputation risk internally?
                </span>{" "}
                This varies by company, but it works best when one person or small group has clear
                authority to confirm claims and authorize a response — decided in advance, not
                during an active incident.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  How is this different from a communications plan?
                </span>{" "}
                A communications plan covers what to say. A risk-management approach also covers
                what to monitor, how a claim gets verified before it's treated as fact, and who's
                authorized to escalate.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation: <>World Economic Forum, Global Risks Report 2025 (weforum.org).</>,
              },
            ]}
          />

          <RelatedReading
            items={[
              {
                to: "/newsroom/online-reputation-problems-business-growth",
                title: "How Online Reputation Problems Can Affect Business Growth",
                description:
                  "How reputation risk moves through sales, hiring, partnerships and investor trust.",
              },
              {
                to: "/newsroom/why-companies-need-reputation-monitoring",
                title: "Why Companies Need Digital Reputation Monitoring Before a Crisis Happens",
                description: "The case for continuous monitoring instead of waiting for a crisis.",
              },
              {
                to: "/newsroom/first-24-hours-online-reputation-crisis",
                title: "The First 24 Hours of an Online Reputation Crisis",
                description: "What the earliest hours of a reputation incident actually require.",
              },
              {
                to: "/online-reputation-protection",
                title: "Online Reputation Protection",
                description:
                  "How Eterna monitors, verifies and responds to reputation attacks on organizations.",
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
