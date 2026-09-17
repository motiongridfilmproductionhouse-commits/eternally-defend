import { createFileRoute } from "@tanstack/react-router";
import { PublicPage } from "@/components/public/PublicSite";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service: Eterna Sentinel" },
      {
        name: "description",
        content: "Terms governing access to Eterna Sentinel digital protection services.",
      },
      { property: "og:title", content: "Terms of Service: Eterna Sentinel" },
      {
        property: "og:description",
        content: "Terms governing access to Eterna Sentinel digital protection services.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://protectbyeterna.com/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PublicPage
      eyebrow="Legal"
      title="Terms of Service"
      intro="These terms describe the principles that govern access to Eterna Sentinel services. Specific client engagements are also governed by their signed service agreement."
    >
      <PolicySections
        sections={[
          [
            "Authorized use",
            "Clients must provide accurate identity and authority information, use the service lawfully and act only for identities, organizations and assets they are permitted to represent.",
          ],
          [
            "Assessment, not a guarantee",
            "Detection and analysis can support decisions but do not guarantee that content is unlawful, actionable or removable. Platforms and other recipients make their own decisions.",
          ],
          [
            "Protection workflows",
            "Monitoring, evidence preservation, investigation and eligible submission may depend on the agreed scope, available evidence and required approvals.",
          ],
          [
            "Responsible conduct",
            "The service must not be used to suppress lawful criticism, misrepresent ownership, target another person, bypass platform rules or submit false claims.",
          ],
          [
            "Availability and changes",
            "Services may change as sources, platform processes and protection methods evolve. Material engagement terms remain subject to the applicable client agreement.",
          ],
          [
            "Contact",
            "Questions about these terms can be submitted through Eterna's contact and protection request channel.",
          ],
        ]}
      />
    </PublicPage>
  );
}

export function PolicySections({ sections }: { sections: [string, string][] }) {
  return (
    <section className="py-16 md:py-24">
      <div className="mx-auto max-w-3xl space-y-10 px-6">
        {sections.map(([title, body], index) => (
          <section key={title} className="border-t border-landing-line pt-7">
            <p className="text-xs text-landing-muted">0{index + 1}</p>
            <h2 className="mt-3 text-2xl font-semibold">{title}</h2>
            <p className="mt-4 text-sm leading-7 text-landing-muted">{body}</p>
          </section>
        ))}
      </div>
    </section>
  );
}
