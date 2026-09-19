import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL =
  "https://protectbyeterna.com/newsroom/threatened-to-publish-private-images-what-to-do";
const PUBLISHED = "2026-09-19";
const TITLE = "What to Do if Someone Threatens to Publish Your Private Images or Videos";
const DESCRIPTION =
  "If someone is threatening to publish private images or videos of you, here's what actually helps — before anything is posted, and why you shouldn't pay.";

export const Route = createFileRoute("/newsroom_/threatened-to-publish-private-images-what-to-do")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      {
        property: "og:title",
        content: "Being Threatened With Private Images? Here's What Helps.",
      },
      {
        property: "og:description",
        content:
          "Calm, practical steps for the moment someone threatens to publish private images or videos — before anything is posted.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: ThreatenedPublicationPage,
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
          name: "What if I already sent money before finding this guide?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Report it anyway, to the platform and to IC3.gov or local law enforcement. Having already complied once doesn't disqualify you from reporting or getting help, and it can still prevent further demands.",
          },
        },
        {
          "@type": "Question",
          name: "Should I respond to try to reason with them?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Generally no. Preserve the evidence you need, then stop engaging. Continued conversation tends to prolong the situation rather than resolve it.",
          },
        },
        {
          "@type": "Question",
          name: "Is it too soon to report if nothing has been posted yet?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Reporting a threat before anything is published is not premature — it's often the point where a platform or law enforcement can most effectively intervene.",
          },
        },
        {
          "@type": "Question",
          name: "What if the images they're threatening to share aren't real?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "AI-generated or fabricated images are increasingly used in exactly this kind of threat. Report it the same way regardless — the tools and reporting channels above cover both real and AI-generated content.",
          },
        },
      ],
    },
  ]);
}

function ThreatenedPublicationPage() {
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
      heroPlaceholder={{ icon: Clock, concept: "The pause before publication" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A message arrives: someone claims to have private images or video of you, and says
            they'll send it to your contacts, post it publicly, or send it to your school unless you
            pay, send more images, or do something else they're demanding. Nothing has been shared
            yet. The threat itself is the crisis.
          </p>
          <p>
            This specific moment — before anything has actually been published — is different from
            responding to content that's already circulating, and it comes with its own first steps.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            The images may not even be real
          </h2>
          <p>
            Sextortion attempts increasingly use AI-generated or manipulated images that were never
            real in the first place, built from ordinary photos pulled from social media. The FBI
            has specifically warned that malicious actors are creating this kind of fabricated
            content to threaten both adults and minors. This doesn't make the threat less serious —
            the harm from a convincing fake being published is real — but it matters for how you
            think about what's actually being threatened, and it's not something you can determine
            on your own in the moment. Don't assume, and don't try to figure it out by continuing to
            engage with whoever sent the message.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Do not pay, and do not send anything further
          </h2>
          <ArticleCallout kind="matters">
            <p>
              This is the single most important thing to know: complying with the demand — paying
              money, sending more images, doing anything else that's been asked — does not reliably
              stop the threat. The FBI's own guidance is direct that compliance offers no guarantee
              the material won't still be shared. In many documented cases, paying or complying
              leads to escalated demands, not fewer, because it confirms the person is willing to
              respond.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Preserve everything before you block
          </h2>
          <p>
            Before cutting off contact, take screenshots of the full conversation — the messages,
            the threat itself, the username or account, any images that were sent to you as "proof,"
            and the platform it's happening on. This is the evidence that a platform report, a
            school report, or law enforcement will need. Once you block the account, you may lose
            easy access to this, so capture it first.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Then stop responding</h2>
          <p>
            After you've preserved what you need, stop engaging. Don't negotiate, don't explain,
            don't ask them to reconsider. Continuing the conversation — even to argue or plead —
            tends to confirm you're paying attention and can prolong or escalate the demands rather
            than end them. Blocking the account after you've captured what you need is a reasonable
            next step for most people in this situation.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Report it — before anything is published, not after
          </h2>
          <p>
            You don't have to wait until something is actually posted to report it. Report the
            account and the messages to the platform, using its category for extortion, harassment
            or threats. Report the situation to the FBI's Internet Crime Complaint Center (IC3.gov),
            which specifically tracks this kind of extortion, or to local law enforcement. If you're
            a student, your school can also act on a report before anything is published — schools
            generally aren't limited to responding only after harm has occurred.
          </p>
          <p>
            If the person threatening you claims to already have real images, and you're under 18 or
            were when any real image was taken, the National Center for Missing &amp; Exploited
            Children's Take It Down tool can be used preemptively to help prevent circulation on
            participating platforms; if you're 18 or older, StopNCII.org works the same way. Both
            generate a fingerprint of an image on your own device without uploading the file itself.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Tell someone before you have to
          </h2>
          <p>
            Telling a trusted adult, friend or counselor before the situation escalates further —
            rather than after — means you have support in place if the threat continues, and it
            means you're not carrying the decision of what to do next entirely alone. This is true
            even if the threat turns out to be empty; there's no downside to having told someone you
            trust.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most damaging mistake is paying or complying on the belief that it will end the
              situation quickly and quietly. It frequently doesn't, and it can make the situation
              harder to walk back once a pattern of compliance has been established.
            </p>
            <p className="mt-3">
              A second mistake is staying silent out of fear that reporting will cause the content
              to be published faster, as a form of retaliation. Reporting to a platform or to law
              enforcement is not visible to the person making the threat, and involving authorities
              is specifically what response systems for this kind of extortion are built to handle.
            </p>
            <p className="mt-3">
              A third mistake is assuming nothing can be done until content is actually posted.
              Preserving evidence and reporting a threat while it's still just a threat is not
              premature — it's the point at which intervention is most likely to prevent the content
              from being published at all.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When outside help may be needed
          </h2>
          <p>
            If the threat is escalating, involves multiple accounts or platforms, or you're unsure
            how to navigate a school or law enforcement process alongside everything else, victim
            advocates and specialized support services exist specifically for this situation and can
            help you navigate the reporting and documentation process without requiring you to
            manage it alone.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  What if I already sent money before finding this guide?
                </span>{" "}
                Report it anyway, to the platform and to IC3.gov or local law enforcement. Having
                already complied once doesn't disqualify you from reporting or getting help, and it
                can still prevent further demands.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Should I respond to try to reason with them?
                </span>{" "}
                Generally no. Preserve the evidence you need, then stop engaging. Continued
                conversation tends to prolong the situation rather than resolve it.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Is it too soon to report if nothing has been posted yet?
                </span>{" "}
                No. Reporting a threat before anything is published is not premature — it's often
                the point where a platform or law enforcement can most effectively intervene.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  What if the images they're threatening to share aren't real?
                </span>{" "}
                AI-generated or fabricated images are increasingly used in exactly this kind of
                threat. Report it the same way regardless — the tools and reporting channels above
                cover both real and AI-generated content.
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
                to: "/newsroom/private-video-leak-online-blackmail-first-steps",
                title: "Private Video Leaks and Online Blackmail: What to Do First",
                description: "What helps first once a private video is already circulating.",
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
