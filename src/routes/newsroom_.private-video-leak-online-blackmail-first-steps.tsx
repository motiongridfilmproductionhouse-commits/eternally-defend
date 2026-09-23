import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertOctagon, ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL =
  "https://protectbyeterna.com/newsroom/private-video-leak-online-blackmail-first-steps";
const PUBLISHED = "2026-09-19";
const TITLE = "Private Video Leaks and Online Blackmail: What to Do First";
const DESCRIPTION =
  "If a private video has been leaked and someone is using it to threaten you, here's what actually helps first — and why paying rarely makes it stop.";

export const Route = createFileRoute("/newsroom_/private-video-leak-online-blackmail-first-steps")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "A Private Video Was Leaked — Here's What Helps First" },
      {
        property: "og:description",
        content:
          "Calm, practical first steps if a private video has been shared without your consent and is being used to threaten you.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: PrivateVideoLeakPage,
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
          name: "Student Digital Safety",
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
          name: "Should I pay to make it stop?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. The FBI's own guidance is explicit that complying with a demand doesn't guarantee the content won't still be shared. Paying also doesn't address copies that may already exist beyond whoever is making the demand.",
          },
        },
        {
          "@type": "Question",
          name: "What if I already sent money or more content?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Report it anyway. What's already happened doesn't disqualify you from getting help now, and reporting can still stop further demands and support removal of the content.",
          },
        },
        {
          "@type": "Question",
          name: "Do I have to know who's doing this to get help?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. You can report and use removal tools without knowing who's responsible — identifying them is a separate process that platforms and law enforcement can pursue.",
          },
        },
        {
          "@type": "Question",
          name: "Is this a police matter or a school matter?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Often both, and they're not mutually exclusive. If you're a student, your school can act through its own process regardless of whether you also involve law enforcement.",
          },
        },
      ],
    },
  ]);
}

function PrivateVideoLeakPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title={TITLE}
      intro={DESCRIPTION}
      breadcrumb={[
        { label: "Home", to: "/" as const },
        { label: "Newsroom", to: "/newsroom" as const },
        { label: "Student Digital Safety" },
        { label: TITLE },
      ]}
      category="Student Digital Safety"
      publishedDate={PUBLISHED}
      readTime="7-minute read"
      heroPlaceholder={{ icon: AlertOctagon, concept: "Evidence, then action" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A video meant to stay private is suddenly not private anymore — shared without
            permission, and now someone is using it as leverage: send money, send more images, do
            what they ask, or they'll share it further.
          </p>
          <p>
            If this is happening to you right now, the single most important thing to know is this:
            paying, or complying with what's being demanded, does not reliably make it stop. The
            FBI's own guidance on this is direct — compliance does not guarantee the material won't
            still be shared. What follows is what actually helps, without requiring you to negotiate
            with whoever is doing this.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            You are not the one who did something wrong
          </h2>
          <p>
            Whoever leaked the video or is using it to threaten you is responsible for that — not
            you. That's true regardless of how the video originally came to exist, who it was
            originally shared with, or any circumstances around it. This matters because shame is
            exactly what keeps people from reporting and getting help quickly, which is often what
            the person doing this is counting on.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Stop engaging with the person threatening you
          </h2>
          <p>
            If someone is actively threatening you, the instinct to negotiate, plead, or try to
            reason with them is completely understandable — and it's usually not effective. People
            running this kind of extortion are frequently running the same script against many
            people at once; engaging tends to confirm that you're reachable and responsive, which
            can invite more demands rather than fewer. This doesn't mean deleting the conversation —
            it's evidence — it means not continuing to respond while you take the steps below.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Preserve the evidence</h2>
          <ArticleCallout kind="evidence">
            <p>
              Before blocking anyone or deleting anything, capture what you can: screenshots of the
              messages or posts, the account names or usernames involved, any links, and the dates
              and times. If a payment was demanded, note the amount and the method, even if you
              haven't paid and don't intend to. This documentation is what a platform, an
              investigator, or law enforcement will actually need — and it's much harder to
              reconstruct later than to capture now.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Use the tools built for this specifically
          </h2>
          <p>
            If the content involves intimate or sexually explicit imagery — real or AI-generated —
            there are free tools designed exactly for this, and neither requires uploading the
            actual file anywhere. If you were under 18 when the image or video was created, the
            National Center for Missing &amp; Exploited Children's Take It Down tool generates a
            digital fingerprint on your own device — the file itself never leaves your device —
            which participating platforms use to find and remove matches. If you're 18 or older,
            StopNCII.org works the same way. Both have a real limitation worth knowing: they only
            cover participating platforms and can't guarantee removal everywhere, which is why
            they're one part of the response, not the whole of it.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Report it — to the platform, and to the right authority
          </h2>
          <p>
            Report the content to the platform it's on, using the specific category for
            non-consensual imagery or extortion rather than a generic report. Separately, report the
            situation to the FBI's Internet Crime Complaint Center (IC3.gov) if extortion or threats
            are involved, or to local law enforcement. If you're a student, your school's Title IX
            office can also act, independent of any law enforcement process. None of these reports
            require you to have already resolved the situation yourself — that's the point of
            reporting.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Tell someone you trust</h2>
          <p>
            This doesn't have to be handled entirely alone, and it's genuinely harder to think
            clearly and act quickly while also carrying it by yourself. A parent, a trusted friend,
            a school counselor, or a crisis line can help you think through next steps and won't
            require you to relive every detail to be useful to you.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most costly mistake is paying, or sending additional content, believing it will
              end the demands. It frequently doesn't — it can signal that further demands will also
              be paid, and it does nothing to address content that may already be saved or shared
              elsewhere.
            </p>
            <p className="mt-3">
              A second mistake is waiting to report because the situation feels embarrassing or
              because there's hope it will just go away on its own. Evidence is easiest to preserve
              immediately, and platforms and investigators can often act faster the earlier they're
              involved.
            </p>
            <p className="mt-3">
              A third mistake is trying to identify or confront the person responsible directly,
              especially by engaging further to "figure out who they are." That's a job for a
              platform's investigation team or law enforcement, who have tools and legal authority
              that direct engagement doesn't give you.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What outside help looks like
          </h2>
          <p>
            Beyond the platform tools and law enforcement, specialized support exists specifically
            for this situation — crisis lines, victim advocates, and services that help preserve and
            document evidence in a way that supports a platform report or a legal process. This kind
            of help becomes especially relevant when content is spreading across multiple platforms,
            when a threat is escalating, or when you need help navigating a school or legal process
            on top of everything else.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Should I pay to make it stop?
                </span>{" "}
                No. The FBI's own guidance is explicit that complying with a demand doesn't
                guarantee the content won't still be shared. Paying also doesn't address copies that
                may already exist beyond whoever is making the demand.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  What if I already sent money or more content?
                </span>{" "}
                Report it anyway. What's already happened doesn't disqualify you from getting help
                now, and reporting can still stop further demands and support removal of the
                content.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Do I have to know who's doing this to get help?
                </span>{" "}
                No. You can report and use removal tools without knowing who's responsible —
                identifying them is a separate process that platforms and law enforcement can
                pursue.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Is this a police matter or a school matter?
                </span>{" "}
                Often both, and they're not mutually exclusive. If you're a student, your school can
                act through its own process regardless of whether you also involve law enforcement.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation: <>FBI Internet Crime Complaint Center, PSA I-060523-PSA (ic3.gov).</>,
              },
              {
                citation: (
                  <>
                    National Center for Missing &amp; Exploited Children, Take It Down
                    (takeitdown.ncmec.org).
                  </>
                ),
              },
              {
                citation: <>StopNCII.org.</>,
              },
            ]}
          />

          <RelatedReading
            items={[
              {
                to: "/newsroom/threatened-to-publish-private-images-what-to-do",
                title: "What to Do if Someone Threatens to Publish Your Private Images or Videos",
                description: "First steps for the moment before anything has been published.",
              },
              {
                to: "/newsroom/ai-generated-explicit-images-student-safety-guide",
                title: "AI-Generated Explicit Images Without Consent: A Student Safety Guide",
                description: "What helps when a non-consensual AI-generated image is circulating.",
              },
              {
                to: "/student-digital-safety",
                title: "A Digital Safety Guide for Students in the Age of Generative AI",
                description: "The pillar guide this article is part of.",
              },
              {
                to: "/online-reputation-protection",
                title: "Online Reputation Protection",
                description:
                  "Evidence-led response for content that threatens someone's standing online.",
              },
            ]}
          />

          <ArticleCta
            text="Explore Eterna's digital safety and identity protection resources"
            to="/student-digital-safety"
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
