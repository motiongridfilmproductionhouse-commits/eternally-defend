import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileSearch, Link2, ShieldCheck, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/methodology";

export const Route = createFileRoute("/methodology")({
  head: () => ({
    meta: [
      { title: "Verification Methodology: Eterna Sentinel" },
      {
        name: "description",
        content:
          "The four-part standard Eterna Sentinel applies before any impersonation, deepfake or content-misuse finding is treated as verified.",
      },
      { property: "og:title", content: "Verification Methodology: Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Sourced, corroborated, attributable to a method, and authorized before enforcement: how Eterna decides what counts as verified.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: MethodologyPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Verification Methodology: Eterna Sentinel",
    description:
      "The four-part standard Eterna Sentinel applies before any impersonation, deepfake or content-misuse finding is treated as verified.",
    publisher: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      url: "https://protectbyeterna.com/",
    },
    mainEntityOfPage: CANONICAL,
  });
}

const standard = [
  {
    icon: Link2,
    step: "01",
    title: "Sourced",
    body: "A finding needs a citable, checkable origin: platform-confirmed data, direct first-party evidence with a preserved chain of custody, or another checkable source. Unsourced claims are not carried forward as findings.",
  },
  {
    icon: FileSearch,
    step: "02",
    title: "Corroborated",
    body: "A single unverified signal is logged as reported, not verified, until an independent second signal supports it. One screenshot or one report alone does not clear the bar.",
  },
  {
    icon: ShieldCheck,
    step: "03",
    title: "Attributable to a method",
    body: "Every finding states how the determination was made (forensic review, platform confirmation, subject confirmation or investigative review), not just the conclusion.",
  },
  {
    icon: UserCheck,
    step: "04",
    title: "Authorized before enforcement",
    body: "Where a finding leads to an active response, action requires confirmed authorization from the affected party or their authorized representative before anything is escalated.",
  },
] as const;

function MethodologyPage() {
  return (
    <PublicPage
      eyebrow="Methodology"
      title="What counts as verified, and why it matters."
      intro="Detection technology can flag something as suspicious. It doesn't tell you whether a platform, a court or a newsroom will act on it. That gap is a documentation and verification question: this is the standard Eterna applies to close it."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">The four-part standard</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-5xl">
            A finding is marked verified only when it clears all four.
          </h2>
          <div className="mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line md:grid-cols-2">
            {standard.map(({ icon: Icon, step, title, body }) => (
              <article key={step} className="bg-landing p-8 md:p-10">
                <p className="text-xs text-landing-accent">{step}</p>
                <Icon className="mt-6 size-5 text-landing-accent" />
                <h3 className="mt-6 text-xl font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">What doesn't clear the bar</p>
            <h2 className="mt-4 text-3xl font-medium">
              Reported, not verified, and shown that way.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              Anything that doesn't pass all four checks is labeled visibly as reported but
              unconfirmed or disputed, not quietly dropped. A record that only shows confirmed
              outcomes isn't a verification standard, it's marketing.
            </p>
            <p>
              This is also why detection accuracy alone is not treated as protection. Independent
              benchmark testing has found automated detector accuracy can fall substantially outside
              lab conditions compared to curated test sets, and human visual identification of
              high-quality synthetic video has been measured well below reliable levels in published
              research. A confidence score is one input. It is not a case.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="landing-kicker">Where this standard is applied</p>
              <h2 className="mt-4 text-3xl font-medium">
                Case review, and the Identity Response Observatory.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-landing-muted">
              This is the same standard used inside client case review, and the standard behind
              every entry considered for the Eterna Identity Response Observatory: Eterna's public
              record of documented digital-identity incidents.
            </p>
          </div>
          <Button asChild variant="link" className="mt-8 h-auto p-0 text-landing-ink">
            <Link to="/identity-response-observatory">
              Read about the Observatory <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </PublicPage>
  );
}
