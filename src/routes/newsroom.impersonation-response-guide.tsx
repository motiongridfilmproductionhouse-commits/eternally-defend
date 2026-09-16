import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom/impersonation-response-guide";
const PUBLISHED = "2026-09-16";

export const Route = createFileRoute("/newsroom/impersonation-response-guide")({
  head: () => ({
    meta: [
      { title: "The Impersonation Response Guide — Eterna Sentinel" },
      {
        name: "description",
        content:
          "What actually happens, hour by hour, when you report a deepfake or impersonation account — and why the order matters.",
      },
      { property: "og:title", content: "The Impersonation Response Guide — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "A plain-English walkthrough of evidence, classification, escalation and authorization in the first 72 hours.",
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
    headline: "The Impersonation Response Guide",
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
      title="The Impersonation Response Guide"
      intro="What actually happens in the first 72 hours after you discover a deepfake or an account impersonating you — and why the order matters."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Most people encounter this problem for the first time in the worst possible way: a
            friend sends a screenshot, a client asks an awkward question, or a video shows up that
            looks and sounds like you saying something you never said. The instinct is to act
            immediately — report the account, post a denial, call a lawyer. Some of that instinct is
            right. Some of it can weaken the case. Here's what a properly run response looks like.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Hour 0–2: Preserve before you react
          </h2>
          <p>
            The most damaging mistake in the first two hours is reacting publicly before preserving
            evidence. Platforms remove content, accounts get deleted, pages update — once that
            happens, the record needed to prove what was said, where, and when can disappear with
            it.
          </p>
          <p>
            Screenshot or record the content in context — the full post, the account profile, the
            URL, timestamps and visible engagement. Save the direct link. Do not engage with the
            account, comment, or share it further; engagement can increase distribution and
            complicate later claims about how far it spread.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Hour 2–24: Establish what you're dealing with
          </h2>
          <p>
            Not everything that looks like a deepfake is one, and not every impersonation is
            coordinated. Is it synthetic media, account impersonation, or both? Is there a
            discernible motive — financial scam, harassment, brand sabotage — or does it look
            opportunistic? What is the actual reach right now, versus what it could become?
          </p>
          <p>
            This is also where a disciplined response avoids a common failure: publicly declaring
            something "fake" or "AI-generated" before that's been substantiated. See the{" "}
            <Link
              to="/newsroom/deepfake-verification-guide"
              className="landing-link text-landing-ink"
            >
              Deepfake Verification Guide
            </Link>{" "}
            for what substantiation actually requires.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Hour 24–48: Build the case, don't just file a report
          </h2>
          <p>
            Platform reporting tools are necessary but rarely sufficient alone — high-volume
            platforms triage reports algorithmically, and a bare report with no context often sits
            in a generic queue. A stronger submission includes a clear, chronological evidence file,
            a concise statement of why the content is false or unauthorized, proof of authority to
            act on the affected party's behalf, and the specific policy the content violates, cited
            by name.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Hour 48–72: Authorize the response, then escalate deliberately
          </h2>
          <p>
            This is the step most purely automated tools skip, because it's a human judgment step,
            not a technical one: before any enforcement action is taken on someone's behalf, the
            affected person or their verified representative should explicitly authorize it. This
            protects against a second failure mode that's just as damaging as inaction — an
            overzealous response that draws far more attention to a low-reach post than it ever
            would have received on its own.
          </p>
          <p>
            With authorization confirmed, escalation typically follows: direct platform enforcement
            channels using the evidence file; domain or hosting-level takedown for content outside
            major platforms; search de-indexing for already-removed content still appearing in
            results; law enforcement or regulator referral where legal thresholds are met; and a
            public statement, if warranted, only once the above is underway.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Why the order matters</h2>
          <p>
            Skipping straight to a public statement or a bare platform report is understandable —
            it's the natural reaction to something that feels like an emergency. It's also how weak
            cases get built, evidence gets lost, and low-reach incidents get amplified by the
            response itself. If you need a condensed version of this process for executives and
            comms teams making a fast first call, see the{" "}
            <Link
              to="/newsroom/executive-first-hour-playbook"
              className="landing-link text-landing-ink"
            >
              Executive First-Hour Response Playbook
            </Link>
            .
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Basis for this guide</h2>
            <p className="mt-4 text-xs leading-6">
              This walkthrough reflects general trust-and-safety incident-response practice and
              Eterna's stated operating model — verified authorization before enforcement, human
              approval for consequential actions. It does not reference a specific client case; any
              future case example would require separate, explicit client consent before
              publication.
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
