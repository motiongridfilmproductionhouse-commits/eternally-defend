import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, webPageSchema } from "@/components/public/ServiceLanding";

const PATH = "/how-it-works";
const DESCRIPTION =
  "How digital identity protection works at Eterna: verify, monitor, investigate, preserve evidence and respond under human review. Learn how the cycle works.";

export const Route = createFileRoute("/how-it-works")({
  head: () =>
    landingHead({
      path: PATH,
      title: "How Digital Identity Protection Works | Eterna Sentinel",
      description: DESCRIPTION,
    }),
  component: Page,
});

const faqs = [
  {
    q: "How does digital identity protection work?",
    a: "At Eterna Sentinel it runs as a continuous cycle: prevent misuse where possible, detect signals across agreed sources, investigate and verify them, and respond through authorized routes, then keep monitoring. Technology assists discovery; people make every consequential decision.",
  },
  {
    q: "Is Eterna a self-serve tool?",
    a: "No. Eterna is a managed protection operation. Clients work with a team that reviews findings and coordinates responses, rather than receiving raw alerts to handle alone.",
  },
  {
    q: "Why do you verify identity and authorization first?",
    a: "So Eterna only acts for people and organizations it is permitted to represent. It also stops anyone from requesting action against content in someone else's name.",
  },
  {
    q: "What will I see as a client?",
    a: "Verified findings with their evidence, what action was taken or recommended, and what is still open, delivered on an agreed rhythm, with direct escalation for anything urgent.",
  },
  {
    q: "Does Eterna remove content automatically?",
    a: "No. Eterna is not an automatic takedown service. Responses depend on authorization, platform policy and the facts of each case, and removal is never guaranteed.",
  },
  {
    q: "How long does onboarding take?",
    a: "It depends on how quickly identity and authorization can be confirmed and how broad the scope is. Eterna does not promise fixed timelines; urgent incidents are prioritised once authorization is in place.",
  },
];

function Page() {
  return (
    <ServiceLanding
      eyebrow="How It Works"
      section="Platform"
      sourcePage="how-it-works"
      title="How Digital Identity Protection Works at Eterna Sentinel"
      intro="Here is how digital identity protection works at Eterna Sentinel. Protection runs as a continuous cycle that combines technology-assisted discovery with human review: prevent, detect, investigate and respond, then monitor again. Every engagement starts with identity verification and authorization."
      schema={webPageSchema({ path: PATH, name: "How Digital Identity Protection Works", description: DESCRIPTION })}
      sections={[
        {
          kicker: "The operating model",
          heading: "A managed protection operation, not a self-serve tool.",
          body: [
            "Each engagement begins with identity verification and signed authorization, so Eterna only acts for the people and organizations it is permitted to represent.",
            "Findings are verified against Eterna's published methodology before any consequential action is taken. Technology helps find patterns across large public surfaces; people decide what those patterns mean and what happens next.",
          ],
        },
        {
          kicker: "Onboarding",
          heading: "How onboarding works, step by step.",
          body: ["Before the cycle starts, a few checks make sure the engagement is legitimate and clearly scoped:"],
          bullets: [
            "Request: you, or someone acting for you, submits a confidential request.",
            "Identity verification: Eterna confirms who the protected person or organization is.",
            "Authorization: signed authorization confirms what Eterna may do and who may instruct it.",
            "Assessment: the team reviews current exposure and any active incidents.",
            "Scope: sources, response permissions, contacts and reporting are agreed.",
            "Activation: monitoring begins and the protection cycle runs.",
          ],
          links: [{ label: "Request digital identity protection", to: "/request-protection" }],
        },
        {
          kicker: "Stage 1: Prevent",
          heading: "Reduce the chance of misuse before it starts.",
          body: [
            "What happens: Eterna helps reduce exposure where prevention is possible, for example by securing official accounts and, for authorized images, applying Eterna Image Immunization, a preventative capability currently under validation.",
            "What you see: practical recommendations and, where used, a record of which images were protected. Prevention lowers risk; it does not eliminate it.",
          ],
          links: [{ label: "Detection is not prevention", to: "/newsroom/detection-is-not-prevention" }],
        },
        {
          kicker: "Stage 2: Detect",
          heading: "Find signals across agreed sources.",
          body: [
            "What happens: supported public sources agreed during scoping are monitored for impersonation accounts, synthetic media, harmful content and reputation risk. Ordinary mentions are filtered out.",
            "What you see: nothing yet for most signals. Signals are not findings, so they go to investigation before they reach you, except where something clearly urgent needs escalation.",
          ],
        },
        {
          kicker: "Stage 3: Investigate",
          heading: "Verify, document and decide what it means.",
          body: [
            "What happens: each signal is assessed for identity match, context and potential harm against Eterna's verification standard. Findings that meet it receive an evidence record: source, timestamp, capture and context.",
            "What you see: verified findings with their evidence and a clear explanation of why they matter, or why a signal was set aside.",
          ],
          links: [{ label: "The Deepfake Verification Guide", to: "/newsroom/deepfake-verification-guide" }],
        },
        {
          kicker: "Stage 4: Respond",
          heading: "Act through authorized, eligible routes.",
          body: [
            "What happens: Eterna coordinates the response the facts and your authorization support, such as platform reports, escalation to legal counsel or support for communications decisions. Removal is never guaranteed.",
            "What you see: what was submitted, to whom and when, the platform's response when it arrives, and anything that needs your decision.",
          ],
          links: [{ label: "The Impersonation Response Guide", to: "/newsroom/impersonation-response-guide" }],
        },
        {
          kicker: "Monitor again",
          heading: "The cycle keeps running.",
          body: [
            "After a response, monitoring continues so reuploads and altered copies can be found and escalated. Each cycle adds to the record, which makes later responses faster and better documented.",
          ],
          links: [{ label: "Deepfake reuploads: why content returns", to: "/newsroom/deepfake-reuploads-after-removal" }],
        },
        {
          kicker: "Human review",
          heading: "Where people make the decisions.",
          body: [
            "Automation is used where it helps: searching agreed sources, grouping similar results and flagging possible matches. It is not used to decide whether something is a deepfake, whether an account is an impersonation or whether to report it.",
            "Those decisions are made by reviewers working to a written standard, and every consequential action is logged with who approved it. That record is what lets clients, platforms and advisors trust the outcome.",
          ],
          links: [{ label: "Security and evidence governance", to: "/security" }],
        },
        {
          kicker: "Example scenario",
          heading: "Illustrative example: one cycle end to end.",
          body: [
            "Example scenario, not a real client: monitoring flags an image that appears to show an executive at an event they never attended. Investigation confirms it is manipulated and preserves each copy. The response team reports the copies through the platform's manipulated-media route and informs the executive's communications lead. Monitoring then watches for new copies.",
          ],
        },
      ]}
      cardsHeading="Six stages of protection"
      cards={[
        { title: "1. Verify", body: "Confirm identity and authorization before monitoring begins." },
        { title: "2. Monitor", body: "Watch agreed platforms and the public web for identity misuse." },
        { title: "3. Investigate", body: "Assess each signal for relevance, identity match and harm." },
        { title: "4. Preserve evidence", body: "Retain source, timestamp and context for review." },
        { title: "5. Enforce", body: "Coordinate eligible, authorized platform or legal action." },
        { title: "6. Monitor again", body: "Track recurrence and re-uploads after a response." },
      ]}
      faqs={faqs}
      faqHeading="How digital identity protection works: questions"
      guides={[
        { label: "The Deepfake Verification Guide", to: "/newsroom/deepfake-verification-guide" },
        { label: "The Impersonation Response Guide", to: "/newsroom/impersonation-response-guide" },
        { label: "Detection is not prevention", to: "/newsroom/detection-is-not-prevention" },
        { label: "Deepfake reuploads: why content returns", to: "/newsroom/deepfake-reuploads-after-removal" },
      ]}
      related={[
        { label: "Explore Image Immunization", to: "/image-immunization" },
        { label: "Verification Methodology", to: "/methodology" },
        { label: "Deepfake Protection", to: "/deepfake-protection" },
        { label: "Enterprise Protection", to: "/enterprise-protection" },
        { label: "Request Protection", to: "/request-protection" },
      ]}
    />
  );
}
