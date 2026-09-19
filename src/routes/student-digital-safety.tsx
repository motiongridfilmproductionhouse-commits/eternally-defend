import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Workflow } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/student-digital-safety";
const PUBLISHED = "2026-09-19";
const TITLE = "A Digital Safety Guide for Students in the Age of Generative AI";
const DESCRIPTION =
  "Generative AI has changed how images, video and rumors can be used against students. A clear guide to the landscape — and where to go for your specific situation.";

export const Route = createFileRoute("/student-digital-safety")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Student Digital Safety in the Age of Generative AI" },
      {
        property: "og:description",
        content:
          "A calm, clear map of how generative AI has changed student digital safety — and the response steps that apply across every situation.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: StudentDigitalSafetyPage,
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
        { "@type": "ListItem", position: 3, name: TITLE, item: CANONICAL },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Is this happening at most schools?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Not every school or every student experiences this, and none of it is an inevitable part of student life. The tools that make it possible have become more accessible, which is why understanding the landscape is worth doing before it's needed.",
          },
        },
        {
          "@type": "Question",
          name: "What's the single most important first step, regardless of category?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Preserve evidence before you react publicly or delete anything, and avoid re-sharing the content further, even with good intentions.",
          },
        },
        {
          "@type": "Question",
          name: "Should I always involve law enforcement?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Not always — many situations are appropriately handled through school reporting channels and platform reports. Law enforcement becomes more relevant when there's a credible legal violation, an active threat, or extortion involved.",
          },
        },
        {
          "@type": "Question",
          name: "Where should I start if I'm not sure which category applies to my situation?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Start with whichever description below feels closest, and follow its linked guide — most of the immediate first steps (preserve, don't re-share, report, get support) apply regardless of the exact category.",
          },
        },
      ],
    },
  ]);
}

function StudentDigitalSafetyPage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide · Student Digital Safety pillar"
      title={TITLE}
      intro={DESCRIPTION}
      breadcrumb={[
        { label: "Home", to: "/" as const },
        { label: "Newsroom", to: "/newsroom" as const },
        { label: TITLE },
      ]}
      category="Student Digital Safety (pillar)"
      publishedDate={PUBLISHED}
      readTime="11-minute read"
      heroPlaceholder={{ icon: Workflow, concept: "The student safety landscape" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A decade ago, the digital-safety conversation on campus was mostly about privacy
            settings and cyberbullying. Both still matter. But generative AI has added a new layer:
            it's now possible to fabricate a convincing image, video or voice recording of a real,
            identifiable student — without their knowledge, using nothing more than photos they've
            already posted — and to do it in minutes, at effectively no cost.
          </p>
          <p>
            This guide is a starting point for understanding that landscape: what's actually
            changed, what the common patterns of harm look like, and where to go for the specific
            situation you or someone you know is facing. It's not meant to suggest every campus
            faces every one of these problems, or that any of this is inevitable. It's meant to make
            the landscape legible, so that if something does happen, you already know roughly where
            to start.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What's actually new here</h2>
          <p>
            Misuse of images, rumor-spreading and harassment among students are not new problems.
            What's changed is what generative AI has added to each of them.
          </p>
          <p>
            <span className="font-semibold text-landing-ink">
              Fabrication has replaced editing.
            </span>{" "}
            A convincing fake no longer requires real footage or images of the actual event being
            depicted — it can be generated from scratch, based on patterns learned from ordinary
            photos.
          </p>
          <p>
            <span className="font-semibold text-landing-ink">
              The barrier to entry has dropped sharply.
            </span>{" "}
            Tools that once required technical skill are now widely accessible, which means the
            population capable of creating this kind of content is far larger than it used to be.
          </p>
          <p>
            <span className="font-semibold text-landing-ink">Source material is abundant.</span>{" "}
            Students photograph and video each other constantly, and share it across group chats,
            social platforms and class projects — all of which can serve as training material
            without anyone involved realizing it.
          </p>
          <p>
            None of this means the underlying human behavior — the impulse to embarrass, harass,
            blackmail or spread rumors about someone — is new. It means the tools available to act
            on that impulse have become significantly more powerful and more accessible.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            The landscape, in categories
          </h2>
          <div className="space-y-5">
            <p>
              <span className="font-semibold text-landing-ink">
                Deepfakes and manipulated video.
              </span>{" "}
              Fabricated video built to look like a real person saying or doing something they
              didn't.{" "}
              <Link
                to="/newsroom/college-student-deepfakes"
                className="landing-link text-landing-ink"
              >
                Deepfakes Are Becoming a New Digital Safety Problem for College Students
              </Link>{" "}
              covers this pattern specifically.
            </p>
            <p>
              <span className="font-semibold text-landing-ink">AI-generated explicit images.</span>{" "}
              Non-consensual sexualized images generated using a real person's photo as a starting
              point.{" "}
              <Link
                to="/newsroom/ai-generated-explicit-images-student-safety-guide"
                className="landing-link text-landing-ink"
              >
                AI-Generated Explicit Images Without Consent: A Student Safety Guide
              </Link>{" "}
              is the direct, urgent-help guide for this situation.
            </p>
            <p>
              <span className="font-semibold text-landing-ink">
                Fake accounts and impersonation.
              </span>{" "}
              An account created using someone's name, photos or likeness without their permission,
              sometimes to embarrass them, sometimes to deceive others into thinking it's really
              them. See{" "}
              <Link
                to="/newsroom/fake-account-using-my-name-photos"
                className="landing-link text-landing-ink"
              >
                What to Do When Someone Creates a Fake Account Using Your Name or Photos
              </Link>
              .
            </p>
            <p>
              <span className="font-semibold text-landing-ink">Blackmail and threats.</span> Threats
              to publish real or fabricated intimate content unless the target pays, sends more
              content, or complies with some other demand.{" "}
              <Link
                to="/newsroom/threatened-to-publish-private-images-what-to-do"
                className="landing-link text-landing-ink"
              >
                What to Do if Someone Threatens to Publish Your Private Images or Videos
              </Link>{" "}
              covers this directly — and the single most important thing to know is that paying or
              complying does not reliably make it stop.
            </p>
            <p>
              <span className="font-semibold text-landing-ink">Leaked private content.</span> Real
              images or video, originally shared privately or intended to stay private, distributed
              without consent.{" "}
              <Link
                to="/newsroom/private-video-leak-online-blackmail-first-steps"
                className="landing-link text-landing-ink"
              >
                Private Video Leaks and Online Blackmail: What to Do First
              </Link>{" "}
              covers the immediate response.
            </p>
            <p>
              <span className="font-semibold text-landing-ink">
                Cyberbullying and harassment campaigns.
              </span>{" "}
              Coordinated or repeated harassment, sometimes using real content, sometimes
              fabricated, often amplified by group chats and social platforms designed for fast
              sharing.
            </p>
            <p>
              <span className="font-semibold text-landing-ink">False allegations.</span> Fabricated
              claims — sometimes paired with manipulated "evidence" — designed to damage someone's
              standing with friends, a partner, or a broader community. See{" "}
              <Link
                to="/newsroom/false-allegations-online-what-to-do"
                className="landing-link text-landing-ink"
              >
                False Allegations Online: What Individuals and Businesses Should Do
              </Link>
              .
            </p>
            <p>
              <span className="font-semibold text-landing-ink">Viral reposting.</span> The mechanism
              that turns a single incident into a sustained problem: once something is screenshotted
              and reshared across multiple chats and platforms, no single deletion resolves it. See{" "}
              <Link
                to="/newsroom/deepfake-reuploads-after-removal"
                className="landing-link text-landing-ink"
              >
                Deepfake Reuploads: Why Harmful Content Can Return After Removal
              </Link>
              .
            </p>
          </div>
          <p>
            These categories overlap in practice — a fake account might be used to spread a
            fabricated image, which then gets used in a blackmail attempt. Real incidents rarely fit
            neatly into one box, which is part of why a general understanding of the landscape helps
            more than memorizing a single response for a single scenario.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            The response arc that applies across all of these
          </h2>
          <ArticleCallout kind="steps" label="The response arc">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <span className="font-semibold text-landing-ink">Recognize</span> what you're
                looking at without assuming the worst-case interpretation immediately, and without
                assuming it's "not a big deal" either.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">Preserve</span> evidence —
                screenshots, URLs, usernames, timestamps — before content potentially disappears,
                and before you block or delete anything.{" "}
                <Link
                  to="/newsroom/how-to-preserve-deepfake-evidence"
                  className="landing-link text-landing-ink"
                >
                  How to Preserve Evidence When You Discover a Deepfake
                </Link>{" "}
                goes deeper on documentation.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">Avoid re-sharing</span>, even with
                good intentions — every forward, including a forward meant to warn others, creates
                another copy outside anyone's control.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">Report</span> through the
                platform's specific policy category, and through your school's actual reporting
                channel — not just informally to friends.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">Get support</span> from a trusted
                adult, counselor or advocate. This is not a step to skip in favor of handling it
                alone, and asking for help is not an overreaction.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">Escalate when appropriate</span> —
                to law enforcement, if there's a credible legal violation or an active threat, or to
                a specialized response service if the situation is spreading across multiple
                platforms or your school's process isn't proving to be enough.
              </li>
            </ul>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            A note for parents and educators
          </h2>
          <p>
            If you're a parent, the instinct to immediately take over can be strong — but a student
            who feels heard and supported, rather than managed, tends to engage with the response
            process more openly. If you're faculty or administration,{" "}
            <Link
              to="/newsroom/how-colleges-respond-to-deepfake-abuse"
              className="landing-link text-landing-ink"
            >
              How Colleges Can Respond to Deepfake and Synthetic Media Abuse
            </Link>{" "}
            lays out a practical institutional framework: prevention, reporting, evidence
            preservation, student support, platform response, escalation and continuous education.
          </p>
          <p>
            None of this — for students, parents or institutions — is a substitute for law
            enforcement, legal counsel, or professional mental-health and safeguarding support when
            a situation calls for it. The guidance across this cluster is meant to help you get to
            the right resource faster, not to replace it.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common mistake, across nearly every category above, is assuming that because
              something is technically "fake" or "just online," it's a lesser harm than something
              that happened in person. The emotional and reputational impact of a convincing
              fabrication, or a widely circulated rumor, is real regardless of how it was made. A
              second common mistake is delaying action out of embarrassment or the hope a situation
              will resolve itself — evidence is easiest to preserve immediately.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Where to go next</h2>
          <p>
            If something specific has already happened, the fastest path is the article that matches
            your exact situation — the categories above link directly to each one. If you're here to
            understand the landscape before anything has happened, that awareness is itself useful:
            knowing the categories, the response arc, and where to go is most of what preparation
            actually looks like.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Is this happening at most schools?
                </span>{" "}
                Not every school or every student experiences this, and none of it is an inevitable
                part of student life. The tools that make it possible have become more accessible,
                which is why understanding the landscape is worth doing before it's needed.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  What's the single most important first step, regardless of category?
                </span>{" "}
                Preserve evidence before you react publicly or delete anything, and avoid re-sharing
                the content further, even with good intentions.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Should I always involve law enforcement?
                </span>{" "}
                Not always — many situations are appropriately handled through school reporting
                channels and platform reports. Law enforcement becomes more relevant when there's a
                credible legal violation, an active threat, or extortion involved.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Where should I start if I'm not sure which category applies to my situation?
                </span>{" "}
                Start with whichever description above feels closest, and follow its linked guide.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation:
                  "National Center for Missing & Exploited Children, Take It Down (takeitdown.ncmec.org)",
              },
              { citation: "StopNCII.org, How It Works (stopncii.org)" },
              {
                citation:
                  "Congress.gov, CRS Legal Sidebar on the TAKE IT DOWN Act (congress.gov/crs-product/LSB11314)",
              },
            ]}
          />

          <RelatedReading
            heading="Every guide in this cluster"
            items={[
              {
                to: "/newsroom/college-student-deepfakes",
                title: "Deepfakes Are Becoming a New Digital Safety Problem for College Students",
                description: "How and why fabricated video shows up in student social circles.",
              },
              {
                to: "/newsroom/ai-generated-explicit-images-student-safety-guide",
                title: "AI-Generated Explicit Images Without Consent: A Student Safety Guide",
                description: "Calm, practical steps — without judgment.",
              },
              {
                to: "/newsroom/private-video-leak-online-blackmail-first-steps",
                title: "Private Video Leaks and Online Blackmail: What to Do First",
                description: "Why paying rarely makes it stop, and what helps instead.",
              },
              {
                to: "/newsroom/threatened-to-publish-private-images-what-to-do",
                title: "What to Do if Someone Threatens to Publish Your Private Images or Videos",
                description:
                  "Steps for the pre-publication moment, while intervention still helps.",
              },
              {
                to: "/newsroom/how-colleges-respond-to-deepfake-abuse",
                title: "How Colleges Can Respond to Deepfake and Synthetic Media Abuse",
                description: "A seven-stage institutional framework.",
              },
              {
                to: "/newsroom/impersonation-response-guide",
                title: "The Impersonation Response Guide",
                description:
                  "The general procedural hand-off once you've identified what happened.",
              },
            ]}
          />

          <ArticleCta
            text="Institutions building a student digital-safety response process can start a conversation with Eterna"
            to="/contact"
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
