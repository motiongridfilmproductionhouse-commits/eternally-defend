import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, UserRoundX } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/ai-impersonation-reputation-damage";
const PUBLISHED = "2026-09-19";
const TITLE = "How AI Impersonation Can Damage Personal and Business Reputation";
const DESCRIPTION =
  "A cloned face and voice were enough to move $25.6 million in one real case. Here's how AI impersonation damages both individuals and organizations — and what actually helps.";

export const Route = createFileRoute("/newsroom_/ai-impersonation-reputation-damage")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "When a Cloned Face and Voice Are All It Takes" },
      {
        property: "og:description",
        content:
          "AI impersonation causes two distinct kinds of harm — direct fraud and reputational contamination. Here's how both actually happen.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: AiImpersonationDamagePage,
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
          name: "Deepfakes & Synthetic Media",
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
          name: "How common is deepfake-based fraud against businesses?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Documented cases like the Arup incident show it's a real and growing threat, though comprehensive industry-wide figures are still developing as reporting standards mature. Organizations should treat it as a realistic risk to plan for, not a rare edge case.",
          },
        },
        {
          "@type": "Question",
          name: "Can video calls still be trusted for business decisions?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Video calls remain useful, but for high-stakes decisions — particularly financial transactions — they should be paired with an independent verification step that doesn't rely on the video or audio itself.",
          },
        },
        {
          "@type": "Question",
          name: "What should I do if I find a fake endorsement using my face or voice?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Treat it the same as any deepfake impersonation: preserve evidence, report through the platform's specific policy, and correct the record.",
          },
        },
        {
          "@type": "Question",
          name: "Is this only a risk for large companies and famous people?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Smaller organizations and less-famous professionals are targeted too, sometimes precisely because they have fewer resources dedicated to catching it early.",
          },
        },
      ],
    },
  ]);
}

function AiImpersonationDamagePage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title={TITLE}
      intro={DESCRIPTION}
      breadcrumb={[
        { label: "Home", to: "/" as const },
        { label: "Newsroom", to: "/newsroom" as const },
        { label: "Deepfakes & Synthetic Media" },
        { label: TITLE },
      ]}
      category="Deepfakes & Synthetic Media"
      publishedDate={PUBLISHED}
      readTime="7-minute read"
      heroPlaceholder={{ icon: UserRoundX, concept: "Impersonation network" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A founder starts getting messages from people he's never met, asking why he's promoting
            a cryptocurrency investment scheme. He isn't. Somewhere online, there's a video of his
            face and his voice, cloned convincingly enough that people who follow his actual work
            believed it was really him — and some of them sent money before anyone figured out what
            was happening.
          </p>
          <p>
            This specific pattern — a cloned face and voice used to lend credibility to a scam — has
            become common enough that it's no longer a hypothetical. Public figures, executives and
            creators have all had their likeness used this way, and the damage doesn't stop with the
            people who were defrauded. It extends to everyone who now associates that person's face
            with a scam they had nothing to do with.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Two different kinds of damage, from the same underlying problem
          </h2>
          <p>
            AI impersonation causes harm in two distinct ways, and understanding which one applies
            to a given situation shapes how it should be handled.
          </p>
          <ArticleCallout kind="distinction">
            <p>
              <span className="font-semibold text-landing-ink">Direct fraud</span>, where the
              impersonation is the mechanism of the crime itself. In one of the most thoroughly
              documented cases, a finance employee at Arup, the global engineering firm, joined what
              appeared to be a video call with the company's CFO and several other colleagues, all
              discussing a confidential transaction. Every person on that call except the employee
              was a deepfake, generated from publicly available conference footage and video calls.
              Believing the instructions were genuine, the employee authorized 15 wire transfers
              totaling roughly $25.6 million before anyone realized what had happened. No single
              element of the scam was especially exotic — it worked because the video and audio were
              convincing enough, and the social pressure of a multi-person call was enough, to make
              normal verification feel unnecessary.
            </p>
            <p className="mt-3">
              <span className="font-semibold text-landing-ink">Reputational contamination</span>,
              where the impersonated person did nothing wrong but is now associated with something
              harmful by proxy — a fake endorsement, a fabricated statement, a scheme they were
              never part of. This is the founder-and-crypto-scam pattern, and it's just as damaging
              to the actual person even though they were never the one being defrauded. Their name
              and face become attached to something they'd never approve of, and that association
              can persist in search results and social discussion long after the specific scam has
              been shut down.
            </p>
          </ArticleCallout>
          <p>
            Both patterns are growing for the same underlying reason: the material needed to
            generate a convincing impersonation — public photos, conference talks, earnings calls,
            interview clips — is exactly the kind of content that visible professionals and
            organizations are expected to produce as part of doing business.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why executives specifically are increasingly targeted
          </h2>
          <p>
            Executives make efficient targets for a few compounding reasons. They typically have
            substantial public video and audio available — earnings calls, conference keynotes,
            media interviews — which is ideal training material for voice and face cloning. Their
            communications carry organizational authority, so a convincing impersonation doesn't
            need to persuade a stranger; it needs to persuade an employee who already takes
            instructions from that person as a matter of course. And the financial upside for an
            attacker scales with the size of the organization, which makes larger companies
            proportionally more attractive targets despite typically having more security resources.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            How this spreads past the initial incident
          </h2>
          <p>
            A fraud attempt that fails, or a fake endorsement that gets caught early, doesn't
            necessarily stay contained. Screenshots and video clips get reshared as warnings, as
            news coverage, or simply as viral content — which means the same footage used in the
            original scam can keep circulating, sometimes stripped of the context that it was
            fraudulent in the first place. Someone encountering a reshared clip months later,
            without the original correction attached, may have no way of knowing it was ever
            debunked.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common mistake in the fraud scenario is treating a video call, on its own, as
              sufficient verification for a high-stakes request. Video and voice used to be reliable
              proof of identity precisely because they were hard to fake convincingly; that
              assumption no longer holds, and processes built around it — particularly for financial
              transactions — need an independent verification step that doesn't rely on video or
              voice alone.
            </p>
            <p className="mt-3">
              The most common mistake in the reputational-contamination scenario is assuming that a
              quick correction fully resolves the problem. It reduces the damage, but copies,
              screenshots and reposts of the original fake content can persist independently of any
              correction, especially once it's spread beyond the platform where it first appeared.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What to do about it</h2>
          <p>
            On the fraud-prevention side, the most effective single change organizations can make is
            requiring a second, independent verification channel for any high-value request — a
            callback to a known number, a pre-agreed code phrase, or an in-person confirmation —
            before video or voice alone is treated as sufficient authorization, regardless of how
            senior the person on the call appears to be.
          </p>
          <p>
            On the reputational side, the approach mirrors what{" "}
            <Link
              to="/newsroom/someone-made-a-deepfake-of-me"
              className="landing-link text-landing-ink"
            >
              Someone Made a Deepfake of Me — What Should I Do?
            </Link>{" "}
            covers: preserve evidence, report through the platform's specific impersonation or
            synthetic-media policy, and correct the record clearly and factually rather than
            reactively.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When professional help may be needed
          </h2>
          <p>
            Organizational fraud attempts involving impersonation typically warrant immediate
            involvement of security and legal teams, given the financial and evidentiary stakes.
            Reputational-contamination cases tend to need outside help once the content is
            circulating across multiple platforms, being actively used in ongoing scams targeting
            other people, or requires the kind of sustained monitoring and evidence preservation
            that a one-time internal response doesn't cover.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            How long-term protection actually works
          </h2>
          <p>
            For organizations, this means building verification steps into financial and operational
            processes that don't rely solely on video or voice — a process change, not just a
            technology purchase. For individuals and public-facing professionals, it means combining
            response readiness (knowing what to do if impersonation happens) with ongoing
            monitoring, so an impersonation attempt is caught while it's still limited rather than
            after it's already reached a wide audience. Eterna's own approach to this pairs
            continuous monitoring with a verification standard applied before anything is treated as
            confirmed — which matters particularly here, since acting on an unverified report of
            impersonation can itself cause reputational harm if the report turns out to be mistaken.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  How common is deepfake-based fraud against businesses?
                </span>{" "}
                Documented cases like the Arup incident show it's a real and growing threat, though
                comprehensive industry-wide figures are still developing as reporting standards
                mature. Organizations should treat it as a realistic risk to plan for, not a rare
                edge case.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Can video calls still be trusted for business decisions?
                </span>{" "}
                Video calls remain useful, but for high-stakes decisions — particularly financial
                transactions — they should be paired with an independent verification step that
                doesn't rely on the video or audio itself.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  What should I do if I find a fake endorsement using my face or voice?
                </span>{" "}
                Treat it the same as any deepfake impersonation: preserve evidence, report through
                the platform's specific policy, and correct the record.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Is this only a risk for large companies and famous people?
                </span>{" "}
                No. Smaller organizations and less-famous professionals are targeted too, sometimes
                precisely because they have fewer resources dedicated to catching it early.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation: (
                  <>
                    CNN Business, "Arup revealed as victim of $25 million deepfake scam involving
                    Hong Kong employee" (cnn.com, May 2024).
                  </>
                ),
              },
              {
                citation: (
                  <>
                    FBI Internet Crime Complaint Center, PSA on generative AI and financial fraud
                    (ic3.gov, PSA241203).
                  </>
                ),
              },
            ]}
          />

          <RelatedReading
            items={[
              {
                to: "/newsroom/someone-made-a-deepfake-of-me",
                title: "Someone Made a Deepfake of Me — What Should I Do?",
                description: "The ordered first steps for correcting the record.",
              },
              {
                to: "/newsroom/deepfake-reuploads-after-removal",
                title: "Deepfake Reuploads: Why Harmful Content Can Return After Removal",
                description: "Why a correction or takedown rarely ends a contamination case.",
              },
              {
                to: "/newsroom/impersonation-response-guide",
                title: "The Impersonation Response Guide",
                description: "The fuller sequence once evidence is preserved and reported.",
              },
            ]}
          />

          <ArticleCta
            text="Explore Eterna's synthetic-media and identity protection approach"
            to="/identity-response-observatory"
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
