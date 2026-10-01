import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema } from "@/components/public/ServiceLanding";

const PATH = "/incident-response";
const DESCRIPTION =
  "Digital identity incident response from Eterna Sentinel: rapid verification, evidence preservation and coordinated response for deepfakes, impersonation, leaks and reputation crises.";

export const Route = createFileRoute("/incident-response")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Incident Response for Deepfakes & Impersonation | Eterna Sentinel",
      description: DESCRIPTION,
    }),
  component: Page,
});

function Page() {
  return (
    <ServiceLanding
      eyebrow="Incident Response"
      section="Platform"
      sourcePage="incident-response"
      title="Incident Response for Digital Identity Threats"
      intro="When a deepfake, impersonation or harmful leak appears, Eterna Sentinel helps authorized clients verify what happened, preserve evidence and coordinate an appropriate response."
      schema={serviceSchema({
        path: PATH,
        name: "Eterna Sentinel Incident Response",
        serviceType: "Digital identity incident response",
        description: DESCRIPTION,
      })}
      sections={[
        {
          kicker: "The first hours",
          heading: "Evidence first, then response.",
          body: [
            "Harmful content can spread quickly. The first priority is to preserve the source, timestamp and context before anything changes or disappears.",
            "Eterna then verifies the finding and assesses which platform, legal or communications actions are appropriate and eligible.",
          ],
        },
        {
          kicker: "Governed response",
          heading: "Human judgment at every consequential step.",
          body: [
            "Eterna Sentinel is not an automatic takedown service. Every action is reviewed, authorized and documented.",
            "After an initial response, monitoring continues so recurrence and re-uploads can be identified.",
          ],
        },
      ]}
      cardsHeading="The incident response sequence"
      cards={[
        { title: "Verify", body: "Confirm authorization and the identity involved." },
        { title: "Investigate", body: "Assess the content, source and spread." },
        { title: "Preserve evidence", body: "Retain records suitable for platform and legal review." },
        { title: "Respond", body: "Coordinate eligible, authorized platform or enforcement action." },
        { title: "Monitor again", body: "Watch for recurrence across agreed surfaces." },
      ]}
      related={[
        { label: "Deepfake Protection", to: "/deepfake-protection" },
        { label: "Online Reputation Protection", to: "/online-reputation-protection" },
        { label: "Executive First-Hour Playbook", to: "/newsroom/executive-first-hour-playbook" },
        { label: "How Eterna Sentinel Works", to: "/how-it-works" },
        { label: "Request Protection", to: "/request-protection" },
      ]}
    />
  );
}
