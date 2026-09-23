import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { ArticleCta } from "@/components/public/ArticleCta";
import { PublicPage } from "@/components/public/PublicSite";
import { RelatedReading } from "@/components/public/RelatedReading";

const CANONICAL = "https://protectbyeterna.com/newsroom/how-to-preserve-deepfake-evidence";
const PUBLISHED = "2026-09-20";
const TITLE = "How to Preserve Evidence When You Discover a Deepfake";
const DESCRIPTION =
  "The practical evidence-preservation steps to take when you find a deepfake, before the post disappears, spreads further, or you report it.";

export const Route = createFileRoute("/newsroom_/how-to-preserve-deepfake-evidence")({
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
  component: PreserveDeepfakeEvidencePage,
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

function PreserveDeepfakeEvidencePage() {
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
      readTime="6-minute read"
      heroPlaceholder={{ icon: Archive, concept: "Evidence before action" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Finding a deepfake is often disorienting. The most useful first response is not to argue
            with the account that posted it or to share the content publicly. It is to preserve
            enough context that someone else can understand what appeared, where it appeared and
            when you found it.
          </p>
          <ArticleCallout kind="evidence" label="Preserve before you react">
            <p>
              Capture the exact URL, account name, platform, date and time, caption, surrounding
              comments and visible engagement. Keep the original file or screenshot in a private,
              clearly named folder and do not repost it while documenting it.
            </p>
          </ArticleCallout>
          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Record the source, not just the image
          </h2>
          <p>
            An isolated screenshot may show what the media looked like but not how it was presented.
            Capture the page or post context as well: the profile or channel, the post identifier,
            the surrounding text, replies, visible timestamps and any linked destination. If the
            content appears in more than one place, record each URL separately.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Preserve a clean chronology
          </h2>
          <p>
            Make a short timeline while details are fresh. Note when you first learned about the
            content, who sent it to you, when you captured it, whether it was edited or removed, and
            which reports you submitted. Keep platform confirmation emails and case numbers with the
            same record.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Avoid creating more copies
          </h2>
          <p>
            Evidence preservation does not require forwarding the media to colleagues, friends or
            group chats. Share the source link and surrounding context through the appropriate
            private reporting or legal channel. Re-sharing can increase exposure and make it harder
            to distinguish the original source from later copies.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What to do after preservation
          </h2>
          <p>
            Once the record is secure, use the platform's specific impersonation, manipulated-media
            or non-consensual-content reporting path. If there is a threat, extortion, fraud or
            immediate safety concern, involve a trusted professional or the relevant authorities.
            This guide is general information, not legal advice.
          </p>
          <RelatedReading
            items={[
              {
                to: "/newsroom/someone-made-a-deepfake-of-me",
                title: "Someone Made a Deepfake of Me — What Should I Do?",
                description: "Calm first steps after discovering impersonation.",
              },
              {
                to: "/newsroom/deepfake-verification-guide",
                title: "The Deepfake Verification Guide",
                description: "How to assess what you are looking at.",
              },
              {
                to: "/newsroom/deepfake-reuploads-after-removal",
                title: "Why Deepfakes Reappear After Removal",
                description: "What to document when copies keep returning.",
              },
              {
                to: "/deepfake-protection",
                title: "Eterna's Deepfake Protection Framework",
                description:
                  "How Eterna verifies and preserves evidence once a deepfake is suspected.",
              },
            ]}
          />
          <ArticleCta text="Explore Eterna's evidence-led protection approach" to="/methodology" />
          <Link to="/newsroom" className="landing-link inline-flex text-landing-ink">
            Back to Newsroom
          </Link>
        </div>
      </section>
    </PublicPage>
  );
}
