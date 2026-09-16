import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, Check, Fingerprint, KeyRound, Scale, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security & Governance — Eterna Sentinel" },
      {
        name: "description",
        content:
          "How Eterna Sentinel governs authorization, identity verification, evidence, human review and sensitive information.",
      },
      { property: "og:title", content: "Security & Governance — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Evidence preserved, access controlled and consequential actions governed by human review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://eternasentinel.com/security" }],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  const controls = [
    {
      icon: Fingerprint,
      title: "Identity and authorization",
      body: "Identity, authority and protected assets are established before protection workflows are activated.",
    },
    {
      icon: KeyRound,
      title: "Access control",
      body: "Client records are separated by account and role-based access governs sensitive operational views.",
    },
    {
      icon: Archive,
      title: "Evidence preservation",
      body: "Relevant URLs, timestamps, source context and supporting material can be retained in case history.",
    },
    {
      icon: Scale,
      title: "Human review",
      body: "Automated signals do not establish wrongdoing. Reviewers assess context, evidence and eligibility before consequential action.",
    },
    {
      icon: Check,
      title: "Auditable history",
      body: "Case and enforcement workflows preserve status history so decisions can be traced and reviewed.",
    },
    {
      icon: ShieldAlert,
      title: "Fail-closed enforcement",
      body: "Authorization, evidence, route verification, approval, allowlist and operating controls must align before eligible submissions proceed.",
    },
  ];
  return (
    <PublicPage
      eyebrow="Security & governance"
      title="Evidence preserved. Actions governed."
      intro="Eterna combines technical controls with human review so protection work remains authorized, traceable and proportionate."
    >
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-px overflow-hidden border border-landing-line bg-landing-line md:grid-cols-2 lg:grid-cols-3">
            {controls.map(({ icon: Icon, title, body }) => (
              <article key={title} className="bg-landing p-8">
                <Icon className="size-5 text-landing-accent" />
                <h2 className="mt-10 text-xl font-semibold">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="bg-landing-ink py-20 text-landing">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker text-landing-accent">Operational governance</p>
            <h2 className="mt-4 text-4xl font-medium">Protection is a controlled process.</h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-on-dark-muted">
            <p>
              Retention and handling are scoped to the protection purpose, client authorization and
              applicable service requirements. Sensitive information is limited to authorized
              operational use.
            </p>
            <p>
              Service providers are assessed for the function they support. Incident concerns can be
              raised directly with Eterna for triage and response.
            </p>
            <Button asChild className="mt-3 bg-landing-accent text-landing-accent-foreground">
              <Link to="/waitinglist" search={{ source: "security-enquiry" }}>
                Security enquiry
              </Link>
            </Button>
          </div>
        </div>
      </section>
      <section id="responsible-disclosure" className="scroll-mt-24 py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Responsible disclosure</p>
            <h2 className="mt-4 text-3xl font-medium">Found a security issue? Tell us directly.</h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              If you believe you've found a vulnerability in Eterna's platform, report it to us
              directly before disclosing it publicly. Eterna investigates good-faith reports and
              will acknowledge receipt.
            </p>
            <p>
              Please do not access, modify or exfiltrate client or case data, and avoid testing that
              could degrade service for others. Include enough detail to reproduce the issue.
            </p>
            <a
              href="mailto:security@eternasentinel.com"
              className="inline-flex items-center gap-1 text-sm font-semibold text-landing-ink"
            >
              security@eternasentinel.com
            </a>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
