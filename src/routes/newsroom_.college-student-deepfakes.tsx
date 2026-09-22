import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, School } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleSources } from "@/components/public/ArticleSources";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/college-student-deepfakes";
const PUBLISHED = "2026-09-19";
const TITLE = "Deepfakes Are Becoming a New Digital Safety Problem for College Students";
const DESCRIPTION =
  "Video deepfakes are showing up in student social circles — not because every campus faces this, but because the tools and source material have both become more accessible. Here's what to know.";

export const Route = createFileRoute("/newsroom_/college-student-deepfakes")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Video Deepfakes and Student Digital Safety" },
      {
        property: "og:description",
        content:
          "A calm, clear look at how and why fabricated video is showing up in student social circles — and what actually helps.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: CollegeStudentDeepfakesPage,
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
          name: "Is this happening at most colleges?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Not every campus experiences this, and it isn't an inevitable part of the college experience. The tools that make it possible have become more accessible, which is why the risk is worth understanding, not because it's already universal.",
          },
        },
        {
          "@type": "Question",
          name: "What if the video is clearly fake and everyone knows it?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "It can still cause real harm, and can resurface later without that context attached. Treat it seriously regardless of how convincing it looks.",
          },
        },
        {
          "@type": "Question",
          name: "Should I confront whoever made or shared it?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Preserve evidence and report it through the proper channel first. A direct confrontation before that can complicate documentation and, in a blackmail scenario, can escalate the situation.",
          },
        },
        {
          "@type": "Question",
          name: "Is this covered by any specific law?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "The federal TAKE IT DOWN Act covers AI-generated intimate imagery specifically; broader deepfake laws vary by state. This article is general information, not legal advice — legal options depend on jurisdiction and circumstances.",
          },
        },
      ],
    },
  ]);
}

function CollegeStudentDeepfakesPage() {
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
      readTime="6-minute read"
      heroPlaceholder={{ icon: School, concept: "Campus digital safety" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A student discovers that a video circulating in a group chat appears to show her saying
            something she never said, in a place she never was. It takes a moment for classmates to
            realize the video isn't real. By then, it's already been forwarded a dozen times.
          </p>
          <p>
            This kind of incident — a fabricated video, not a photo, specifically built to look and
            sound like a real person — is a distinct and growing part of student digital-safety
            conversations on campuses. It's worth understanding on its own terms, separate from the
            broader, equally serious issue of AI-generated still images, which{" "}
            <Link
              to="/newsroom/ai-generated-explicit-images-student-safety-guide"
              className="landing-link text-landing-ink"
            >
              AI-Generated Explicit Images Without Consent: A Student Safety Guide
            </Link>{" "}
            covers in its own depth.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why video deepfakes specifically are showing up on campuses
          </h2>
          <p>
            College campuses concentrate exactly the conditions that make video deepfakes easier to
            create and more likely to circulate widely: students constantly appear in each other's
            photos and videos, that footage is shared across group chats, social platforms and class
            projects, and the social graph of a campus — dorms, classes, clubs, social circles — is
            exactly the kind of tightly connected network that lets something spread to hundreds of
            people within a single day.
          </p>
          <p>
            None of this means every campus faces this problem, or that it's an inevitable part of
            college life. It means the tools that make convincing video fabrication possible have
            become more accessible at the same time that college social life generates an unusually
            large amount of exactly the source material — casual video, photos, voice recordings —
            those tools use.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What this usually looks like in practice
          </h2>
          <p>
            Student-targeted video deepfakes tend to follow a few recognizable patterns: a
            fabricated clip used to embarrass or humiliate someone within a social circle, often
            tied to a breakup, a falling-out or ongoing harassment; a video used as part of a
            blackmail attempt, sometimes combined with a real or fabricated claim about explicit
            content; or a doctored clip presented as "proof" of something false to damage someone's
            standing with friends, a romantic partner, or within a campus community.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why this is different from typical rumor-spreading
          </h2>
          <p>
            Rumors and gossip have always circulated on campuses, and most of it fades quickly
            because it's just words, easily doubted. A fabricated video changes that dynamic because
            video carries more default credibility than a spoken or written claim — people are
            inclined to believe what they see, even when, rationally, they know synthetic video
            exists. That gap between how much a video is trusted and how easy it now is to fabricate
            one is the core reason this deserves specific attention rather than being treated as a
            new version of an old problem.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What people commonly get wrong
          </h2>
          <ArticleCallout kind="mistake">
            <p>
              The most common mistake among students who encounter this is assuming that because
              "everyone knows it's not real," no real harm is being done. Even when a video is
              widely understood to be fabricated within a friend group, it can still resurface later
              — in a new context, to new people, or after enough time that the original
              clarification is forgotten — causing renewed harm long after the initial incident.
            </p>
            <p className="mt-3">
              A second common mistake is forwarding a deepfake, even with good intentions — to warn
              others, to show a resident advisor, to document it for later. Every forward creates
              another copy, in another chat, that's now outside anyone's control. It's far better to
              report through the platform or to a trusted adult directly than to keep sharing the
              file itself, even for a legitimate reason.
            </p>
            <p className="mt-3">
              A third mistake, particularly among adults responding to a report, is focusing first
              on how the video was made rather than on the person affected. The technical details
              matter eventually, but the immediate priority is the same as with any harassment
              incident: support the person, preserve the evidence, and get it in front of someone
              who can act on it.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">What to do</h2>
          <p>
            If you're a student who's found a deepfake of yourself or someone you know,{" "}
            <Link
              to="/newsroom/someone-made-a-deepfake-of-me"
              className="landing-link text-landing-ink"
            >
              Someone Made a Deepfake of Me — What Should I Do?
            </Link>{" "}
            covers the immediate first steps — preserve what you're seeing, don't forward it
            further, and report through the platform's specific policy for synthetic or
            impersonating media.
          </p>
          <p>
            If you're a parent, faculty member or administrator,{" "}
            <Link
              to="/student-digital-safety"
              className="landing-link text-landing-ink"
            >
              A Digital Safety Guide for Students in the Age of Generative AI
            </Link>{" "}
            is written specifically for that role.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            When outside help may be needed
          </h2>
          <p>
            Most single-incident cases can be handled through campus resources — a resident advisor,
            a Title IX office, campus security — combined with platform reporting. Outside help
            becomes more relevant when a video is spreading across multiple platforms
            simultaneously, when it's tied to a blackmail or extortion attempt, or when the evidence
            needs to be preserved and documented to a standard that could support a school
            disciplinary process or, in serious cases, a legal one.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">The broader context</h2>
          <ArticleCallout kind="matters">
            <p>
              Lawmakers have started responding directly to this category of harm. The federal TAKE
              IT DOWN Act, signed into law in 2025, criminalizes the distribution of non-consensual
              intimate imagery — explicitly including AI-generated "digital forgeries" — and
              requires platforms to build a process for removing reported content within 48 hours.
              Separately, a proposed measure such as the DEFIANCE Act of 2025 (S.1837) would create
              a federal civil right for victims of AI-generated intimate imagery to sue for damages;
              it is pending legislation, not yet enacted law, and its status should be confirmed
              before being cited as current. Neither of these is limited to students, but both
              reflect a recognition that this problem is real, current and serious enough to warrant
              a dedicated legal response — not a reason for alarm, but a sign that the response
              infrastructure is catching up.
            </p>
          </ArticleCallout>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Is this happening at most colleges?
                </span>{" "}
                Not every campus experiences this, and it isn't an inevitable part of the college
                experience. The tools that make it possible have become more accessible, which is
                why the risk is worth understanding, not because it's already universal.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  What if the video is clearly fake and everyone knows it?
                </span>{" "}
                It can still cause real harm, and can resurface later without that context attached.
                Treat it seriously regardless of how convincing it looks.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Should I confront whoever made or shared it?
                </span>{" "}
                Preserve evidence and report it through the proper channel first. A direct
                confrontation before that can complicate documentation and, in a blackmail scenario,
                can escalate the situation.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Is this covered by any specific law?
                </span>{" "}
                The federal TAKE IT DOWN Act covers AI-generated intimate imagery specifically;
                broader deepfake laws vary by state. This article is general information, not legal
                advice — legal options depend on jurisdiction and circumstances.
              </p>
            </div>
          </div>

          <ArticleSources
            sources={[
              {
                citation: (
                  <>
                    Congress.gov, CRS Legal Sidebar on the TAKE IT DOWN Act
                    (congress.gov/crs-product/LSB11314).
                  </>
                ),
              },
              {
                citation: (
                  <>
                    Congress.gov, S.1837, DEFIANCE Act of 2025, 119th Congress
                    (congress.gov/bill/119th-congress/senate-bill/1837) — a proposed bill, not yet
                    enacted law.
                  </>
                ),
              },
            ]}
            note="Legislative status current as of the article's last review; confirm before citing as enacted law."
          />

          <RelatedReading
            items={[
              {
                to: "/student-digital-safety",
                title: "A Digital Safety Guide for Students in the Age of Generative AI",
                description: "The pillar guide this article is part of.",
              },
              {
                to: "/student-digital-safety",
                title: "A Digital Safety Guide for Students in the Age of Generative AI",
                description: "The pillar guide this article is part of.",
              },
              {
                to: "/newsroom/someone-made-a-deepfake-of-me",
                title: "Someone Made a Deepfake of Me — What Should I Do?",
                description: "The immediate first steps for a student facing this directly.",
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
