import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema, webPageSchema } from "@/components/public/ServiceLanding";

const PATH = "/public-figure-protection";
const DESCRIPTION =
  "Public figures and executives face impersonation, deepfakes and reputation attacks. Eterna's public figure protection responds. Request an assessment.";

export const Route = createFileRoute("/public-figure-protection")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Public Figure & VIP Digital Protection | Eterna Sentinel",
      description: DESCRIPTION,
    }),
  component: Page,
});

const faqs = [
  {
    q: "What is public figure protection?",
    a: "Public figure protection is a managed service that monitors agreed public sources for misuse of a person's name, face and voice, verifies what it finds, preserves evidence and coordinates an authorized response. At Eterna Sentinel, every consequential step is reviewed by a person.",
  },
  {
    q: "Does Eterna offer celebrity deepfake protection?",
    a: "Yes. Suspected deepfakes of a client are verified against Eterna's published methodology, documented with source and context, and escalated through the appropriate platform or advisor route. Eterna does not guarantee that any content will be removed; outcomes depend on platform policy and the facts of each case.",
  },
  {
    q: "Can a manager, agent or lawyer request protection on someone's behalf?",
    a: "A representative can start the request. Eterna still verifies the identity of the person being protected and confirms that the representative is authorized to act for them before monitoring or any response begins.",
  },
  {
    q: "Will Eterna act without our approval?",
    a: "No. The scope agreed at activation defines what Eterna may do. Anything outside that scope, or any step with significant consequences, is raised with the client or their nominated contact first.",
  },
  {
    q: "Is the engagement confidential?",
    a: "Yes. Eterna does not publish client names, case details or outcomes. Evidence and case notes are held in access-controlled records and shared only with the client and the people they authorize.",
  },
  {
    q: "Do you monitor the whole internet?",
    a: "No monitoring system can cover the entire internet. Eterna monitors the supported public sources agreed for each engagement and is clear about what is and is not covered.",
  },
];

function Page() {
  return (
    <ServiceLanding
      eyebrow="Public Figure Protection"
      section="Solutions"
      sourcePage="public-figure-protection"
      title="Public Figure Protection for Celebrities, Creators and Executives"
      intro="Public figure protection from Eterna Sentinel is VIP digital protection for actors, athletes, creators, founders, executives and other high-profile people whose name, face and voice are targets for misuse. Eterna monitors, verifies, preserves evidence and coordinates an authorized response, with human review at every consequential step."
      schema={`[${webPageSchema({ path: PATH, name: "Public Figure & VIP Digital Protection", description: DESCRIPTION })},${serviceSchema({ path: PATH, name: "Eterna Sentinel Public Figure Protection", serviceType: "Public figure digital identity protection", description: DESCRIPTION })}]`}
      sections={[
        {
          kicker: "Who it's for",
          heading: "Built for people whose identity is part of their work.",
          body: [
            "A public identity is valuable, and that is exactly why it gets copied. The people most exposed are the ones whose face, voice and name are already widely recognised and trusted by an audience.",
            "Eterna's public figure protection is designed for:",
          ],
          bullets: [
            "Actors, musicians and entertainers whose likeness is widely published.",
            "Athletes and sports personalities with large fan followings.",
            "Creators and influencers whose audience trusts their recommendations.",
            "Founders and executives who speak publicly for a company.",
            "Managers, agents, publicists and family offices who act on behalf of any of the above.",
          ],
        },
        {
          kicker: "Threats",
          heading: "What public figures are most often targeted with.",
          body: [
            "The threats change as tools change, but most cases fall into a small number of patterns. Each one can mislead fans, partners or investors and damage a reputation built over years.",
          ],
          bullets: [
            "Deepfakes: fabricated video or imagery showing the person doing or saying something they never did.",
            "Fake accounts: profiles using the person's name and photos to collect followers, messages or money.",
            "Cloned voices: synthetic audio used in calls, voice notes or fabricated clips.",
            "Fake endorsements: ads or posts implying the person supports a product, scheme or cause.",
            "Leaked or fabricated content: private material shared without consent, or invented material presented as real.",
            "Reputational attacks: coordinated false claims or misleading narratives spread across platforms.",
          ],
          links: [
            { label: "Someone made a deepfake of me: what to do", to: "/newsroom/someone-made-a-deepfake-of-me" },
            { label: "How AI impersonation damages reputation", to: "/newsroom/ai-impersonation-reputation-damage" },
          ],
        },
        {
          kicker: "What's included",
          heading: "What VIP digital protection from Eterna includes.",
          body: [
            "Every engagement is scoped to the person and their exposure, but the core of the service stays the same. Technology helps find signals; people decide what they mean and what happens next.",
          ],
          bullets: [
            "Monitoring of the supported public sources agreed for the engagement.",
            "Verification of each signal for identity match, context and potential harm before it is treated as a finding.",
            "An evidence record for each finding: source, timestamp, capture and context, kept for platform, legal or advisor review.",
            "Platform reporting through the eligible policy route when the facts and the client's authorization support it.",
            "Escalation to incident response, legal counsel or communications advisors when a case needs more than a report.",
            "Regular reporting to the client or their team on what was found, what was done and what is still open.",
          ],
        },
        {
          kicker: "Celebrity deepfake protection",
          heading: "How suspected deepfakes are handled.",
          body: [
            "A convincing fake can spread before anyone checks it. Eterna does not label something a deepfake because it looks suspicious; it applies a published verification standard first, so any report or statement rests on documented facts.",
            "Once a finding is verified, the evidence is preserved before anything is reported, because posts can disappear or change. The response route is then chosen based on platform policy and what the client has authorized.",
          ],
          links: [{ label: "How to preserve deepfake evidence", to: "/newsroom/how-to-preserve-deepfake-evidence" }],
        },
        {
          kicker: "Engagement",
          heading: "How an engagement works.",
          body: ["Protection starts with checks, not with monitoring, so Eterna only ever acts for people it is permitted to represent."],
          bullets: [
            "Request: the person or their representative submits a confidential request.",
            "Verify identity and authorization: Eterna confirms who the protected person is and who may act for them.",
            "Assess: the team reviews current exposure and any active issues.",
            "Define scope: sources, response permissions, contacts and reporting rhythm are agreed in writing.",
            "Activate: monitoring begins and findings flow through human review.",
          ],
        },
        {
          kicker: "Your team",
          heading: "Working with managers, agents and legal counsel.",
          body: [
            "Many public figures prefer that their team handles day-to-day contact. Eterna can work through a nominated manager, agent, publicist or lawyer, with clear rules on who receives findings and who approves action.",
            "Where a case may lead to legal steps, the evidence record is prepared so counsel can review it directly. Eterna does not give legal advice and does not replace your lawyers; it supplies the documented facts they need.",
          ],
        },
        {
          kicker: "Example scenario",
          heading: "Illustrative example: a fake endorsement ad.",
          body: [
            "Example scenario, not a real client: a creator's team notices ads using an edited clip of the creator promoting an investment scheme. Eterna verifies that the clip is manipulated, captures each ad with its source and timestamp, reports it through the platform's impersonation and scam routes, and keeps monitoring for new versions. The team receives a short report at each step.",
          ],
        },
        {
          kicker: "Confidentiality",
          heading: "Discreet by default.",
          body: [
            "Eterna does not publish client names, case details or outcomes, and does not use clients in marketing. Evidence and notes are held in access-controlled records and shared only with the people the client authorizes.",
          ],
        },
      ]}
      faqs={faqs}
      faqHeading="Public figure protection questions"
      guides={[
        { label: "Someone made a deepfake of me: what to do", to: "/newsroom/someone-made-a-deepfake-of-me" },
        { label: "How AI impersonation damages reputation", to: "/newsroom/ai-impersonation-reputation-damage" },
        { label: "The Impersonation Response Guide", to: "/newsroom/impersonation-response-guide" },
        { label: "How to preserve deepfake evidence", to: "/newsroom/how-to-preserve-deepfake-evidence" },
      ]}
      related={[
        { label: "Monitoring", to: "/monitoring" },
        { label: "Impersonation Protection", to: "/ai-impersonation" },
        { label: "Deepfake Protection", to: "/deepfake-protection" },
        { label: "Explore Image Immunization", to: "/image-immunization" },
        { label: "Request Protection", to: "/request-protection" },
      ]}
    />
  );
}
