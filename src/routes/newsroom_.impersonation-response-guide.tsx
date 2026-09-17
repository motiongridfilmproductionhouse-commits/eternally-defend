import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom/impersonation-response-guide";
const PUBLISHED = "2026-09-16";

export const Route = createFileRoute("/newsroom_/impersonation-response-guide")({
  head: () => ({
    meta: [
      { title: "The Impersonation Response Guide — Eterna Sentinel" },
      {
        name: "description",
        content:
          "What actually happens, step by step, when you respond to a deepfake or impersonation account — and why the order matters.",
      },
      { property: "og:title", content: "The Impersonation Response Guide — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "A plain-English walkthrough of evidence preservation, account security, documentation, platform reporting, stakeholder communication, escalation and monitoring.",
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
      intro="What actually happens, step by step, after you discover a deepfake or an account impersonating you — and why the order matters. There's no fixed timeline that fits every case; the sequence below is what matters, not the clock."
      image={{
        src: "/images/newsroom/impersonation-response-guide.png",
        alt: "Abstract visual representing impersonation response",
      }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            Most people encounter this problem for the first time in the worst possible way: a
            friend sends a screenshot, a client asks an awkward question, or a video shows up that
            looks and sounds like you saying something you never said. The instinct is to act
            immediately — report the account, post a denial, call a lawyer. Some of that instinct is
            right. Some of it can weaken the case. Here's what a properly run response looks like,
            in order. How long each step takes varies by platform, jurisdiction and case complexity
            — this guide doesn't promise a removal or a fixed completion time, because no one
            honestly can.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Step 1: Preserve before you react
          </h2>
          <p>
            The most damaging mistake early on is reacting publicly before preserving evidence.
            Platforms remove content, accounts get deleted, pages update — once that happens, the
            record needed to prove what was said, where, and when can disappear with it.
          </p>
          <p>
            Screenshot or record the content in context — the full post, the account profile, the
            URL, timestamps and visible engagement. Save the direct link. Do not engage with the
            account, comment, or share it further; engagement can increase distribution and
            complicate later claims about how far it spread.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Step 2: Secure your own accounts
          </h2>
          <p>
            Impersonation and account compromise often travel together, so treat account security as
            part of the response, not an afterthought. Change passwords on the affected platform and
            any account sharing that password, confirm two-factor authentication is enabled, review
            active sessions and connected third-party apps for anything unrecognized, and check that
            recovery email and phone details haven't been altered. If the genuine account itself
            shows signs of compromise, most platforms have a dedicated hacked-account recovery flow
            that is faster than a general report queue.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Step 3: Establish what you're dealing with
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

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Step 4: Document the case</h2>
          <p>
            Build a clear, chronological evidence file before you submit anything: what was posted,
            where, when it was first observed, how it has spread, and any prior contact with the
            account or its owner. A stronger submission — to a platform, a lawyer or an investigator
            — includes a concise statement of why the content is false or unauthorized, proof of
            authority to act on the affected party's behalf, and the specific policy the content
            violates, cited by name.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Step 5: Report through the platform's actual channels
          </h2>
          <p>
            Platform reporting tools are necessary but rarely sufficient alone — high-volume
            platforms triage reports algorithmically, and a bare report with no context often sits
            in a generic queue. Use the specific report category that matches the violation
            (impersonation, synthetic/manipulated media, or account compromise are usually distinct
            categories), attach the documented evidence, and cite the exact policy violated rather
            than describing it in general terms.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Step 6: Communicate with stakeholders — facts only
          </h2>
          <p>
            Loop in the people who need to know before they hear it elsewhere: internal stakeholders
            such as leadership, legal and communications, and — where relevant — external
            stakeholders such as clients or partners who may encounter the content. Share only
            what's confirmed versus what's still being assessed, avoid speculation about who is
            responsible or why, and avoid promising a specific removal outcome or timeline before
            either is actually known.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Step 7: Authorize the response, then escalate deliberately
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

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            Step 8: Monitor for reuploads and recurrence
          </h2>
          <p>
            A successful takedown of one instance doesn't mean the content is gone. The same media
            or a near-duplicate frequently resurfaces on mirror accounts, other platforms, or
            reposts by third parties. Keep the search terms, reverse-image or reverse-video
            references, and account identifiers from the original case on hand, and check
            periodically rather than assuming a single removal closes the matter. Ongoing monitoring
            is what turns a one-time takedown into an actual resolution.
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
              Executive First Hour Response Playbook
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
              publication. It is educational guidance, not a guarantee of any particular outcome or
              timeline.
            </p>
          </div>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Related guides</h2>
            <ul className="mt-4 space-y-2 text-xs">
              <li>
                <Link
                  to="/newsroom/deepfake-verification-guide"
                  className="landing-link text-landing-ink"
                >
                  The Deepfake Verification Guide — what "confirmed" actually requires
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/executive-first-hour-playbook"
                  className="landing-link text-landing-ink"
                >
                  The Executive First Hour Response Playbook — a condensed first move
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
