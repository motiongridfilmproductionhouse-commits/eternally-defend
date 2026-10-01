import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, webPageSchema } from "@/components/public/ServiceLanding";

const PATH = "/request-protection";
const DESCRIPTION =
  "Request digital identity protection from Eterna Sentinel. Tell us about deepfakes, impersonation or reputation threats and our team will review your enquiry confidentially.";

export const Route = createFileRoute("/request-protection")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Request Protection | Eterna Sentinel",
      description: DESCRIPTION,
    }),
  component: Page,
});

function Page() {
  return (
    <ServiceLanding
      eyebrow="Request Protection"
      section="Company"
      sourcePage="request-protection"
      title="Request Digital Identity Protection"
      intro="Share a few details about your situation. The Eterna Sentinel team reviews every enquiry confidentially and responds with the appropriate next steps."
      schema={webPageSchema({ path: PATH, name: "Request Protection", description: DESCRIPTION })}
      sections={[
        {
          kicker: "What happens next",
          heading: "A confidential review, then verified onboarding.",
          body: [
            "After you submit an enquiry, the team assesses whether Eterna can help and what scope is appropriate.",
            "Onboarding includes identity verification and signed authorization before any monitoring or response begins.",
          ],
        },
      ]}
      related={[
        { label: "How Eterna Sentinel Works", to: "/how-it-works" },
        { label: "Deepfake Protection", to: "/deepfake-protection" },
        { label: "Enterprise Protection", to: "/enterprise-protection" },
        { label: "Contact Eterna Sentinel", to: "/contact" },
      ]}
    />
  );
}
