import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, FileSearch, ScanFace, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

export const Route = createFileRoute("/case-studies")({
  head: () => ({
    meta: [
      { title: "Protection in Practice: Eterna Sentinel" },
      {
        name: "description",
        content:
          "Anonymized examples of Eterna Sentinel detection, investigation, evidence preservation and governed response workflows.",
      },
      { property: "og:title", content: "Protection in Practice: Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Verified operating activity from Eterna's evidence-led digital protection platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://protectbyeterna.com/case-studies" }],
  }),
  component: CaseStudiesPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Protection in Practice: Eterna Sentinel",
    description:
      "Anonymized examples of Eterna Sentinel detection, investigation, evidence preservation and governed response workflows.",
    publisher: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      url: "https://protectbyeterna.com/",
    },
    mainEntityOfPage: "https://protectbyeterna.com/case-studies",
  });
}

const studies = [
  {
    icon: Users,
    type: "Impersonation review",
    summary: "Potential identity misuse surfaced from monitored public sources.",
    steps: [
      "Identity context reviewed",
      "Source records retained",
      "Potential cases opened",
      "Status monitored",
    ],
    outcome: "Activity recorded for review. No removal outcome is claimed.",
  },
  {
    icon: ScanFace,
    type: "Synthetic-media review",
    summary: "Potential manipulated-media signals assessed against protected identity references.",
    steps: [
      "Similarity signals assessed",
      "Source context preserved",
      "Human review boundary applied",
      "Repeat findings monitored",
    ],
    outcome:
      "Specialist findings retained for investigation. A signal alone is not treated as proof.",
  },
  {
    icon: FileSearch,
    type: "Unauthorized-content review",
    summary: "Potential reuse of protected material discovered across public digital sources.",
    steps: [
      "Ownership context checked",
      "Evidence references preserved",
      "Eligibility assessed",
      "Appropriate route considered",
    ],
    outcome:
      "Cases progress only when authorization, evidence and route requirements are satisfied.",
  },
];

function CaseStudiesPage() {
  return (
    <PublicPage
      eyebrow="Protection in practice"
      title="Real activity. Careful conclusions."
      intro="These anonymized examples reflect operating workflows in the Eterna platform. Client-identifying information is excluded, and no unverified removal outcome is presented."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl space-y-6 px-6">
          {studies.map(({ icon: Icon, type, summary, steps, outcome }, index) => (
            <article
              key={type}
              className="grid gap-8 border border-landing-line p-7 md:grid-cols-[0.7fr_1.3fr] md:p-10"
            >
              <div>
                <span className="text-xs text-landing-muted">0{index + 1}</span>
                <Icon className="mt-8 size-6 text-landing-accent" />
                <h2 className="mt-5 text-2xl font-semibold">{type}</h2>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{summary}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-landing-muted">
                  Eterna response
                </p>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {steps.map((step) => (
                    <li key={step} className="flex items-center gap-3 text-sm">
                      <Check className="size-4 text-landing-accent" />
                      {step}
                    </li>
                  ))}
                </ul>
                <div className="mt-8 border-t border-landing-line pt-5">
                  <p className="text-xs font-semibold uppercase text-landing-muted">
                    Recorded position
                  </p>
                  <p className="mt-2 text-sm leading-6">{outcome}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="bg-landing-soft py-16">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-medium">Discuss a protection assessment.</h2>
            <p className="mt-2 text-sm text-landing-muted">
              Tell Eterna what needs protection and why.
            </p>
          </div>
          <Button asChild className="landing-accent-fill text-landing-accent-foreground">
            <Link to="/waitinglist" search={{ source: "case-studies" }}>
              Request Protection <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </PublicPage>
  );
}
