import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Scale } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/false-allegations-online-what-to-do";
const PUBLISHED = "2026-09-19";
const TITLE = "False Allegations Online: What Individuals and Businesses Should Do";
const DESCRIPTION =
  "A false claim doesn't need to be proven to cause damage — it just needs to be visible. Here's how to assess and respond, as an individual or a business.";

export const Route = createFileRoute("/newsroom_/false-allegations-online-what-to-do")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "A False Claim Doesn't Need to Be Proven to Spread" },
      {
        property: "og:description",
        content:
          "What to do first when a false allegation appears online — for individuals and businesses, and when this becomes a legal question.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: FalseAllegationsPage,
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
          name: "Is every false statement about me or my business defamation?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Not necessarily — defamation generally requires a false statement of fact (not opinion), that causes harm, made with a certain level of fault, and the specifics vary significantly by jurisdiction. This is general information, not legal advice.",
          },
        },
        {
          "@type": "Question",
          name: "Can I get a false review removed?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Sometimes, if it violates a platform's authenticity policies or the FTC's rule against fabricated reviews. A genuine but negative review generally isn't removable on those grounds.",
          },
        },
        {
          "@type": "Question",
          name: "Should I respond publicly to a false allegation?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "It depends on how far it's spread and who's likely to see it. Document first; decide on a public response based on the actual situation, not the instinct to react immediately.",
          },
        },
        {
          "@type": "Question",
          name: "Why won't the platform just take it down if it's false?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Platforms generally aren't positioned to adjudicate factual disputes between users and often require a specific policy violation or legal process before removing content, even content you believe is false.",
          },
        },
      ],
    },
  ]);
}

function FalseAllegationsPage() {
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
      heroPlaceholder={{ icon: Scale, concept: "Assessing what's actually claimed" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A post goes up making a specific, damaging claim — that a company defrauded a client,
            that an individual did something they never did — and it's stated as established fact,
            not opinion or allegation. There's no evidence attached, no named source, sometimes not
            even a named accuser. And it's already being shared.
          </p>
          <p>
            A false allegation doesn't need to be proven, or even plausible, to start causing
            damage. It just needs to be visible. Here's how to think through a response, whether
            you're an individual or a business.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            First, understand what you're actually dealing with
          </h2>
          <p>
            Not everything that feels unfair is a false allegation in a legal sense, and not every
            false allegation needs a legal response to be handled well. Before deciding what to do,
            it helps to separate a few things: is the claim being stated as fact, or framed as
            opinion or a question ("I think…", "has anyone else noticed…")? Is it about something
            specific and checkable, or vague and unfalsifiable? Is it from an identifiable source,
            or anonymous? These distinctions shape what response actually makes sense, though the
            specifics vary by jurisdiction and this article isn't a substitute for legal advice on a
            specific situation.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why responding immediately and publicly isn't always the right first move
          </h2>
          <p>
            The instinct to respond right away — a public denial, a rebuttal in the comments — is
            understandable, but it can work against you in two ways. It can spread the claim
            further, to people who hadn't seen it yet, particularly if your response generates its
            own engagement. And it can lock in a defensive posture before you've had a chance to
            document what's actually being said and where, which matters if you need that
            documentation later.
          </p>
          <p>
            This doesn't mean staying silent indefinitely. It means preserving evidence and
            assessing the situation before deciding how, when and whether to respond publicly.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What to do first</h2>
          <ArticleCallout kind="steps">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-landing-ink">Preserve the evidence.</span>{" "}
                Screenshot the claim, the account or page it's on, the date, and any replies or
                shares that indicate how far it's spreading. If it's removed before you've
                documented it, you lose the ability to show what was actually said.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">
                  Check whether it violates the platform's own policies.
                </span>{" "}
                Many platforms prohibit harassment, targeted false claims, or coordinated
                inauthentic behavior, and have a specific reporting category for it. This is often
                faster than pursuing removal through any other channel, though it isn't guaranteed
                to succeed — platforms make their own policy judgment calls.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">
                  For businesses specifically, check whether it's a fake review.
                </span>{" "}
                The FTC's Consumer Reviews and Testimonials Rule, in effect since October 2024,
                prohibits fabricated reviews and testimonials, and most major review platforms have
                their own reporting process for reviews that violate their authenticity policies — a
                distinct pathway from a general defamation claim.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">
                  Decide whether and how to respond publicly
                </span>
                , based on how far the claim has actually spread and who's likely to see it — not on
                how upsetting it feels internally. A claim seen by a handful of people may not
                warrant the same public response as one that's already reached a wide audience.
              </li>
            </ul>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why platforms don't remove everything, even when a claim is false
          </h2>
          <p>
            Most major platforms operate under legal frameworks, including Section 230 of the
            Communications Decency Act in the United States, that generally treat them as distinct
            from the people who post content on them — which is part of why a platform may decline
            to remove something even when you believe it's false, absent a policy violation or a
            court order. This isn't a statement about whether the underlying claim is true; it's a
            structural reason platforms are often reluctant to act as an arbiter of factual disputes
            between users.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When this becomes a legal question
          </h2>
          <ArticleCallout kind="distinction" label="Not legal advice">
            <p>
              Whether a false statement rises to the level of defamation — and what remedies are
              available — depends on jurisdiction, the nature of the claim, who made it, and a
              number of other factors that a general article can't resolve for a specific situation.
              This article is general information, not legal advice; an attorney licensed in the
              relevant jurisdiction is the right source for guidance on a specific case. What's
              useful to know in general terms is that documentation — what was said, where, when,
              and how it spread — tends to matter regardless of which legal path, if any, ends up
              being relevant.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common mistake is responding emotionally and publicly before documenting
              anything, which can spread the claim further and complicate any later process. A
              second is assuming that because something is false, it will automatically be removed —
              platforms and courts both require more than an assertion that a claim is untrue. A
              third, for businesses specifically, is not distinguishing between a genuinely
              fabricated review (which may be addressable through a platform's authenticity policy
              or the FTC framework) and a real customer's negative but honest experience, which
              isn't removable on those grounds and generally shouldn't be treated the same way.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When professional help may be needed
          </h2>
          <p>
            A single, contained false claim can often be handled with platform reporting and, if
            warranted, a measured public response. Legal counsel becomes relevant once you're
            considering a formal defamation claim or need to understand your options in a specific
            jurisdiction. Specialized monitoring and response support tends to matter most when a
            false claim is spreading across multiple platforms at once, or when it's part of a
            broader, coordinated campaign rather than an isolated post.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Is every false statement about me or my business defamation?
                </span>{" "}
                Not necessarily — defamation generally requires a false statement of fact (not
                opinion), that causes harm, made with a certain level of fault, and the specifics
                vary significantly by jurisdiction. This is general information, not legal advice.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Can I get a false review removed?
                </span>{" "}
                Sometimes, if it violates a platform's authenticity policies or the FTC's rule
                against fabricated reviews. A genuine but negative review generally isn't removable
                on those grounds.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Should I respond publicly to a false allegation?
                </span>{" "}
                It depends on how far it's spread and who's likely to see it. Document first; decide
                on a public response based on the actual situation, not the instinct to react
                immediately.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Why won't the platform just take it down if it's false?
                </span>{" "}
                Platforms generally aren't positioned to adjudicate factual disputes between users
                and often require a specific policy violation or legal process before removing
                content, even content you believe is false.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation: (
                  <>
                    Federal Trade Commission, Consumer Reviews and Testimonials Rule Q&amp;A
                    (ftc.gov).
                  </>
                ),
              },
              {
                citation: (
                  <>Congress.gov, "Section 230: An Overview," CRS Report R46751 (congress.gov).</>
                ),
              },
            ]}
          />

          <RelatedReading
            items={[
              {
                to: "/newsroom/content-removal-vs-search-suppression-vs-reputation-recovery",
                title: "Content Removal vs Search Suppression vs Reputation Recovery",
                description: "Why these are related but distinct levers, and when each applies.",
              },
              {
                to: "/newsroom/fake-account-using-my-name-photos",
                title: "What to Do When Someone Creates a Fake Account Using Your Name or Photos",
                description: "The sequence that actually works for a common form of impersonation.",
              },
              {
                to: "/newsroom/removing-one-post-does-not-solve-reputation-problem",
                title: "Why Removing One Harmful Post Does Not Always Solve a Reputation Problem",
                description: "Why a successful takedown can still leave the problem in place.",
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
