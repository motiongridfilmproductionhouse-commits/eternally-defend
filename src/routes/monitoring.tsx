import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema, webPageSchema } from "@/components/public/ServiceLanding";

const PATH = "/monitoring";
const DESCRIPTION =
  "Monitor impersonation, synthetic media, harmful content and emerging digital identity risks with Eterna Sentinel's continuous monitoring capabilities.";

export const Route = createFileRoute("/monitoring")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Digital Identity Monitoring | Eterna Sentinel",
      description: DESCRIPTION,
    }),
  component: Page,
});

function Page() {
  return (
    <ServiceLanding
      eyebrow="Monitoring"
      section="Platform"
      sourcePage="monitoring"
      title="Continuous Digital Identity Monitoring"
      intro="Eterna monitors supported public sources for potential threats to an authorized client's identity, then routes identified signals to human review."
      schema={`[${webPageSchema({ path: PATH, name: "Digital Identity Monitoring", description: DESCRIPTION })},${serviceSchema({ path: PATH, name: "Eterna Sentinel Monitoring", serviceType: "Digital identity monitoring", description: DESCRIPTION })}]`}
      sections={[
        {
          kicker: "Scope",
          heading: "Monitored sources, agreed in advance.",
          body: [
            "Monitoring covers the supported public sources agreed for each engagement. It does not cover the entire internet, and no monitoring system can detect every threat.",
            "Each identified signal is assessed for identity match, context and potential harm before it is treated as a finding.",
          ],
        },
        {
          kicker: "After an incident",
          heading: "Monitoring continues once a response is underway.",
          body: [
            "Harmful content can recur or be re-uploaded elsewhere. Monitoring continues after an initial response so recurrence can be identified and escalated.",
          ],
        },
      ]}
      cardsHeading="What monitoring helps identify"
      cards={[
        { title: "Impersonation discovery", body: "Accounts and pages that may be using a client's name, likeness or identity." },
        { title: "Synthetic media signals", body: "Potential deepfakes and manipulated imagery, video or audio." },
        { title: "Reputation risk", body: "Emerging defamatory or misleading content in monitored sources." },
        { title: "Harmful content signals", body: "Early signals of abuse, leaks or coordinated harassment." },
        { title: "Evidence preservation", body: "Source, timestamp and context retained when a signal is identified." },
        { title: "Escalation readiness", body: "Verified findings routed to incident response when action is needed." },
      ]}
      related={[
        { label: "How Eterna Sentinel Works", to: "/how-it-works" },
        { label: "Incident Response", to: "/incident-response" },
        { label: "Deepfake Protection", to: "/deepfake-protection" },
        { label: "Public Figure Protection", to: "/public-figure-protection" },
        { label: "Request Protection", to: "/request-protection" },
      ]}
    />
  );
}
