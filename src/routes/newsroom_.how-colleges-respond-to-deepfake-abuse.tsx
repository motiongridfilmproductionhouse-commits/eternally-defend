import { createFileRoute, Link } from "@tanstack/react-router";
import { School } from "lucide-react";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { ArticleCta } from "@/components/public/ArticleCta";
import { PublicPage } from "@/components/public/PublicSite";
import { RelatedReading } from "@/components/public/RelatedReading";

const CANONICAL = "https://protectbyeterna.com/newsroom/how-colleges-respond-to-deepfake-abuse";
const PUBLISHED = "2026-09-20";
const TITLE = "How Colleges Can Respond to Deepfake and Synthetic Media Abuse";
const DESCRIPTION =
  "A practical institutional framework for colleges responding to deepfake abuse: prevention, reporting, evidence, support, review and follow-through.";

export const Route = createFileRoute("/newsroom_/how-colleges-respond-to-deepfake-abuse")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: CollegeResponsePage,
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
  ]);
}

function CollegeResponsePage() {
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
      heroPlaceholder={{ icon: School, concept: "Institutional response" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A college does not need to assume every student is at risk to prepare for a deepfake
            incident. It needs a clear path for receiving a report, preserving evidence, supporting
            the affected student and coordinating the right people without spreading the material
            further.
          </p>
          <ArticleCallout kind="steps" label="A seven-stage response arc">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Receive the report privately and acknowledge the person affected.</li>
              <li>Preserve source context, URLs, timestamps and platform details.</li>
              <li>Assess immediate safety, threats, extortion and disclosure risk.</li>
              <li>Coordinate student support, conduct, legal and communications roles.</li>
              <li>Report through the platform's specific policy pathway.</li>
              <li>Communicate only what is verified and necessary.</li>
              <li>Review recurrence, copies and lessons after the initial response.</li>
            </ol>
          </ArticleCallout>
          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Start with support and containment
          </h2>
          <p>
            The first institutional interaction shapes whether a student continues to seek help.
            Avoid asking them to forward the content to multiple offices or to repeatedly retell the
            incident. Assign one informed point of contact, explain what will happen next, and
            preserve confidentiality within the limits of the institution's obligations.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Establish facts before making claims
          </h2>
          <p>
            A report may involve a real recording, an edited clip, a synthetic generation, parody,
            or a combination of sources. The response should document what is known without
            declaring intent or wrongdoing before the evidence supports it. Preserve the original
            source and context rather than relying on a re-upload or a description alone.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Build the response before the next incident
          </h2>
          <p>
            Colleges can prepare a short reporting route, a preservation checklist, a student
            support handoff and a communications approval process before an incident occurs.
            Training should distinguish manipulated media from ordinary criticism and should make
            clear that students should not investigate or confront suspected creators themselves.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Follow through after the post is removed
          </h2>
          <p>
            Removal is not the end of the response. Copies may remain in private groups, search
            results or other platforms. Keep the case record, monitor for recurrence and make sure
            the affected student knows how to re-open support if new material appears. This guide is
            general information, not legal advice.
          </p>
          <RelatedReading
            heading="Student digital safety reading"
            items={[
              {
                to: "/student-digital-safety",
                title: "A Digital Safety Guide for Students",
                description: "A broader map of the student safety landscape.",
              },
              {
                to: "/newsroom/college-student-deepfakes",
                title: "Deepfakes and College Students",
                description: "Why fabricated video can spread quickly on campus.",
              },
              {
                to: "/newsroom/how-to-preserve-deepfake-evidence",
                title: "How to Preserve Deepfake Evidence",
                description: "A practical preservation checklist.",
              },
            ]}
          />
          <ArticleCta text="Explore Eterna's evidence-led response methodology" to="/methodology" />
          <Link to="/newsroom" className="landing-link inline-flex text-landing-ink">
            Back to Newsroom
          </Link>
        </div>
      </section>
    </PublicPage>
  );
}
