import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://eternasentinel.com/newsroom/deepfake-verification-guide";
const PUBLISHED = "2026-09-16";

export const Route = createFileRoute("/newsroom/deepfake-verification-guide")({
  head: () => ({
    meta: [
      { title: "The Deepfake Verification Guide — Eterna Sentinel" },
      {
        name: "description",
        content:
          "What actually counts as a verified deepfake incident, and the four-part test Eterna applies before calling one confirmed.",
      },
      { property: "og:title", content: "The Deepfake Verification Guide — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Most deepfake statistics are estimates. Here is the verification standard behind a confirmed call.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { property: "article:published_time", content: PUBLISHED },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: GuidePage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "The Deepfake Verification Guide",
    author: { "@type": "Organization", name: "Eterna Sentinel" },
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    mainEntityOfPage: CANONICAL,
  });
}

function GuidePage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title="The Deepfake Verification Guide"
      intro="What actually counts as a verified deepfake — and the standard Eterna applies before calling one confirmed."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Every week brings a new headline number about deepfake fraud — billions in losses,
            hundreds of thousands of victims, exponential growth. Some of these figures are solid.
            Others are extrapolated from small samples or vendor telemetry that measures something
            narrower than the headline suggests. Almost none of the coverage explains how a single
            incident gets confirmed as a genuine, AI-generated deepfake, as opposed to a claim that
            hasn't been substantiated.
          </p>

          <p>
            That distinction is the actual work of digital identity defence, and it's the basis for
            the{" "}
            <Link to="/identity-response-observatory" className="landing-link text-landing-ink">
              Eterna Identity Response Observatory
            </Link>
            . It's worth explaining plainly, because if Eterna is going to ask anyone to trust a
            verification call, the method behind it should be visible.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            The scale problem, honestly stated
          </h2>
          <p>
            The data that exists is genuinely significant, even accounting for measurement caveats.
            One 2025 aggregation of verified incidents documented more than $1.28 billion in
            confirmed deepfake-related fraud losses across 1,567 verified cases — and noted that
            over 80% of reported incidents disclosed no financial figure at all, meaning the real
            total is almost certainly higher. A separate first-half-2026 review of news-reported
            attacks identified 821 verified incidents drawn from 1,760 news reports, with at least
            15,736 documented victims. On the identity-verification side, a 2026 report covering
            more than a billion verification events across 195 countries found deepfakes present in
            roughly one in five biometric fraud attempts.
          </p>
          <p>
            Those figures share something important: each traces back to a named methodology and a
            defined sample. That's the bar. A lot of circulating "deepfake statistics" content
            doesn't clear it — numbers get repeated across posts until the original caveat
            disappears.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why human detection can't be the backstop
          </h2>
          <p>
            It's tempting to assume a trained eye can catch what a headline can't. Published
            research says otherwise — studies on human accuracy identifying high-quality deepfake
            video have found rates as low as 24.5%, worse than a coin flip. Automated detectors fare
            better in controlled conditions, but independent real-world benchmarking (the
            Deepfake-Eval-2024 benchmark) found detector accuracy dropped by roughly 45–50% outside
            lab conditions compared to curated test sets.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            The standard: four tests before "verified"
          </h2>
          <p>
            An incident earns a verified tag in Eterna's own case review — and in the Identity
            Response Observatory — only when it clears four checks. The full standard, with each
            test explained, is published on the{" "}
            <Link to="/methodology" className="landing-link text-landing-ink">
              Methodology page
            </Link>
            : sourced to a checkable origin, corroborated by an independent second signal,
            attributable to a stated verification method, and — where an active response is involved
            — authorized by the affected party before anything is escalated.
          </p>
          <p>
            Anything that doesn't clear all four is labeled reported but unconfirmed, or disputed —
            visibly, not quietly dropped.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Why this matters more than another accuracy score
          </h2>
          <p>
            The deepfake-defence category has largely competed on detection speed and confidence
            scores. Those are useful signals, but they answer the wrong question for someone whose
            identity has just been weaponized. The real question is whether something can be
            substantiated well enough that a platform, a newsroom or a court will act on it — a
            documentation and verification question, not a model-accuracy question. If you're
            responding to a live incident right now, see the{" "}
            <Link
              to="/newsroom/impersonation-response-guide"
              className="landing-link text-landing-ink"
            >
              Impersonation Response Guide
            </Link>{" "}
            for the first-72-hours process.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Sources</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-xs leading-6">
              <li>
                DeepStrike, "Deepfake Statistics 2026," aggregating Resemble AI (H1 2026 incident
                data), Pindrop (voice-clone telemetry), Entrust (2026 Identity Fraud Report) and the
                Deepfake-Eval-2024 benchmark.
              </li>
              <li>Entrust, 2026 Identity Fraud Report.</li>
            </ul>
            <p className="mt-4 text-[11px] text-landing-muted">
              Figures above are cited via a secondary aggregation source; Eterna is working to cite
              each primary report directly in a future revision of this guide.
            </p>
          </div>

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
