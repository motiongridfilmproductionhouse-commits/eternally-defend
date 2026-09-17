import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom/someone-made-a-deepfake-of-me";

export const Route = createFileRoute("/newsroom_/someone-made-a-deepfake-of-me")({
  head: () => ({
    meta: [
      { title: "Someone Made a Deepfake of Me — What Should I Do? — Eterna Sentinel" },
      {
        name: "description",
        content:
          "A direct, step-by-step answer: what to do right now if you've discovered a deepfake, manipulated image or synthetic video of yourself, before you do anything else.",
      },
      {
        property: "og:title",
        content: "Someone Made a Deepfake of Me — What Should I Do? — Eterna Sentinel",
      },
      {
        property: "og:description",
        content:
          "A direct, step-by-step answer: what to do right now if you've discovered a deepfake, manipulated image or synthetic video of yourself, before you do anything else.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: SomeoneMadeADeepfakeOfMePage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Someone Made a Deepfake of Me — What Should I Do?",
    author: { "@type": "Organization", name: "Eterna Sentinel" },
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    mainEntityOfPage: CANONICAL,
  });
}

const steps = [
  {
    title: "1. Don't respond to whoever posted or sent it",
    body: "However tempting, don't reply, confront or negotiate with the source directly. It can prompt them to delete evidence, move the content elsewhere, or escalate. Deal with the content and the platform first.",
    group: "Preserve",
  },
  {
    title: "2. Don't delete anything on your own accounts yet",
    body: "It's a natural instinct to want it gone, but don't rush to delete your own posts, comments or messages connected to the situation unless there's an immediate safety reason to. You may need that context later, and it's easy to lose something useful in a moment of panic.",
    group: "Preserve",
  },
  {
    title: "3. Capture the evidence right now",
    body: "Screenshot or screen-record the content itself, the account or page that posted it, the exact URL, and the timestamp. Do this before reporting it, reporting sometimes triggers removal or an account lock that can make the original harder to access afterward.",
    group: "Preserve",
  },
  {
    title: "4. Capture the surrounding context too",
    body: "Captions, comments, who shared or reposted it, and anything said about where it came from. Context is often what makes evidence useful later, not just the content in isolation.",
    group: "Preserve",
  },
  {
    title: "5. Write down a timeline while it's fresh",
    body: "When you first saw it, where, who told you if someone did. A simple, timestamped note taken now is more reliable than trying to reconstruct the sequence of events days later.",
    group: "Document",
  },
  {
    title: "6. Check how far it's spread",
    body: "Look for the same content, or variations of it, on other platforms or accounts. This tells you how urgent the response needs to be and where to focus reporting effort first.",
    group: "Document",
  },
  {
    title: "7. Report it through the platform's specific tools",
    body: "Most major platforms have a dedicated reporting path for impersonation, non-consensual synthetic imagery or manipulated media, separate from a general abuse report, and it's usually reviewed faster. Use the specific category if one exists.",
    group: "Report",
  },
  {
    title: "8. Tell the people who need to know, before they find out elsewhere",
    body: "Depending on your situation, that could be an employer, a communications contact, or close family. Being the one to raise it tends to go better than someone else finding it first and asking you about it.",
    group: "Report",
  },
  {
    title: "9. Get a qualified second opinion before deciding what's next",
    body: "What makes sense after the initial response, a further platform escalation, a legal step, involving law enforcement, depends on jurisdiction, the platform, and the nature of the content. This isn't legal advice, and it isn't a substitute for it: where a legal question is genuinely involved, that's a conversation for a qualified lawyer in the relevant jurisdiction, not a general guide.",
    group: "Report",
  },
  {
    title: "10. Set up ongoing monitoring",
    body: "A takedown handles the copy you found. It doesn't guarantee the content, or a variation of it, won't resurface elsewhere. Monitoring afterward is what catches that, rather than treating the first resolution as the end of it.",
    group: "Monitor",
  },
];

function SomeoneMadeADeepfakeOfMePage() {
  return (
    <PublicPage
      eyebrow="Newsroom · Emergency guide"
      title="Someone Made a Deepfake of Me — What Should I Do?"
      intro="Short answer: don't engage the person who posted it, preserve evidence before it disappears, report it through the platform's specific impersonation or synthetic-media tools, and get a qualified second opinion before deciding what's next. The full 10-step framework below walks through each of those in order."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-8 px-6 text-sm leading-7 text-landing-muted">
          <p>
            If you're reading this because it just happened to you, this page is written to be
            useful right now, not just as background reading. It's general guidance, not legal
            advice, and it can't replace a qualified professional who knows the specifics of your
            situation, but it's meant to help you avoid the most common mistakes in the first hour
            or so, while you're still figuring out what happened.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">
            The 10-step framework: preserve, document, report, monitor
          </h2>

          <div className="space-y-8">
            {steps.map((step) => (
              <div key={step.title} className="border-t border-landing-line pt-6">
                <p className="landing-kicker text-xs text-landing-accent">{step.group}</p>
                <h3 className="mt-2 text-base font-semibold text-landing-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-landing-muted">{step.body}</p>
              </div>
            ))}
          </div>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">A note on what this isn't</h2>
          <p>
            This framework is not legal advice, and following it is not a substitute for qualified
            legal counsel. Whether specific content is illegal where you are, what remedies are
            realistically available, and how quickly a platform or court will act, all depend on
            jurisdiction and the specifics of the content, and vary considerably. If those questions
            matter to your decision about what to do next, that's a conversation for a lawyer
            licensed where you are, not something this page, or any general guide, can responsibly
            answer for you.
          </p>
          <p>
            It's also not a guarantee. No response framework, and no detection, monitoring or
            takedown effort, guarantees a specific outcome or a specific timeline. What it can do is
            reduce the chance of losing evidence or making the situation harder to address, in the
            window right after you find out.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-landing-ink">Reducing future exposure</h2>
          <p>
            Everything above is about responding to a deepfake that already exists. There's also an
            earlier layer, reducing how usable your authorized images are as source material for
            this kind of misuse in the first place, applied before an image is published rather than
            after. See{" "}
            <Link to="/image-immunization" className="landing-link text-landing-ink">
              Eterna Image Immunization
            </Link>{" "}
            and{" "}
            <Link to="/deepfake-protection" className="landing-link text-landing-ink">
              Deepfake Protection
            </Link>{" "}
            for that side of it. Neither one changes what you need to do about content that's
            already out there, which is what this page is for.
          </p>

          <div className="border-t border-landing-line pt-8">
            <h2 className="text-sm font-semibold text-landing-ink">Related reading</h2>
            <ul className="mt-4 space-y-2 text-xs">
              <li>
                <Link to="/deepfake-protection" className="landing-link text-landing-ink">
                  Deepfake Protection — the full overview
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/impersonation-response-guide"
                  className="landing-link text-landing-ink"
                >
                  Impersonation Response Guide
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/deepfake-verification-guide"
                  className="landing-link text-landing-ink"
                >
                  Deepfake Verification Guide
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/executive-first-hour-playbook"
                  className="landing-link text-landing-ink"
                >
                  Executive First-Hour Response Playbook
                </Link>
              </li>
              <li>
                <Link to="/online-reputation-protection" className="landing-link text-landing-ink">
                  Online Reputation Protection
                </Link>
              </li>
              <li>
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Eterna's verification methodology
                </Link>
              </li>
              <li>
                <Link to="/contact" className="landing-link text-landing-ink">
                  Contact Eterna
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
