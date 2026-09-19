import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Fingerprint } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { ArticleCallout } from "@/components/public/ArticleCallout";
import { RelatedReading } from "@/components/public/RelatedReading";
import { ArticleCta } from "@/components/public/ArticleCta";

const CANONICAL = "https://protectbyeterna.com/newsroom/what-is-a-deepfake";
const PUBLISHED = "2026-09-19";
const TITLE = "What Is a Deepfake and Why Is It Becoming a Reputation Problem?";
const DESCRIPTION =
  "A deepfake is AI-generated media depicting a real person doing or saying something they didn't. Here's how it works, and why it's become a reputation risk.";

export const Route = createFileRoute("/newsroom_/what-is-a-deepfake")({
  head: () => ({
    meta: [
      { title: `${TITLE} | Eterna Sentinel` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "What Is a Deepfake, Actually?" },
      {
        property: "og:description",
        content:
          "A plain-language explanation of what deepfakes are, how they're made, and why they've become one of the fastest-growing reputation risks online.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: WhatIsADeepfakePage,
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
          name: "Is every manipulated video a deepfake?",
          acceptedAnswer: {
            "@type": "Answer",
            text: 'No. "Deepfake" specifically refers to AI-generated synthetic media depicting a real person. Traditional editing — cuts, splices, filters, slowed or sped-up footage — is manipulated but not a deepfake in the technical sense, even though both can be misleading.',
          },
        },
        {
          "@type": "Question",
          name: "Can deepfakes be audio-only?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Voice cloning, which recreates someone's voice from a sample of real audio, is a form of deepfake and is increasingly used in impersonation and fraud attempts, separate from any video component.",
          },
        },
        {
          "@type": "Question",
          name: "Are deepfakes illegal?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "It depends on jurisdiction and how the content is used. Laws vary significantly by location and continue to evolve; this article is general information, not legal advice.",
          },
        },
        {
          "@type": "Question",
          name: "Is there a way to reliably detect deepfakes with software?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Automated detection tools exist and continue to improve, but their accuracy tends to drop meaningfully outside controlled testing conditions.",
          },
        },
      ],
    },
  ]);
}

function WhatIsADeepfakePage() {
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
      heroPlaceholder={{ icon: Fingerprint, concept: "Synthetic media, defined" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            A clip shows up in your feed: someone you recognize, saying something that doesn't sound
            like them. The lighting's a little off. The voice is close but not quite right. Or maybe
            it's flawless, and you'd never have known if a caption hadn't told you. Either way,
            you're looking at a deepfake — and the term gets used for such a wide range of things
            that it's worth being precise about what it actually means.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What a deepfake actually is
          </h2>
          <p>
            A deepfake is media — video, audio, or an image — generated or altered using machine
            learning to depict a real person doing or saying something they didn't actually do or
            say. The "deep" refers to deep learning, the branch of AI used to generate the content;
            the term itself is a blend of "deep learning" and "fake," first popularized around 2017.
          </p>
          <p>
            What makes a deepfake specifically different from ordinary photo or video editing is how
            it's made. Traditional editing tools — cropping, splicing, filters — are applied by a
            person, deliberately, frame by frame or effect by effect. A deepfake is generated by a
            model trained on examples of a real person's face, voice or likeness, which then
            produces new synthetic content built from patterns it learned — not a direct
            manipulation of an original file. That distinction matters because it changes what's
            possible: a well-trained model can generate entirely new footage of someone saying
            something that was never recorded in any form, not just alter something that was.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why this has become a reputation problem, not just a technology story
          </h2>
          <p>
            Deepfakes get covered constantly as a technology story — how realistic the tools have
            become, how cheap they are to use. What gets less attention is the specific way this
            maps onto reputation risk, which comes down to three things happening at once.
          </p>
          <ArticleCallout kind="matters">
            <ul className="list-disc space-y-3 pl-5">
              <li>
                <span className="font-semibold text-landing-ink">
                  It requires very little source material.
                </span>{" "}
                Generating a convincing likeness once required substantial footage and technical
                skill. That barrier has dropped considerably — a handful of public photos or a short
                clip of someone's voice from a video call or a conference talk can now be enough
                starting material. Anyone with any public presence — which, at this point, includes
                most professionals, not just celebrities — has that much material already available.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">
                  It's hard to visually catch, even for people paying close attention.
                </span>{" "}
                Research on human ability to spot high-quality synthetic video has found accuracy
                rates well below what people assume they'd achieve. That's not a criticism of
                anyone's attentiveness; it's a reflection of how far the underlying generation
                quality has advanced. Automated detection tools face a related problem: their
                accuracy, measured under controlled lab conditions, tends to drop substantially once
                applied to real-world content that's been compressed, reshared or altered from its
                original format.
              </li>
              <li>
                <span className="font-semibold text-landing-ink">
                  It arrives already carrying the weight of "seeing is believing."
                </span>{" "}
                Video and audio have historically been treated as stronger evidence than text —
                people trust what they see and hear more readily than what they merely read.
                Deepfakes exploit exactly that trust, which is why a fabricated video tends to do
                more reputational damage, faster, than an equivalent false claim made only in
                writing.
              </li>
            </ul>
          </ArticleCallout>
          <p>
            Together, these three factors explain why deepfakes sit at the center of the modern
            reputation-risk conversation: the barrier to creating one has dropped, the barrier to
            spotting one has risen, and the format itself carries more persuasive weight than most
            other kinds of false content.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Who actually gets targeted
          </h2>
          <p>
            The popular image of deepfake targets is limited to celebrities and politicians, but the
            pattern is broader than that. Executives get impersonated in fraud schemes. Ordinary
            individuals — including students — get targeted in harassment, bullying and extortion
            contexts that never make national news but are just as serious to the people involved.
            Anyone with enough public photos or video to serve as training material is a plausible
            target, which in practice is nearly everyone with any online presence at all.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            How verification actually works — and why "looks real" isn't the standard
          </h2>
          <ArticleCallout kind="distinction">
            <p>
              Because visual inspection is unreliable, credible organizations working in this space
              don't rely on "does it look fake" as a verification method. Eterna applies a four-part
              standard before treating any finding as confirmed: the content must be traceable to a
              checkable source, corroborated by an independent second signal, attributable to a
              documented verification method, and — before any response is taken — authorized by the
              affected person. The{" "}
              <Link
                to="/newsroom/deepfake-verification-guide"
                className="landing-link text-landing-ink"
              >
                Deepfake Verification Guide
              </Link>{" "}
              covers this standard in full.
            </p>
          </ArticleCallout>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What to do if this applies to you right now
          </h2>
          <p>
            If you're reading this because you've actually found a deepfake of yourself,{" "}
            <Link
              to="/newsroom/someone-made-a-deepfake-of-me"
              className="landing-link text-landing-ink"
            >
              Someone Made a Deepfake of Me — What Should I Do?
            </Link>{" "}
            has the immediate steps. This article is meant as background — useful before or after an
            incident, but not a substitute for that more direct guide if you need it right now.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">FAQ</h2>
            <div className="mt-4 space-y-4">
              <p>
                <span className="font-semibold text-landing-ink">
                  Is every manipulated video a deepfake?
                </span>{" "}
                No. "Deepfake" specifically refers to AI-generated synthetic media depicting a real
                person. Traditional editing — cuts, splices, filters, slowed or sped-up footage — is
                manipulated but not a deepfake in the technical sense, even though both can be
                misleading.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">Can deepfakes be audio-only?</span>{" "}
                Yes. Voice cloning, which recreates someone's voice from a sample of real audio, is
                a form of deepfake and is increasingly used in impersonation and fraud attempts,
                separate from any video component.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">Are deepfakes illegal?</span> It
                depends on jurisdiction and how the content is used. Laws vary significantly by
                location and continue to evolve; this article is general information, not legal
                advice.
              </p>
              <p>
                <span className="font-semibold text-landing-ink">
                  Is there a way to reliably detect deepfakes with software?
                </span>{" "}
                Automated detection tools exist and continue to improve, but their accuracy tends to
                drop meaningfully outside controlled testing conditions.
              </p>
            </div>
          </div>

          <RelatedReading
            items={[
              {
                to: "/newsroom/someone-made-a-deepfake-of-me",
                title: "Someone Made a Deepfake of Me — What Should I Do?",
                description: "The immediate, ordered steps if this is happening to you right now.",
              },
              {
                to: "/newsroom/deepfake-verification-guide",
                title: "The Deepfake Verification Guide",
                description: "The four-part standard behind calling an incident confirmed.",
              },
              {
                to: "/newsroom/ai-impersonation-reputation-damage",
                title: "How AI Impersonation Can Damage Personal and Business Reputation",
                description: "What happens once a convincing fake actually starts to spread.",
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
