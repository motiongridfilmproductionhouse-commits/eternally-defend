import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom/executive-first-hour-playbook";
const PUBLISHED = "2026-09-16";

export const Route = createFileRoute("/newsroom_/executive-first-hour-playbook")({
  head: () => ({
    meta: [
      { title: "The Executive First Hour Response Playbook — Eterna Sentinel" },
      {
        name: "description",
        content:
          "A condensed playbook for executives and comms teams for the first hour after a deepfake or impersonation incident surfaces.",
      },
      {
        property: "og:title",
        content: "The Executive First Hour Response Playbook — Eterna Sentinel",
      },
      {
        property: "og:description",
        content:
          "Five decisions to get right in the first hour, before the full response process begins.",
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
    headline: "The Executive First Hour Response Playbook",
    author: { "@type": "Organization", name: "Eterna Sentinel" },
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    mainEntityOfPage: CANONICAL,
  });
}

const moves = [
  {
    title: "Do not respond publicly yet",
    body: "A denial, a joke, or an acknowledgment posted in the first hour can lock in a framing before you know what you're dealing with. Silence for one hour is rarely costly. A wrong first statement is.",
  },
  {
    title: "Assign one owner",
    body: "One person — not a group chat — owns evidence capture, internal updates and the incident log: a running, timestamped record of what's known, what's been done and who authorized it. Split ownership is how details get lost or contradicted later.",
  },
  {
    title: "Capture evidence before anything moves or disappears",
    body: "Full-context screenshots or recordings, direct links, timestamps and visible reach. This is the single highest-leverage action available in the first hour, and the easiest one to skip under pressure.",
  },
  {
    title: "Loop in legal and communications together, not sequentially",
    body: "A fraud, threat or public-figure exposure angle changes what can be said publicly and what should go to a platform or authority first. Deciding that alone, without both functions in the room, is how avoidable mistakes happen.",
  },
  {
    title: "Decide what you actually know, versus what you suspect",
    body: "Write down the difference explicitly. Nothing gets called 'confirmed fake' or 'AI-generated' externally until it clears a real verification standard — see the linked guide below for what that requires.",
  },
] as const;

function GuidePage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Eterna-owned guide"
      title="The Executive First Hour Response Playbook"
      intro="A condensed playbook for executives and communications leads: the decisions that matter most in the first hour, before the fuller response process begins."
      image={{
        src: "/images/newsroom/executive-first-hour-response-playbook.png",
        alt: "Abstract visual representing executive incident response",
      }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            When a deepfake or impersonation incident touching an executive or organization
            surfaces, the pressure to respond immediately is real — and it's usually the wrong
            instinct. The first hour is not for solving the problem. It's for not making it worse
            while the fuller process (covered in the Impersonation Response Guide) gets underway.
          </p>

          <div className="space-y-8">
            {moves.map(({ title, body }, index) => (
              <div key={title} className="border-t border-landing-line pt-6">
                <p className="text-xs text-landing-accent">Move 0{index + 1}</p>
                <h2 className="mt-3 text-lg font-semibold text-landing-ink">{title}</h2>
                <p className="mt-3">{body}</p>
              </div>
            ))}
          </div>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            What "done" looks like after hour one
          </h2>
          <p>
            Not a public statement. Not a resolved case. Done looks like: evidence preserved, one
            owner assigned, legal and comms both briefed, and an incident log with a clear, written
            line between what's confirmed and what's still being assessed. That's the handoff into
            the fuller response process — there's no fixed length for how long that takes; it runs
            until the incident is resolved.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Continue reading</h2>
            <ul className="mt-4 space-y-2 text-xs">
              <li>
                <Link
                  to="/newsroom/impersonation-response-guide"
                  className="landing-link text-landing-ink"
                >
                  The full Impersonation Response Guide — the complete response process
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/deepfake-verification-guide"
                  className="landing-link text-landing-ink"
                >
                  The Deepfake Verification Guide — what "confirmed" actually requires
                </Link>
              </li>
              <li>
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Eterna's published verification methodology
                </Link>
              </li>
            </ul>
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
