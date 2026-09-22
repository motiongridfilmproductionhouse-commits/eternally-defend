import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Compass } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/someone-made-a-deepfake-of-me";
const PUBLISHED = "2026-09-19";
const TITLE = "Someone Made a Deepfake of Me — What Should I Do?";
const DESCRIPTION =
  "Found a deepfake of yourself online? Here's what to do first — in order — before you report it, respond publicly, or assume the worst.";

export const Route = createFileRoute("/newsroom_/someone-made-a-deepfake-of-me")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Found a Deepfake of Yourself? Start Here." },
      {
        property: "og:description",
        content:
          "Calm, ordered first steps for anyone who has just discovered a deepfake impersonating them — what to do before you post, report or panic.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: DeepfakeOfMePage,
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
          name: "Should I confront the person who posted it?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Not as a first step. Preserve evidence and report through the platform first — a direct confrontation before that can tip off the poster to remove or hide the content before you've documented it.",
          },
        },
        {
          "@type": "Question",
          name: "What if I'm not sure whether it's actually a deepfake?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "You don't need certainty before reporting something that impersonates you — platforms will assess it. A second, calmer look with someone you trust can also help before you escalate.",
          },
        },
        {
          "@type": "Question",
          name: "Will reporting it make the content spread further?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Reporting to a platform is private between you and the platform — it doesn't notify other users or draw attention to the content. Public commentary about it is what can inadvertently spread it further.",
          },
        },
        {
          "@type": "Question",
          name: "Can I make platforms remove it immediately?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Removal timelines vary by platform and by what policy the content violates. Using the correct, specific reporting category is the biggest factor you control in how quickly it gets reviewed.",
          },
        },
      ],
    },
  ]);
}

function DeepfakeOfMePage() {
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
      heroPlaceholder={{ icon: Compass, concept: "The first calm steps" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Someone sent you a link, or tagged you, or just said "have you seen this?" And now
            you're looking at a video or image of yourself doing or saying something you never did.
          </p>
          <p>
            The first minutes after finding a deepfake of yourself are disorienting, and the
            instinct to immediately post a denial, message the person who shared it, or start
            deleting things is completely understandable. It's also usually not the most useful
            first move. Here's what actually helps, in order.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            First: don't engage publicly yet
          </h2>
          <p>
            It's tempting to respond immediately — to comment, to post a denial, to confront whoever
            shared it. Give that instinct a few minutes before acting on it. A public reaction
            posted before you understand what you're dealing with can lock in a version of events
            before you've had a chance to establish the facts, and it can also alert whoever created
            the content before you've preserved evidence of it.
          </p>
          <p>
            This doesn't mean staying silent forever — it means sequencing your response so the
            facts come first.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Preserve what you're looking at before it can disappear
          </h2>
          <ArticleCallout kind="evidence">
            <p>
              Before anything else, capture what you're seeing: screenshot or screen-record it, note
              the exact URL, the account or username that posted it, and the date and time you found
              it. If it's been shared or commented on elsewhere, capture that too. Content like this
              sometimes gets taken down — by the platform, or by whoever posted it — and once it's
              gone, you lose the ability to prove what it said, where it appeared, or how far it
              spread. None of this evidence needs to be shared publicly. It's for you, and
              potentially for a platform report or, later, a legal or investigative process.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Get a second, calmer look before assuming the worst
          </h2>
          <p>
            Not everything that looks unusual is a deepfake, and not every deepfake is as
            sophisticated as it first appears. Before escalating, it can help to have someone you
            trust take a second look — sometimes context (a joke account, an obvious parody, a
            low-effort edit) becomes clearer once the initial shock passes. This isn't about
            minimizing something genuinely harmful; it's about making sure your next steps are aimed
            at the actual situation, not the version of it that felt most alarming in the first
            thirty seconds.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Secure your own accounts</h2>
          <p>
            While you're working through the above, take a few minutes to check your own accounts —
            email, social media, anything connected to your identity. Deepfakes sometimes accompany
            account compromise or are created using material pulled from an account that's already
            been accessed without permission. Updating passwords and enabling multi-factor
            authentication where you haven't already is a small step that closes off one way the
            situation could get worse.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Report it through the platform's actual reporting channel
          </h2>
          <p>
            Most major platforms have specific policies against synthetic or manipulated media
            impersonating a real person, and a specific reporting category for it — which usually
            gets handled faster and more seriously than a generic "inappropriate content" report.
            Use the category that actually matches what happened (impersonation, synthetic media,
            non-consensual imagery, harassment) rather than the first option in the menu.
          </p>
          <p>
            If the content involves intimate or sexually explicit imagery — real or AI-generated —
            there are purpose-built tools for this specifically: StopNCII.org for adults, and the
            National Center for Missing &amp; Exploited Children's Take It Down tool if you were
            under 18 when the image was created. Both work by generating a digital fingerprint (a
            "hash") of the image on your own device — the image itself is never uploaded or seen by
            anyone — which participating platforms then use to detect and remove matching content.{" "}
            <Link
              to="/methodology"
              className="landing-link text-landing-ink"
            >
              Eterna's Verification Methodology
            </Link>{" "}
            covers documentation in more depth if you need it for a platform report or beyond.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Know that you're not required to prove a negative
          </h2>
          <ArticleCallout kind="matters">
            <p>
              One thing that trips people up: you don't need to "disprove" the deepfake before
              reporting it or asking for help. The burden isn't on you to produce forensic proof —
              platforms, and any investigator or legal counsel you involve later, are equipped to
              assess authenticity. Your job at this stage is to preserve what you found and report
              it through the right channel, not to build a technical case yourself.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When to bring in outside help
          </h2>
          <p>
            Most single-platform incidents can be handled by following the steps above. Outside help
            becomes more useful when the content is spreading across multiple platforms at once,
            when it's being used as part of a scam or extortion attempt, when you're a public figure
            or executive and the content is gaining traction quickly, or when you need evidence
            preserved and documented to a standard that would hold up if legal action becomes
            necessary. That's the point where professional monitoring and response — the kind that
            verifies findings against a clear standard before treating anything as confirmed, and
            escalates only with your authorization — tends to matter more than doing it alone.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What happens next</h2>
          <p>
            Once you've preserved evidence and reported it, the{" "}
            <Link
              to="/newsroom/impersonation-response-guide"
              className="landing-link text-landing-ink"
            >
              Impersonation Response Guide
            </Link>{" "}
            walks through the fuller sequence — documenting the case, deciding what to communicate
            and to whom, and monitoring for the content reappearing elsewhere, which does happen and
            isn't a sign that anything went wrong the first time.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Should I confront the person who posted it?
                </span>{" "}
                Not as a first step. Preserve evidence and report through the platform first — a
                direct confrontation before that can tip off the poster to remove or hide the
                content before you've documented it.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  What if I'm not sure whether it's actually a deepfake?
                </span>{" "}
                You don't need certainty before reporting something that impersonates you —
                platforms will assess it. A second, calmer look with someone you trust can also help
                before you escalate.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Will reporting it make the content spread further?
                </span>{" "}
                Reporting to a platform is private between you and the platform — it doesn't notify
                other users or draw attention to the content. Public commentary about it is what can
                inadvertently spread it further.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Can I make platforms remove it immediately?
                </span>{" "}
                Removal timelines vary by platform and by what policy the content violates. Using
                the correct, specific reporting category is the biggest factor you control in how
                quickly it gets reviewed.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation: <>StopNCII.org, "How StopNCII.org Works" (stopncii.org).</>,
              },
              {
                citation: (
                  <>
                    National Center for Missing &amp; Exploited Children, Take It Down FAQ
                    (takeitdown.ncmec.org).
                  </>
                ),
              },
              {
                citation: <>FBI Internet Crime Complaint Center, PSA I-060523-PSA (ic3.gov).</>,
              },
            ]}
          />

          <RelatedReading
            items={[
              {
                to: "/newsroom/impersonation-response-guide",
                title: "The Impersonation Response Guide",
                description: "What to do, in order, right after discovering impersonation.",
              },
              {
                to: "/methodology",
                title: "Eterna's Verification Methodology",
                description: "Why source context and corroboration matter before action.",
              },
              {
                to: "/newsroom/what-is-a-deepfake",
                title: "What Is a Deepfake and Why Is It Becoming a Reputation Problem?",
                description: "A plain-language explanation of what you're actually looking at.",
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
