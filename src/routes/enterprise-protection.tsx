import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema } from "@/components/public/ServiceLanding";

const PATH = "/enterprise-protection";
const DESCRIPTION =
  "Executive impersonation, brand misuse and deepfakes put companies at risk. Eterna's enterprise protection monitors and responds. Request an assessment.";

export const Route = createFileRoute("/enterprise-protection")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Executive & Enterprise Digital Protection | Eterna",
      description: DESCRIPTION,
    }),
  component: Page,
});

const faqs = [
  {
    q: "What is executive digital protection?",
    a: "Executive digital protection is a managed service that watches for misuse of a leader's identity, such as fake profiles, cloned voices and deepfake statements, then verifies findings, preserves evidence and coordinates an authorized response. At Eterna Sentinel each consequential step is reviewed by a person.",
  },
  {
    q: "How does executive impersonation protection help against voice-clone fraud?",
    a: "Eterna monitors agreed sources for fake executive profiles and synthetic media, verifies what it finds and documents it so security and finance teams can act on facts. It does not replace internal payment controls; verification procedures for urgent payment requests remain essential.",
  },
  {
    q: "Does brand impersonation protection cover fake company accounts and ads?",
    a: "Yes, within the agreed scope. Fake brand accounts, fake support pages and ads misusing the brand are assessed and, where eligible and authorized, reported through the relevant platform route. Removal is never guaranteed.",
  },
  {
    q: "Who inside our organization authorizes action?",
    a: "Authorization is agreed at activation. Most organizations nominate an executive sponsor plus contacts in security, legal and communications. Eterna confirms that the people instructing it are entitled to act for the organization and for any named executives.",
  },
  {
    q: "Will you work alongside our existing security and PR providers?",
    a: "Yes. Eterna is designed to slot into existing teams, sharing evidence records and findings with the people you nominate rather than replacing them.",
  },
  {
    q: "What reporting do we receive?",
    a: "You receive findings with their evidence, the action taken or recommended, and open items, on a rhythm agreed during scoping, plus direct escalation when something needs urgent attention.",
  },
];

function Page() {
  return (
    <ServiceLanding
      eyebrow="Enterprise Protection"
      section="Solutions"
      sourcePage="enterprise-protection"
      title="Executive Digital Protection for Leaders, Brands and Institutions"
      intro="Executive digital protection from Eterna Sentinel helps organizations monitor, investigate and respond to impersonation, synthetic media and reputation threats that target their executives, brand and people. Every finding is verified and documented, and every consequential action is authorized and reviewed by a person."
      schema={serviceSchema({
        path: PATH,
        name: "Eterna Sentinel Enterprise Protection",
        serviceType: "Executive and brand impersonation protection",
        description: DESCRIPTION,
      })}
      sections={[
        {
          kicker: "The enterprise risk",
          heading: "Executive and brand identity are now attack surfaces.",
          body: [
            "The voice, face and name of a senior leader carry authority inside and outside the organization. So does a brand. That authority is what attackers borrow when they impersonate either one.",
            "Common patterns include:",
          ],
          bullets: [
            "CEO voice-clone fraud: synthetic audio of a leader used to pressure staff into urgent payments or data transfers.",
            "Fake executive profiles: accounts posing as leaders to contact employees, partners, journalists or investors.",
            "Fake brand accounts: support pages, recruiters or shops using the brand to collect money or personal data.",
            "Deepfake statements: fabricated video or audio of an executive announcing something that never happened.",
          ],
          links: [
            { label: "How AI impersonation damages reputation", to: "/newsroom/ai-impersonation-reputation-damage" },
          ],
        },
        {
          kicker: "Coverage",
          heading: "Executive impersonation protection and brand coverage.",
          body: [
            "Scope is agreed per organization. A typical engagement covers three layers, each monitored across the supported public sources chosen during scoping:",
          ],
          bullets: [
            "Executives: named leaders and, where agreed, board members or spokespeople.",
            "Brands: company and product names, logos and official accounts, for brand impersonation protection.",
            "Institutions: universities, foundations and public bodies whose name is used to lend credibility to scams or false claims.",
          ],
        },
        {
          kicker: "Governance",
          heading: "A governance and authorization model you can audit.",
          body: [
            "Eterna verifies that it is authorized to act for the organization and for each named executive before monitoring begins. The engagement defines what Eterna may do on its own, what needs approval, and who gives it.",
            "Every finding carries an evidence record with source, timestamp and context. Every action is logged with who approved it. Removal is never guaranteed; outcomes depend on authorization, platform policy and the facts of each case.",
          ],
        },
        {
          kicker: "Your teams",
          heading: "Working with security, legal and communications.",
          body: [
            "Impersonation incidents touch several teams at once. Security needs to know whether a fake profile is part of a phishing or fraud attempt. Legal needs a record it can rely on. Communications needs to know whether and how to say something publicly.",
            "Eterna shares verified findings and evidence with the contacts each team nominates, so they work from the same facts. Eterna does not give legal advice and does not speak publicly for clients.",
          ],
        },
        {
          kicker: "First hour",
          heading: "What happens in the first hour of an incident.",
          body: [
            "When a deepfake or impersonation involving an executive surfaces, the early decisions matter most: confirm what it is, preserve evidence, protect internal channels, decide who speaks and avoid amplifying the fake.",
            "Eterna's published playbook sets out those decisions for leadership and communications teams.",
          ],
          links: [{ label: "The Executive First Hour Response Playbook", to: "/newsroom/executive-first-hour-playbook" }],
        },
        {
          kicker: "Example scenario",
          heading: "Illustrative example: a cloned voice note.",
          body: [
            "Example scenario, not a real client: a finance employee receives a voice note that sounds like the CEO asking for an urgent transfer. The organization's own controls stop the payment. Eterna checks agreed sources for related fake profiles, documents the accounts it finds, reports eligible ones through platform routes and briefs security and communications with the evidence.",
          ],
        },
        {
          kicker: "Reporting",
          heading: "Reporting that leadership can act on.",
          body: [
            "Reports list verified findings, the evidence behind each one, the action taken or recommended, and what remains open. The reporting rhythm and recipients are agreed during scoping, with direct escalation when something needs urgent attention.",
          ],
          links: [{ label: "Why companies need reputation monitoring", to: "/newsroom/why-companies-need-reputation-monitoring" }],
        },
      ]}
      cardsHeading="What enterprise protection covers"
      cards={[
        { title: "Executive impersonation", body: "Fake profiles and synthetic media using leadership identities." },
        { title: "Brand misuse", body: "Unauthorized use of brand identity in scams and fake endorsements." },
        { title: "Deepfake incidents", body: "Manipulated video, imagery and audio involving the organization." },
        { title: "Reputation threats", body: "Emerging defamatory or misleading narratives across the public web." },
        { title: "Evidence preservation", body: "Source, timestamp and context retained for legal and platform review." },
        { title: "Incident coordination", body: "Structured response when a threat needs urgent attention." },
      ]}
      faqs={faqs}
      faqHeading="Executive digital protection questions"
      guides={[
        { label: "The Executive First Hour Response Playbook", to: "/newsroom/executive-first-hour-playbook" },
        { label: "Why brand reputation risk is a business risk", to: "/newsroom/brand-reputation-risk-business-risk" },
        { label: "How AI impersonation damages reputation", to: "/newsroom/ai-impersonation-reputation-damage" },
        { label: "Why companies need reputation monitoring", to: "/newsroom/why-companies-need-reputation-monitoring" },
      ]}
      related={[
        { label: "Deepfake Protection", to: "/deepfake-protection" },
        { label: "Impersonation Protection", to: "/ai-impersonation" },
        { label: "Incident Response", to: "/incident-response" },
        { label: "How Eterna Sentinel Works", to: "/how-it-works" },
        { label: "Request Protection", to: "/request-protection" },
      ]}
    />
  );
}
