import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Check, FileSearch, ScanFace, Users } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { EnquiryButton } from "@/components/public/enquiry/enquiry-modal-context";

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
    type: "Public figure impersonation",
    summary:
      "Several social accounts appeared using a protected individual's name, imagery and identity characteristics across more than one platform.",
    fields: [
      {
        label: "Eterna detected",
        value: "Related public sources identified across multiple platforms.",
      },
      { label: "Review", value: "Identity context and source relationships examined." },
      {
        label: "Evidence",
        value: "URLs, publication state, screenshots and timestamps preserved.",
      },
      { label: "Action", value: "Eligible sources routed for authorized platform review." },
      { label: "Ongoing", value: "New appearances monitored for recurrence." },
    ],
    outcome: "Activity recorded for review. No removal outcome is claimed.",
  },
  {
    icon: ScanFace,
    type: "Synthetic-media exposure",
    summary:
      "Manipulated media referencing a protected individual's likeness was flagged by monitoring across public surfaces.",
    fields: [
      { label: "Eterna detected", value: "Signals matched against protected identity references." },
      {
        label: "Review",
        value: "Similarity, context and source credibility assessed by a specialist.",
      },
      { label: "Evidence", value: "Source, hosting context and capture state preserved." },
      { label: "Action", value: "Confirmed cases routed for authorized response." },
      { label: "Ongoing", value: "Related uploads and reappearances tracked over time." },
    ],
    outcome:
      "Specialist findings retained for investigation. A signal alone is not treated as proof.",
  },
  {
    icon: FileSearch,
    type: "Unauthorized content reuse",
    summary:
      "Protected material appeared reused without authorization across public digital surfaces.",
    fields: [
      { label: "Eterna detected", value: "Instances of reuse identified across public sources." },
      { label: "Review", value: "Ownership, authorization and eligibility context checked." },
      { label: "Evidence", value: "Source URLs, publication dates and context preserved." },
      { label: "Action", value: "Eligible instances routed through the appropriate platform." },
      { label: "Ongoing", value: "Recurrence and new instances monitored." },
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
          {studies.map(({ icon: Icon, type, summary, fields, outcome }, index) => (
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
                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  {fields.map(({ label, value }) => (
                    <div key={label} className="flex gap-3 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-landing-accent" />
                      <div>
                        <dt className="text-xs font-semibold uppercase text-landing-muted">
                          {label}
                        </dt>
                        <dd className="mt-1 leading-5">{value}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
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
          <EnquiryButton
            className="landing-accent-fill text-landing-accent-foreground"
            prefill={{
              sourcePage: "case-studies",
              sourceCta: "Request Protection",
              department: "protection",
            }}
          >
            Request Protection <ArrowRight />
          </EnquiryButton>
        </div>
      </section>
    </PublicPage>
  );
}
