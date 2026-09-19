import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, EyeOff } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL =
  "https://protectbyeterna.com/newsroom/ai-generated-explicit-images-student-safety-guide";
const PUBLISHED = "2026-09-19";
const TITLE = "AI-Generated Explicit Images Without Consent: A Student Safety Guide";
const DESCRIPTION =
  "Found out an AI-generated explicit image of you or someone you know is circulating? Here's what actually helps — calmly, in order, without judgment.";

export const Route = createFileRoute(
  "/newsroom_/ai-generated-explicit-images-student-safety-guide",
)({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "You Are Not Alone in This — What to Do Next" },
      {
        property: "og:description",
        content:
          "A calm, practical guide for students facing a non-consensual AI-generated image — what to do first, and where to get real help.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: ExplicitImagesGuidePage,
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
          name: "Is this actually illegal if the image is AI-generated and not a real photo?",
          acceptedAnswer: {
            "@type": "Answer",
            text: 'The federal TAKE IT DOWN Act specifically covers AI-generated "digital forgeries" alongside authentic non-consensual images, and a number of states have their own laws as well. Exact legal treatment depends on jurisdiction; this is general information, not legal advice.',
          },
        },
        {
          "@type": "Question",
          name: "Do I have to show the image to someone to get help?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Both the Take It Down tool and StopNCII.org work by generating a fingerprint of the image on your own device — you never have to upload or send the actual file to get it removed from participating platforms.",
          },
        },
        {
          "@type": "Question",
          name: "What if I don't know who made it?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "You can still use the reporting tools and, where relevant, involve law enforcement, without knowing who created the image. Identifying the source is a separate step from getting the content removed and reported.",
          },
        },
        {
          "@type": "Question",
          name: "Should I respond to whoever is sharing it or confront them?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Generally, no — preserve evidence and report through the proper channels first. If there's any threat or extortion attempt involved, direct engagement can make things harder to resolve safely.",
          },
        },
      ],
    },
  ]);
}

function ExplicitImagesGuidePage() {
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
      readTime="8-minute read"
      heroPlaceholder={{ icon: EyeOff, concept: "A supportive response path" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A student finds out that an image has been circulating — one that appears to show her
            without clothing, made using a photo she actually posted, altered by an AI tool into
            something that never happened. She never took the picture being used for this. She may
            not even know who made it.
          </p>
          <p>
            If this is happening to you, or to someone you're trying to help, the first thing worth
            saying clearly: this is not your fault, and it isn't caused by anything you posted,
            wore, or did. What follows is what actually helps, in order, without requiring you to
            relive or describe what happened beyond what's necessary to get it addressed.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            You don't have to handle this alone
          </h2>
          <p>
            Before anything else: finding a trusted adult, friend, school counselor or advocate to
            involve is not a step to skip, even if the instinct is to handle it privately.
            Non-consensual intimate imagery — including AI-generated images — is specifically
            covered by dedicated reporting tools and, in many cases, by criminal law. You are not
            overreacting by treating this seriously, and you are not required to manage it by
            yourself.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Preserve what you can, without re-sharing it
          </h2>
          <p>
            If you're able to safely do so, note where you saw the image — the platform, the account
            or username, the date — without downloading, forwarding or re-sharing the image further,
            even to "prove" what happened to someone else. Every additional copy, even a
            well-intentioned one, adds another version of the file in circulation. If a trusted
            adult or a school official needs to see it to act, let them access it directly through
            the original source or through an official reporting process, rather than you sending
            the file yourself.
          </p>
          <p>
            A screenshot of the surrounding context — the post caption, the account name, the
            platform, the date — is usually enough to support a report without needing to preserve
            the image itself in a way that creates more copies.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Use the purpose-built removal tools
          </h2>
          <ArticleCallout kind="steps">
            <p>
              Two free tools exist specifically for this situation, and neither requires uploading
              the actual image anywhere.
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-landing-ink">
                  If you're under 18, or you were under 18 when the image was created:
                </span>{" "}
                the National Center for Missing &amp; Exploited Children's Take It Down tool lets
                you generate a digital fingerprint (a "hash") of the image directly on your own
                device. The image itself never leaves your device or gets uploaded anywhere — only
                the fingerprint is submitted. Participating platforms use that fingerprint to find
                and remove matching content from their public services.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">If you're 18 or older:</span>{" "}
                StopNCII.org works the same way — a hash is generated on your device, the image
                never leaves it, and participating platforms use the fingerprint to detect and
                remove matches.
              </li>
            </ul>
            <p className="mt-3">
              Both tools have a real limitation worth knowing upfront: they only work on
              participating platforms, and they can't guarantee removal from every site on the
              internet. That doesn't make them not worth using — it means they're one important part
              of the response, not the entire answer.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Report it to the platform directly, using the right category
          </h2>
          <p>
            Alongside the hash-matching tools, report the content directly to whatever platform it's
            on, using the specific category for non-consensual or synthetic intimate imagery rather
            than a generic report — major platforms treat this category with more urgency and are
            legally required, under the federal TAKE IT DOWN Act, to provide a way to request
            removal and to act on valid requests within 48 hours.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Tell your school</h2>
          <p>
            If you're a student, your school's Title IX office or student conduct office can act on
            this — both to support you directly and, where appropriate, to address it through the
            school's own disciplinary process, separate from any law enforcement involvement.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When to involve law enforcement
          </h2>
          <p>
            Creating or distributing AI-generated intimate imagery of a real, identifiable person
            without consent is addressed by the federal TAKE IT DOWN Act, and by a growing number of
            state laws, though exact legal treatment varies by jurisdiction and by the ages of the
            people involved — this is general information, not legal advice, and a local advocate or
            attorney can speak to your specific situation. If someone is using the image to
            threaten, extort or coerce you, that's a matter for law enforcement, and{" "}
            <Link
              to="/newsroom/threatened-to-publish-private-images-what-to-do"
              className="landing-link text-landing-ink"
            >
              What to Do if Someone Threatens to Publish Your Private Images or Videos
            </Link>{" "}
            covers that specific situation, including why you should never make a payment in
            response to a threat like this.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common and damaging misconception is that because the image is "fake" — not a
              real photo — it's somehow a lesser harm, or not worth a serious response. The
              emotional and reputational impact of a convincing AI-generated image can be just as
              real as that of an authentic one, and the tools and laws responding to this treat it
              accordingly.
            </p>
            <p className="mt-3">
              Another common mistake, usually made with good intentions by friends or classmates, is
              sharing the image further to warn others or to "show proof" of what's happening. This
              adds circulation rather than reducing it. Reporting through the proper channel, not
              sharing the file itself, is what actually helps.
            </p>
            <p className="mt-3">
              A third mistake is assuming that because a first report to one platform didn't lead to
              immediate removal, nothing more can be done. Using both the hash-matching tools and a
              school or law enforcement report significantly increases the number of ways the
              content can actually be found and removed across different platforms.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Supporting someone else through this
          </h2>
          <p>
            If someone has come to you about this — as a friend, parent, teacher or counselor — the
            most useful things you can offer are believing them without requiring them to explain or
            justify anything, helping them access the reporting tools above rather than trying to
            handle it entirely yourself, and not asking to see the image, which isn't necessary for
            you to be genuinely helpful.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When outside help may be needed
          </h2>
          <p>
            Most single-platform incidents can be addressed through the tools and reporting channels
            above. Outside help — from an advocate, an attorney, or a specialized response service —
            becomes more important when the content is spreading across multiple platforms at once,
            when it's connected to an extortion attempt, or when the evidence needs to be documented
            and preserved to a standard that would support a school or legal process.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Is this actually illegal if the image is AI-generated and not a real photo?
                </span>{" "}
                The federal TAKE IT DOWN Act specifically covers AI-generated "digital forgeries"
                alongside authentic non-consensual images, and a number of states have their own
                laws as well. Exact legal treatment depends on jurisdiction; this is general
                information, not legal advice.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Do I have to show the image to someone to get help?
                </span>{" "}
                No. Both the Take It Down tool and StopNCII.org work by generating a fingerprint of
                the image on your own device — you never have to upload or send the actual file to
                get it removed from participating platforms.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  What if I don't know who made it?
                </span>{" "}
                You can still use the reporting tools and, where relevant, involve law enforcement,
                without knowing who created the image. Identifying the source is a separate step
                from getting the content removed and reported.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Should I respond to whoever is sharing it or confront them?
                </span>{" "}
                Generally, no — preserve evidence and report through the proper channels first. If
                there's any threat or extortion attempt involved, direct engagement can make things
                harder to resolve safely.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation: (
                  <>
                    National Center for Missing &amp; Exploited Children, Take It Down
                    (takeitdown.ncmec.org).
                  </>
                ),
              },
              {
                citation: <>StopNCII.org, How It Works (stopncii.org).</>,
              },
              {
                citation: (
                  <>
                    Congress.gov, CRS Legal Sidebar on the TAKE IT DOWN Act
                    (congress.gov/crs-product/LSB11314).
                  </>
                ),
              },
            ]}
          />

          <RelatedReading
            items={[
              {
                to: "/student-digital-safety",
                title: "A Digital Safety Guide for Students in the Age of Generative AI",
                description: "The pillar guide this article is part of.",
              },
              {
                to: "/newsroom/private-video-leak-online-blackmail-first-steps",
                title: "Private Video Leaks and Online Blackmail: What to Do First",
                description: "What helps first when leaked content is being used to threaten you.",
              },
              {
                to: "/newsroom/threatened-to-publish-private-images-what-to-do",
                title: "What to Do if Someone Threatens to Publish Your Private Images or Videos",
                description: "First steps for the moment before anything has been published.",
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
