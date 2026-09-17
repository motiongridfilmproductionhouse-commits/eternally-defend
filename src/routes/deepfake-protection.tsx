import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/deepfake-protection";

export const Route = createFileRoute("/deepfake-protection")({
  head: () => ({
    meta: [
      { title: "Deepfake Protection: Detect, Respond and Protect Your Digital Identity" },
      {
        name: "description",
        content:
          "What deepfake protection actually covers, the threats it responds to, an 8-step framework for what to do if you've been targeted, and how proactive image protection fits alongside detection and response.",
      },
      {
        property: "og:title",
        content: "Deepfake Protection: Detect, Respond and Protect Your Digital Identity",
      },
      {
        property: "og:description",
        content:
          "What deepfake protection actually covers, the threats it responds to, an 8-step framework for what to do if you've been targeted, and how proactive image protection fits alongside detection and response.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: DeepfakeProtectionPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Deepfake Protection: Detect, Respond and Protect Your Digital Identity",
    description:
      "What deepfake protection actually covers, the threats it responds to, an 8-step framework for what to do if you've been targeted, and how proactive image protection fits alongside detection and response.",
    publisher: { "@type": "Organization", name: "Eterna Sentinel" },
    mainEntityOfPage: CANONICAL,
  });
}

const definitionTerms = [
  {
    term: "Detection",
    description:
      "Identifying that a piece of media, an image, video or audio clip, is synthetic or has been manipulated, using technical analysis, provenance signals or human review.",
  },
  {
    term: "Verification",
    description:
      "Establishing whether a specific piece of content is authentic or fabricated, and documenting how that conclusion was reached, so it holds up under scrutiny.",
  },
  {
    term: "Response",
    description:
      "The immediate steps taken once manipulated content targeting someone is confirmed: preserving evidence, assessing exposure and deciding what to do next.",
  },
  {
    term: "Removal and reporting",
    description:
      "Getting confirmed harmful content taken down, through platform reporting tools, formal takedown requests, or escalation where a platform doesn't respond.",
  },
  {
    term: "Monitoring",
    description:
      "Ongoing watching for new instances, reposts or variations of content that has already targeted someone, since a single takedown rarely ends the exposure.",
  },
  {
    term: "Preventative image protection",
    description:
      "Work done before publication to reduce how usable an authorized image is as raw material for unauthorized AI reuse in the first place, rather than responding after the fact.",
  },
];

const threats = [
  {
    title: "Face swaps",
    description:
      "A person's face replacing another's in an existing photo or video, often used to fabricate a scene that never happened.",
  },
  {
    title: "Synthetic videos",
    description:
      "Fully AI-generated video of a person doing or saying something they never did, built from source images or footage rather than edited from a real recording.",
  },
  {
    title: "Cloned voice",
    description:
      "AI-generated audio designed to sound like a specific person, used in calls, voicemails or videos to imitate their voice without their involvement.",
  },
  {
    title: "Fake endorsements",
    description:
      "Fabricated video, audio or images used to make it look like someone is promoting a product, service or investment they have no connection to.",
  },
  {
    title: "Non-consensual synthetic imagery",
    description:
      "AI-generated images depicting a real person in fabricated situations they never consented to and that never occurred.",
  },
  {
    title: "Fake social profiles",
    description:
      "Accounts built to impersonate a real person, often using AI-manipulated or entirely synthetic profile images to appear more convincing.",
  },
  {
    title: "Identity fraud",
    description:
      "Synthetic media used as supporting material for broader fraud, such as fabricated video calls or voice messages used to authorize a transaction or extract information.",
  },
  {
    title: "Executive impersonation",
    description:
      "Fabricated video, audio or messaging made to look like it came from a company executive, often used to pressure employees, vendors or investors into acting quickly.",
  },
];

const responseSteps = [
  {
    step: "1. Don't engage the source directly",
    description:
      "Avoid replying to, confronting or negotiating with whoever posted or sent the content. Engaging can tip them off, prompt them to move or delete evidence, or escalate the situation before you've had a chance to assess it.",
  },
  {
    step: "2. Preserve evidence before anything disappears",
    description:
      "Take screenshots or screen recordings of the content, the account or page that posted it, the URL, and any surrounding context (captions, comments, timestamps). Content gets deleted, edited or taken down, sometimes within hours.",
  },
  {
    step: "3. Document what you're seeing, in writing, as you go",
    description:
      "Note when you first saw it, where, and anything else relevant, while it's fresh. A simple timestamped log is more useful later than trying to reconstruct events from memory.",
  },
  {
    step: "4. Assess where it's spreading",
    description:
      "Check whether the same content, or variations of it, appear elsewhere: other platforms, reposts, or forwarded copies. This shapes how urgent the response needs to be and where reporting efforts should focus first.",
  },
  {
    step: "5. Report it through the platform's own tools",
    description:
      "Most major platforms have reporting flows for impersonation, non-consensual synthetic imagery and manipulated media specifically, which are usually reviewed faster than a general abuse report.",
  },
  {
    step: "6. Loop in people who need to know before they find out elsewhere",
    description:
      "Depending on the situation, that might be an employer, a communications or legal contact, or close family. Being proactive tends to go better than someone finding it on their own first.",
  },
  {
    step: "7. Get a second, qualified opinion before deciding what's next",
    description:
      "What happens next, whether that involves a platform escalation, a legal step or something else, depends on jurisdiction, the platform involved and the nature of the content. This is the point to bring in someone qualified rather than guessing.",
  },
  {
    step: "8. Keep monitoring after the initial response",
    description:
      "A single takedown doesn't guarantee the content won't resurface or spread further. Ongoing monitoring is what catches reposts and variations after the first response is done.",
  },
];

function DeepfakeProtectionPage() {
  return (
    <PublicPage
      eyebrow="Deepfake Protection"
      title="Deepfake Protection: Detect, Respond and Protect Your Digital Identity"
      intro="A practical overview of what deepfake protection actually covers, the range of threats it responds to, a step-by-step framework for what to do if you or someone you represent has been targeted, and how proactive image protection fits alongside detection and response, honestly, including its limits."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl space-y-6 px-6 text-sm leading-7 text-landing-muted">
          <h2 className="landing-kicker">What "deepfake protection" actually means</h2>
          <p>
            "Deepfake protection" gets used as a catch-all for several distinct kinds of work, which
            is part of why it's confusing when you're trying to figure out what you actually need.
            They're related, but they're not the same thing, and a service or tool that's good at
            one isn't necessarily doing any of the others.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2">
            {definitionTerms.map((item) => (
              <div key={item.term} className="landing-feature-card bg-landing p-8">
                <h3 className="text-sm font-semibold text-landing-ink">{item.term}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-sm leading-7 text-landing-muted">
          <p>
            Most real protection involves several of these working together: detection or
            verification to establish what you're dealing with, response and removal to act on it,
            monitoring so it doesn't quietly come back, and, where possible, preventative work done
            before an image is ever published so there's less raw material available to misuse in
            the first place.
          </p>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="landing-kicker">Common threats this covers</h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-landing-muted">
            Deepfake and synthetic-media threats take several different forms, and they don't all
            look the same or spread the same way.
          </p>
          <div className="mt-10 grid gap-px overflow-hidden border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-4">
            {threats.map((threat) => (
              <div key={threat.title} className="landing-feature-card bg-landing p-6">
                <h3 className="text-sm font-semibold text-landing-ink">{threat.title}</h3>
                <p className="mt-3 text-xs leading-6 text-landing-muted">{threat.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">If you've been targeted: an 8-step immediate response</h2>
          <p className="mt-4 text-sm leading-7 text-landing-muted">
            If you believe you, or someone you represent, has been targeted by a deepfake,
            impersonation or other manipulated media, here's a general framework for the first
            steps. This is general guidance, not legal advice, and it isn't a substitute for
            qualified help in a specific situation, see the note on getting specialist support
            below. If this is happening to you right now, the more detailed walkthrough in{" "}
            <Link
              to="/newsroom/someone-made-a-deepfake-of-me"
              className="landing-link text-landing-ink"
            >
              Someone Made a Deepfake of Me — What Should I Do?
            </Link>{" "}
            may be more useful than this overview.
          </p>
          <ol className="mt-10 space-y-8">
            {responseSteps.map((item) => (
              <li
                key={item.step}
                className="border-t border-landing-line pt-6 first:border-t-0 first:pt-0"
              >
                <h3 className="text-sm font-semibold text-landing-ink">{item.step}</h3>
                <p className="mt-2 text-sm leading-6 text-landing-muted">{item.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">Getting qualified help</h2>
          <p className="mt-4 text-sm leading-7 text-landing-muted">
            What happens after the immediate response depends heavily on the specifics: which
            platforms are involved, what jurisdiction applies, whether the content is being used for
            fraud rather than just harassment, and what outcome you're actually looking for. That's
            a reasonable point to involve people with the right expertise, a lawyer where legal
            questions are involved, a platform-relations or trust-and-safety specialist for
            large-scale removal, or a digital protection service that handles this as ongoing work
            rather than a one-time report. Trying to navigate all of it alone, especially while it's
            actively unfolding, is harder than it needs to be.
          </p>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <h2 className="landing-kicker">Prevention: reducing exposure before it happens</h2>
              <p className="mt-4 text-sm leading-7 text-landing-muted">
                Detection, response and monitoring all happen after content already exists. There's
                also an earlier layer: reducing how usable an authorized image is as source material
                for unauthorized AI reuse in the first place, applied at the point an image is
                prepared for publication, before it's ever shared. That's the idea behind{" "}
                <Link to="/image-immunization" className="landing-link text-landing-ink">
                  Eterna Image Immunization (EIP)
                </Link>
                , Eterna's proprietary pre-publication image protection technology, developed
                through Eterna's internal research and development and currently under validation.
              </p>
              <p className="mt-4 text-sm leading-7 text-landing-muted">
                EIP doesn't replace detection, response or monitoring, and it isn't designed to.
                It's an earlier, complementary layer aimed at reducing how much of that later work
                is needed, not a substitute for it. See{" "}
                <Link
                  to="/newsroom/detection-is-not-prevention"
                  className="landing-link text-landing-ink"
                >
                  Detection Is Not Prevention
                </Link>{" "}
                for the fuller case for why both matter.
              </p>
            </div>
            <div>
              <h2 className="landing-kicker">Limitations, stated plainly</h2>
              <p className="mt-4 text-sm leading-7 text-landing-muted">
                No detection method, monitoring service or preventative technique, including EIP,
                can guarantee total prevention of deepfakes, impersonation or synthetic-media
                misuse. Systems and techniques on both sides of this problem keep changing. Any
                protection approach should be understood as reducing risk and improving your ability
                to respond quickly, not as an absolute guarantee that misuse won't happen.
              </p>
              <p className="mt-4 text-sm leading-7 text-landing-muted">
                For how Eterna approaches confirming that a piece of content is actually manipulated
                before treating it as such, see{" "}
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Methodology
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-landing-line py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="landing-kicker">Frequently asked questions</h2>
          <Accordion type="single" collapsible className="mt-8">
            <AccordionItem value="is-deepfake-illegal">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                Is it illegal to make a deepfake of someone?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                It depends on the jurisdiction, the type of content, and how it's used. Laws in this
                area vary and are still evolving in many places. This isn't legal advice, if the
                legal status of a specific situation matters to your decision, that's a question for
                qualified legal counsel in the relevant jurisdiction.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="can-detection-catch-everything">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                Can detection tools catch every deepfake?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                No. Detection accuracy varies by content type, generation method and how the content
                has been re-compressed or altered since creation. No detection tool should be
                treated as infallible, which is part of why verification and human review remain
                part of a responsible process.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="prevent-entirely">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                Can I prevent someone from ever making a deepfake of me?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                No approach, including preventative image protection like EIP, can guarantee that.
                What's realistic is reducing how usable your existing public images are as source
                material, and being prepared to respond quickly if something does surface.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="eip-vs-detection">
              <AccordionTrigger className="text-left text-sm font-semibold text-landing-ink">
                How is EIP different from deepfake detection?
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-6 text-landing-muted">
                Detection identifies synthetic content after it exists. EIP works earlier, before an
                image is published, aiming to reduce how useful it is as raw material for AI
                identity replication in the first place. They address different points in the
                timeline and are meant to work alongside each other, not instead of each other.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      <section className="border-t border-landing-line bg-landing-soft py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="landing-kicker">Get help with a specific situation</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-landing-muted">
            If you need to report an active incident or want to talk through what protection could
            look like for you or your organization, reach out.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/contact">Contact Eterna</Link>
          </Button>

          <div className="mt-12 border-t border-landing-line pt-8 text-left">
            <h2 className="text-xs font-semibold uppercase text-landing-ink">Related reading</h2>
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              <li>
                <Link
                  to="/newsroom/someone-made-a-deepfake-of-me"
                  className="landing-link text-landing-ink"
                >
                  Someone Made a Deepfake of Me — What Should I Do?
                </Link>
              </li>
              <li>
                <Link to="/image-immunization" className="landing-link text-landing-ink">
                  Eterna Image Immunization
                </Link>
              </li>
              <li>
                <Link
                  to="/newsroom/detection-is-not-prevention"
                  className="landing-link text-landing-ink"
                >
                  Detection Is Not Prevention
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
                <Link to="/methodology" className="landing-link text-landing-ink">
                  Methodology
                </Link>
              </li>
              <li>
                <Link to="/security" className="landing-link text-landing-ink">
                  Security &amp; Governance
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
