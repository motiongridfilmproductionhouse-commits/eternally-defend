import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Radar, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/identity-response-observatory";

export const Route = createFileRoute("/identity-response-observatory")({
  head: () => ({
    meta: [
      { title: "Eterna Identity Response Observatory" },
      {
        name: "description",
        content:
          "Eterna's initiative to build a sourced, methodology-transparent public record of digital-identity incidents: verified, reported or disputed, and shown that way.",
      },
      { property: "og:title", content: "Eterna Identity Response Observatory" },
      {
        property: "og:description",
        content:
          "A public record of digital-identity incidents, built on Eterna's four-part verification standard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: ObservatoryPage,
});

function ObservatoryPage() {
  return (
    <PublicPage
      eyebrow="Eterna Identity Response Observatory"
      title="A public record of digital-identity incidents, built to be checked, not just cited."
      intro="Deepfake and impersonation statistics circulate widely. Few sources show how a single incident is actually confirmed before it's counted. The Observatory is Eterna's initiative to change that, starting with the same verification standard Eterna applies to its own case review."
    >
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <p className="landing-kicker">What it is</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium md:text-5xl">
            Not another statistics report. A checkable standard, applied in public.
          </h2>
          <div className="mt-14 grid gap-px overflow-hidden border border-landing-line bg-landing-line md:grid-cols-3">
            <article className="bg-landing p-8">
              <ShieldCheck className="size-5 text-landing-accent" />
              <h3 className="mt-10 text-lg font-semibold">The standard</h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Every entry considered for the Observatory is assessed against Eterna's published
                four-part verification standard: sourced, corroborated, attributable to a method,
                and (where enforcement is involved) authorized.
              </p>
            </article>
            <article className="bg-landing p-8">
              <BookOpen className="size-5 text-landing-accent" />
              <h3 className="mt-10 text-lg font-semibold">How entries are labeled</h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Each record is shown visibly as verified, reported but unconfirmed, or disputed, not
                quietly dropped. A record that only shows confirmed outcomes isn't a verification
                standard.
              </p>
            </article>
            <article className="bg-landing p-8">
              <Radar className="size-5 text-landing-accent" />
              <h3 className="mt-10 text-lg font-semibold">What feeds it</h3>
              <p className="mt-3 text-sm leading-6 text-landing-muted">
                Publicly documented incidents (reporting, platform disclosures, regulator and court
                actions), plus, over time, anonymized and aggregated patterns from Eterna's own case
                review, where client consent allows it.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="bg-landing-soft py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
          <div>
            <p className="landing-kicker">Current status</p>
            <h2 className="mt-4 text-3xl font-medium">
              Standard published. Public record being built.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-landing-muted">
            <p>
              The verification standard behind the Observatory is published today. See the
              Methodology page. The Observatory's public, browsable record of individual incidents
              is in active development and is not yet published on this site.
            </p>
            <p>
              Eterna's own platform operating activity is disclosed on the homepage, dated and
              labeled as platform activity rather than Observatory entries. Nothing on this page
              should be read as an incident count, a case outcome, or a claim of removal.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="landing-kicker">Get involved</p>
              <h2 className="mt-4 text-3xl font-medium">
                Built for journalists, researchers and affected people.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-landing-muted">
              If you cover this space, study it, or you've been affected directly, Eterna wants the
              Observatory to be useful to you. Read the methodology, or get in touch about a
              documented incident, a partnership, or press access.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="link" className="h-auto p-0 text-landing-ink">
              <Link to="/methodology">
                Read the verification standard <ArrowRight />
              </Link>
            </Button>
            <Button asChild className="landing-accent-fill text-landing-accent-foreground">
              <Link to="/contact">Contact Eterna</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex items-start gap-3 text-xs leading-6 text-landing-muted">
            <Users className="mt-0.5 size-4 shrink-0 text-landing-accent" />
            <p>
              Client identities and case details remain confidential. The Observatory records
              publicly documented incidents and, where permitted, anonymized aggregate patterns
              only; it never publishes a client's name, case file or evidence without separate,
              explicit, written consent.
            </p>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
