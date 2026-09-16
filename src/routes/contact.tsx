import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Handshake, LifeBuoy, Mail, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://eternasentinel.com/contact";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Eterna Sentinel" },
      {
        name: "description",
        content:
          "Reach Eterna Sentinel for protection requests, business enquiries, media, partnerships or client support.",
      },
      { property: "og:title", content: "Contact Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "The right channel for protection requests, business enquiries, media, partnerships and support.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <PublicPage
      eyebrow="Contact"
      title="Reach the right team the first time."
      intro="Protection requests, business enquiries, media, partnerships and support go through different channels so they reach the right people faster."
    >
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-px overflow-hidden border border-landing-line bg-landing-line md:grid-cols-2">
            <article className="bg-landing p-8">
              <ShieldCheck className="size-5 text-landing-accent" />
              <h2 className="mt-10 text-lg font-semibold">Protection requests</h2>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Individuals, executives and organizations requesting Eterna's protection services.
              </p>
              <Button asChild variant="link" className="mt-5 h-auto p-0 text-landing-ink">
                <Link to="/waitinglist" search={{ source: "contact-protection-request" }}>
                  Request Protection <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </article>

            <article className="bg-landing p-8">
              <Handshake className="size-5 text-landing-accent" />
              <h2 className="mt-10 text-lg font-semibold">Business enquiries</h2>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                General company and enterprise enquiries not covered by the categories here.
              </p>
              <Button asChild variant="link" className="mt-5 h-auto p-0 text-landing-ink">
                <Link to="/waitinglist" search={{ source: "contact-business-enquiry" }}>
                  Start a business enquiry <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </article>

            <article className="bg-landing p-8">
              <Mail className="size-5 text-landing-accent" />
              <h2 className="mt-10 text-lg font-semibold">Media</h2>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Press enquiries, interview requests and coverage of the Identity Response
                Observatory.
              </p>
              <a
                href="mailto:press@eternasentinel.com"
                className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-landing-ink"
              >
                press@eternasentinel.com <ArrowRight className="size-3.5" />
              </a>
            </article>

            <article className="bg-landing p-8">
              <Users className="size-5 text-landing-accent" />
              <h2 className="mt-10 text-lg font-semibold">Partnerships</h2>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Agencies, platforms and organizations proposing a partnership with Eterna.
              </p>
              <Button asChild variant="link" className="mt-5 h-auto p-0 text-landing-ink">
                <Link to="/partner-apply">
                  Apply as a partner <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </article>

            <article className="bg-landing p-8 md:col-span-2">
              <LifeBuoy className="size-5 text-landing-accent" />
              <h2 className="mt-10 text-lg font-semibold">Support</h2>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Existing clients with a question about an active case should sign in and use the
                in-platform support channel, where case history and identity are already verified.
              </p>
              <div className="mt-5 flex flex-wrap gap-4">
                <Button asChild variant="link" className="h-auto p-0 text-landing-ink">
                  <Link to="/auth">
                    Client Sign In <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
                <a
                  href="mailto:support@eternasentinel.com"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-landing-ink"
                >
                  support@eternasentinel.com <ArrowRight className="size-3.5" />
                </a>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="bg-landing-soft py-16">
        <div className="mx-auto max-w-5xl px-6">
          <div className="flex items-start gap-3 text-xs leading-6 text-landing-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-landing-accent" />
            <p>
              Reporting a security vulnerability rather than an identity or content incident? See{" "}
              <a href="/security#responsible-disclosure" className="landing-link text-landing-ink">
                responsible disclosure
              </a>{" "}
              on the Security &amp; Governance page.
            </p>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
