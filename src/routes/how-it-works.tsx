import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, webPageSchema } from "@/components/public/ServiceLanding";

const PATH = "/how-it-works";
const DESCRIPTION =
  "How Eterna Sentinel works: verify, monitor, investigate, preserve evidence, enforce and monitor again. A continuous, human-governed digital identity protection cycle.";

export const Route = createFileRoute("/how-it-works")({
  head: () =>
    landingHead({
      path: PATH,
      title: "How Eterna Sentinel Works | Digital Identity Protection Process",
      description: DESCRIPTION,
    }),
  component: Page,
});

function Page() {
  return (
    <ServiceLanding
      eyebrow="How It Works"
      section="Platform"
      sourcePage="how-it-works"
      title="How Eterna Sentinel Works"
      intro="Eterna Sentinel is a digital identity protection and deepfake defense company. Protection runs as a continuous cycle combining technology-assisted discovery with human review."
      schema={webPageSchema({ path: PATH, name: "How Eterna Sentinel Works", description: DESCRIPTION })}
      sections={[
        {
          kicker: "The operating model",
          heading: "A managed protection operation, not a self-serve tool.",
          body: [
            "Each engagement begins with identity verification and signed authorization, so Eterna only acts for the people and organizations it is permitted to represent.",
            "Findings are verified against Eterna's published methodology before any consequential action is taken.",
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
