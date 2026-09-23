import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Copy } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/fake-account-using-my-name-photos";
const PUBLISHED = "2026-09-19";
const TITLE = "What to Do When Someone Creates a Fake Account Using Your Name or Photos";
const DESCRIPTION =
  "Found a fake account using your name or photos? Here's how to tell what kind you're dealing with, document it, and report it the right way.";

export const Route = createFileRoute("/newsroom_/fake-account-using-my-name-photos")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Someone's Impersonating You Online — Here's What Helps" },
      {
        property: "og:description",
        content:
          "A fake account using your name or photos is common and usually addressable. Here's the sequence that actually works.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: FakeAccountPage,
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
          name: "Digital Identity",
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
          name: "Do I need to prove it's not me?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Usually not in a formal sense — platforms generally review impersonation reports based on the account's content and behavior, though reporting from your own established or verified account tends to speed up the process.",
          },
        },
        {
          "@type": "Question",
          name: "Should I message the fake account directly?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Generally, no. Document and report through the platform's impersonation category first, since direct engagement can tip off the account holder without speeding up removal.",
          },
        },
        {
          "@type": "Question",
          name: "What if the account is a parody account and clearly labeled as such?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Many platforms have separate policies for clearly labeled parody accounts, which are treated differently from accounts designed to deceive. If it's genuinely causing harm despite being labeled, it's still worth reporting.",
          },
        },
        {
          "@type": "Question",
          name: "How long does it typically take for a platform to act?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "This varies by platform and by how clearly the report demonstrates impersonation. There's no universal timeline, which is part of why documentation that makes the case clearly and quickly matters.",
          },
        },
      ],
    },
  ]);
}

function FakeAccountPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title={TITLE}
      intro={DESCRIPTION}
      breadcrumb={[
        { label: "Home", to: "/" as const },
        { label: "Newsroom", to: "/newsroom" as const },
        { label: "Digital Identity" },
        { label: TITLE },
      ]}
      category="Digital Identity"
      publishedDate={PUBLISHED}
      readTime="6-minute read"
      heroPlaceholder={{ icon: Copy, concept: "Genuine profile vs. impersonation" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A friend messages you a screenshot: an account using your name, your profile photo,
            maybe even a bio that sounds like something you'd write — except you never made it. It's
            already followed a few dozen people. Some of them think it's really you.
          </p>
          <p>
            A fake account is one of the more common forms of online impersonation, and unlike a
            deepfake video, it doesn't require any sophisticated technology — just your name and a
            few public photos. That makes it common, and also, in most cases, fairly straightforward
            to address once you know the sequence.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            First, figure out what kind of fake account you're dealing with
          </h2>
          <p>
            Not all impersonating accounts have the same intent, and that shapes the urgency of the
            response. Some are parody or fan accounts, sometimes clearly labeled, sometimes not —
            annoying but not necessarily malicious. Some are set up to deceive people into thinking
            they're interacting with you, sometimes to solicit money, sometimes just for attention.
            And some are set up specifically to damage your reputation — posting content designed to
            look like something you'd say or do, in order to embarrass or discredit you. The
            response is broadly similar across all three, but the urgency, and whether it warrants
            involving your network or a platform's more serious enforcement categories, depends on
            which one you're facing.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Document it before you do anything else
          </h2>
          <ArticleCallout kind="evidence">
            <p>
              Screenshot the account's profile, its posts, its follower or following list if
              relevant, and note the exact username and the date you found it. If the account is
              actively posting content, capture that too — accounts like this sometimes get deleted
              or renamed once the person behind them realizes they've been noticed, and
              documentation you don't capture now may not be recoverable later.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Report it through the platform's impersonation category specifically
          </h2>
          <p>
            Most major platforms have a specific policy against impersonation and a corresponding
            reporting category, separate from general harassment or spam reports. Using the correct
            category matters — impersonation reports are often reviewed under a different, faster
            process than generic content reports, particularly when you can demonstrate you're the
            real person being impersonated (which usually means reporting from your own verified or
            established account, if you have one).
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Consider whether your own network needs a heads-up
          </h2>
          <p>
            If the fake account has been messaging people you know, or if it's actively being
            mistaken for you, a brief, factual note to your own network — "this account is not me,
            I've reported it" — can prevent confusion or, in cases involving solicitation, prevent
            someone from being scammed. This doesn't need to be dramatic or defensive; a short,
            clear statement usually does the job.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common mistake is engaging directly with the fake account — commenting,
              messaging it, or publicly calling it out before reporting it through the proper
              channel. This can tip off whoever created it, and it doesn't actually speed up
              removal, which happens through the platform's review process regardless. A second
              mistake is assuming a fake account is harmless because it hasn't done anything overtly
              damaging yet. Accounts like this can sit dormant and then be activated later — for a
              scam, for harassment, for a coordinated attempt to damage your reputation — which is
              part of why documenting and reporting it early, rather than waiting to see what it
              does, is the more reliable approach. A third mistake, if the account is being used for
              solicitation or fraud, is not reporting it to the platform's fraud or financial-scam
              category in addition to impersonation — the two categories can trigger different
              review processes.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When professional help may be needed
          </h2>
          <p>
            Most single fake-account situations resolve through platform reporting alone. Outside
            help becomes more relevant when multiple accounts appear across several platforms at
            once, when the account is being used in an active scam targeting your actual contacts,
            or when it's connected to a broader pattern of impersonation or harassment that a single
            report doesn't fully address. The{" "}
            <Link
              to="/newsroom/impersonation-response-guide"
              className="landing-link text-landing-ink"
            >
              Impersonation Response Guide
            </Link>{" "}
            covers that broader pattern in more depth.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Do I need to prove it's not me?
                </span>{" "}
                Usually not in a formal sense — platforms generally review impersonation reports
                based on the account's content and behavior, though reporting from your own
                established or verified account tends to speed up the process.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Should I message the fake account directly?
                </span>{" "}
                Generally, no. Document and report through the platform's impersonation category
                first, since direct engagement can tip off the account holder without speeding up
                removal.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  What if the account is a parody account and clearly labeled as such?
                </span>{" "}
                Many platforms have separate policies for clearly labeled parody accounts, which are
                treated differently from accounts designed to deceive. If it's genuinely causing
                harm despite being labeled, it's still worth reporting.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  How long does it typically take for a platform to act?
                </span>{" "}
                This varies by platform and by how clearly the report demonstrates impersonation.
                There's no universal timeline, which is part of why documentation that makes the
                case clearly and quickly matters.
              </p>
            </div>
          </div>

          <RelatedReading
            items={[
              {
                to: "/newsroom/impersonation-response-guide",
                title: "The Impersonation Response Guide",
                description: "What to do, in order, right after discovering impersonation.",
              },
              {
                to: "/newsroom/someone-made-a-deepfake-of-me",
                title: "Someone Made a Deepfake of Me — What Should I Do?",
                description:
                  "The response sequence for a more sophisticated form of impersonation.",
              },
              {
                to: "/newsroom/false-allegations-online-what-to-do",
                title: "False Allegations Online: What Individuals and Businesses Should Do",
                description: "How to assess and respond when a fake account starts making claims.",
              },
              {
                to: "/ai-impersonation",
                title: "AI Impersonation Protection for Fake Profiles",
                description: "Eterna's response framework for fake accounts and copied photos.",
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
