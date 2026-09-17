import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileText, ScanFace, Users } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom";

export const Route = createFileRoute("/newsroom")({
  head: () => ({
    meta: [
      { title: "Newsroom & Insights — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Eterna Sentinel guidance on deepfake verification and impersonation response, written and published by Eterna.",
      },
      { property: "og:title", content: "Newsroom & Insights — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Eterna-owned guides on verification, response and executive readiness for digital-identity incidents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: NewsroomPage,
});

const guides = [
  {
    icon: ScanFace,
    to: "/newsroom/deepfake-verification-guide" as const,
    title: "The Deepfake Verification Guide",
    summary:
      "What actually counts as a verified deepfake, and the four-part test behind that call.",
  },
  {
    icon: Users,
    to: "/newsroom/impersonation-response-guide" as const,
    title: "The Impersonation Response Guide",
    summary:
      "What to do, in order, in the first 72 hours after discovering impersonation or synthetic media.",
  },
  {
    icon: FileText,
    to: "/newsroom/executive-first-hour-playbook" as const,
    title: "The Executive First-Hour Response Playbook",
    summary:
      "A condensed playbook for executives and comms teams for the first hour after an incident surfaces.",
  },
] as const;

function NewsroomPage() {
  return (
    <PublicPage
      eyebrow="Newsroom"
      title="Guidance Eterna publishes, written by Eterna."
      intro="Practical, sourced guidance on verification and incident response. These are Eterna-owned educational guides, not independent journalism or third-party press coverage."
    >
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-px overflow-hidden border border-landing-line bg-landing-line md:grid-cols-3">
            {guides.map(({ icon: Icon, to, title, summary }) => (
              <Link
                key={to}
                to={to}
                className="landing-feature-card group bg-landing p-8 transition-colors hover:bg-landing-soft"
              >
                <Icon className="size-5 text-landing-accent" />
                <h2 className="mt-14 text-lg font-semibold">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{summary}</p>
                <span className="mt-6 inline-flex items-center gap-1 text-xs font-semibold text-landing-ink">
                  Read the guide <ArrowRight className="size-3.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-landing-soft py-16">
        <div className="mx-auto max-w-6xl px-6">
          <p className="max-w-2xl text-xs leading-6 text-landing-muted">
            Eterna Sentinel publishes these guides as original, evidence-based educational content.
            Statistics cited are sourced and referenced in each guide; where a figure is drawn from
            a third-party report via an aggregator, that is stated explicitly. These pages are not
            press coverage of Eterna by an independent outlet — for that, see future updates on this
            page as Eterna's media presence develops.
          </p>
        </div>
      </section>
    </PublicPage>
  );
}
