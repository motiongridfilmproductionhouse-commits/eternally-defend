import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Network } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/online-reputation-problems-business-growth";
const PUBLISHED = "2026-09-19";
const TITLE = "How Online Reputation Problems Can Affect Business Growth";
const DESCRIPTION =
  "Online reputation issues rarely stay contained to one post. Here's how they move through sales, hiring, partnerships and investor trust — and what actually helps.";

export const Route = createFileRoute("/newsroom_/online-reputation-problems-business-growth")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Why Online Reputation Problems Don't Stay Contained" },
      {
        property: "og:description",
        content:
          "A viral post from months ago can still be the first thing a prospective customer sees. Here's how reputation risk actually moves through a business.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: ReputationBusinessGrowthPage,
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
          name: "Does a single negative article really affect revenue?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "It depends on context — how prominently it surfaces, how much other information a buyer has, and how the business responds. Research on independent restaurants found a measurable link between review ratings and revenue; the underlying dynamic applies more broadly, though the exact size of the effect varies by industry and situation.",
          },
        },
        {
          "@type": "Question",
          name: "Is this a marketing problem or a security problem?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Both, which is part of why it gets under-addressed. It benefits from continuous monitoring, closer to a security practice, and thoughtful public response, closer to a communications practice.",
          },
        },
        {
          "@type": "Question",
          name: "If we remove the original post, is the issue resolved?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Not necessarily. Copies, screenshots and discussion threads can persist and remain searchable even after the original is gone, and search engines may still index older references to the incident.",
          },
        },
        {
          "@type": "Question",
          name: "How is a genuine threat told apart from routine criticism?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "A consistent standard, applied the same way every time, matters more than any single rule — for example, checking whether a claim can be traced to a checkable source, whether it's been independently corroborated, and how it's actually spreading before deciding how seriously to treat it.",
          },
        },
      ],
    },
  ]);
}

function ReputationBusinessGrowthPage() {
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
      readTime="8-minute read"
      heroPlaceholder={{ icon: Network, concept: "Reputation discovery chain" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A customer pulls up your company's name before signing a contract. The first result
            isn't your homepage. It's a thread from six months ago, screenshotted and reposted,
            making an accusation nobody at the company has ever seen addressed. The customer doesn't
            call to ask about it. They just quietly go with a competitor.
          </p>
          <p>
            Nobody filed an incident report. No crisis meeting happened. Revenue simply came in a
            little lower than the pipeline predicted, and nobody could say exactly why.
          </p>
          <p>
            This is the version of reputation risk that doesn't look like a crisis — and it's the
            version most businesses are actually exposed to.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Reputation problems don't stay in one lane
          </h2>
          <p>
            It's tempting to file "reputation" under marketing or PR: something the communications
            team manages with a statement and a wait-and-see approach. That framing made sense when
            reputation lived mostly in print coverage and word of mouth. It doesn't hold up once
            reputation lives primarily in search results, review sites and social feeds — places
            every part of the business touches, usually before anyone in comms even knows there's an
            issue.
          </p>
          <p>
            A prospective customer researching a vendor sees the same search results as a
            prospective hire researching an employer, a bank underwriting a loan, or a journalist
            deciding whether a story is worth a follow-up call. One piece of unresolved content can
            sit in the path of all four.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Where this actually shows up
          </h2>
          <p>
            <span className="font-semibold text-landing-ink">Sales and conversion.</span> Buyers
            research before they commit, and what they find shapes the conversation before a
            salesperson says a word. Independent research backs this up directly: Harvard Business
            School economist Michael Luca found that each additional star in an independent
            restaurant's Yelp rating was associated with a 5–9% change in revenue — an effect that
            held for independent businesses specifically, because customers had no other reference
            point to fall back on. The mechanism generalizes past restaurants: when a buyer has
            limited other information about a vendor, what's visible online carries outsized weight.
            BrightLocal's 2026 Local Consumer Review Survey found that 97% of consumers now read
            reviews when researching a local business, and the share who say they "always" check
            first jumped from 29% to 41% in a single year. Fewer buyers today are willing to take a
            claim on faith; a smaller fraction of the decision is up to a salesperson's pitch.
          </p>
          <p>
            <span className="font-semibold text-landing-ink">
              Recruitment and employee confidence.
            </span>{" "}
            Candidates research employers the same way customers research vendors. Unresolved
            negative content doesn't just cost a few declined offers — it raises the cost of every
            offer that does get accepted, because compensation has to work harder to overcome
            hesitation the candidate can't quite articulate. Internally, employees who see the same
            content their friends and family are seeing tend to feel it before leadership addresses
            it, which is its own quiet drag on morale.
          </p>
          <p>
            <span className="font-semibold text-landing-ink">
              Partnerships and vendor relationships.
            </span>{" "}
            Procurement and legal teams at prospective partners routinely run basic diligence
            searches before a deal closes. A partner doesn't need to believe an unresolved claim to
            decide it's not worth the exposure of being associated with it — "we'll wait and see" is
            a common, low-friction way to quietly stall a deal.
          </p>
          <p>
            <span className="font-semibold text-landing-ink">Investor perception.</span> For
            companies that raise capital, investors weigh reputational exposure the same way they
            weigh any other risk to future cash flow. An unresolved public dispute doesn't have to
            be true to affect a valuation conversation; it only has to be visible and unaddressed.
          </p>
          <p>
            <span className="font-semibold text-landing-ink">Expansion into new markets.</span> A
            company entering a new city, state or country is, by definition, asking people who don't
            already know it to make a judgment quickly. Search results do a disproportionate share
            of that first-impression work in an unfamiliar market, where there's no existing
            relationship to fall back on.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why this compounds instead of staying contained
          </h2>
          <p>
            A single negative post rarely stays a single post. It gets screenshotted, shared into
            group chats and forums, and picked up by search engines independently of the original
            platform. Each new copy is a new entry point for someone searching the company's name
            later — which is why an incident from months or years ago can still be the first thing a
            prospective customer sees today. The content doesn't need to keep spreading to keep
            having an effect; it just needs to keep being findable.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common mistake is treating a reputation incident as resolved once the
              original post is taken down or the news cycle moves on. Removal of the original
              doesn't remove the copies, the screenshots or the discussion threads that reference it
              — and it does nothing about how the incident is indexed in search results, where it
              can keep surfacing on the exact query (the company's own name) that matters most. The
              second common mistake is silence by default — sometimes the right call, but it's a
              decision that should be made deliberately, not a default that happens because no one
              is monitoring closely enough to know a response is even warranted. The third is
              waiting for a dedicated crisis before building any process at all — by the time a
              crisis is underway, there's no time to set up monitoring, define who owns escalation,
              or agree on what "verified" means before a claim gets treated as fact internally.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What to do about it</h2>
          <p>
            The organizations that handle this well tend to share a few habits: they know what's
            being said about them before a customer or investor brings it up, they distinguish a
            genuine reputational threat from routine criticism instead of reacting to everything
            equally, and they have already decided — before a crisis, not during one — who is
            authorized to respond and what evidence is required before a claim gets escalated. None
            of that requires a large team, but it does require the fact-finding to happen
            continuously rather than only after something goes wrong.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When professional help may be needed
          </h2>
          <p>
            Most day-to-day reputation questions don't need outside help — a clear internal process
            handles them. Outside support tends to matter once an incident is moving across multiple
            platforms at once, involves synthetic or manipulated media, or requires the kind of
            evidence preservation and platform-specific escalation that a small internal team
            doesn't do often enough to have built real expertise in. At that point, the goal isn't
            just responding faster — it's making sure the response is built on verified facts rather
            than the first version of the story that circulated.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            How long-term protection actually works
          </h2>
          <ArticleCallout kind="matters">
            <p>
              Reputation protection that holds up over time looks less like a single response and
              more like an ongoing practice: continuous monitoring across the platforms that matter,
              a clear standard for what counts as a verified issue versus an unconfirmed one, and a
              documented process for escalation so that when something does need a response, it
              doesn't have to be improvised. Organizations working in this space, including Eterna,
              describe this as pairing technology-assisted monitoring with human review — automated
              discovery flags what might matter, and a person decides what actually does, before
              anything is escalated.
            </p>
          </ArticleCallout>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Does a single negative article really affect revenue?
                </span>{" "}
                It depends on context — how prominently it surfaces, how much other information a
                buyer has, and how the business responds. Research on independent restaurants found
                a measurable link between review ratings and revenue; the underlying dynamic applies
                more broadly, though the exact size of the effect varies by industry and situation.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Is this a marketing problem or a security problem?
                </span>{" "}
                Both, which is part of why it gets under-addressed — it doesn't sit neatly inside
                one team's job description. It benefits from continuous monitoring and thoughtful
                public response.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  If we remove the original post, is the issue resolved?
                </span>{" "}
                Not necessarily. Copies, screenshots and discussion threads can persist and remain
                searchable even after the original is gone, and search engines may still index older
                references to the incident.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  How is a genuine threat told apart from routine criticism?
                </span>{" "}
                A consistent standard, applied the same way every time, matters more than any single
                rule.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation: (
                  <>
                    Michael Luca, "Reviews, Reputation, and Revenue: The Case of Yelp.com," Harvard
                    Business School Working Paper 12-016 (hbs.edu).
                  </>
                ),
              },
              {
                citation: <>BrightLocal, Local Consumer Review Survey 2026 (brightlocal.com).</>,
              },
            ]}
          />

          <RelatedReading
            items={[
              {
                to: "/newsroom/brand-reputation-risk-business-risk",
                title: "Why Brand Reputation Risk Is Becoming a Business Risk",
                description:
                  "Why more companies are managing reputation like any other core business risk.",
              },
              {
                to: "/newsroom/removing-one-post-does-not-solve-reputation-problem",
                title: "Why Removing One Harmful Post Does Not Always Solve a Reputation Problem",
                description: "Why removal and resolution aren't the same thing.",
              },
              {
                to: "/newsroom/why-companies-need-reputation-monitoring",
                title: "Why Companies Need Digital Reputation Monitoring Before a Crisis Happens",
                description: "The case for continuous monitoring instead of waiting for a crisis.",
              },
              {
                to: "/online-reputation-protection",
                title: "Online Reputation Protection",
                description: "Eterna's identity-protection approach to business reputation risk.",
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
