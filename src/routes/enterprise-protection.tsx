import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema } from "@/components/public/ServiceLanding";

const PATH = "/enterprise-protection";
const DESCRIPTION =
  "Enterprise protection from Eterna Sentinel: monitoring, investigation and governed response for executive impersonation, brand misuse, deepfakes and reputation threats facing organizations.";

export const Route = createFileRoute("/enterprise-protection")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Enterprise Protection | Executive & Brand Identity Defense | Eterna Sentinel",
      description: DESCRIPTION,
    }),
  component: Page,
});

function Page() {
  return (
    <ServiceLanding
      eyebrow="Enterprise Protection"
      section="Solutions"
      sourcePage="enterprise-protection"
      title="Enterprise Protection for Leadership, Brands and Institutions"
      intro="Eterna Sentinel helps organizations monitor, investigate and respond to impersonation, synthetic media and reputation threats that target their executives, brand and people."
      schema={serviceSchema({
        path: PATH,
        name: "Eterna Sentinel Enterprise Protection",
        serviceType: "Enterprise digital identity protection",
        description: DESCRIPTION,
      })}
      sections={[
        {
          kicker: "The enterprise risk",
          heading: "Executive and brand identity are now attack surfaces.",
          body: [
            "Fake executive accounts, cloned voices and fabricated endorsements can be used for fraud, misinformation or reputational harm against an organization.",
            "Eterna Sentinel treats each signal as a case to be verified and documented, so leadership and legal teams can make decisions from evidence rather than speculation.",
          ],
        },
        {
          kicker: "How it works for organizations",
          heading: "A managed operation, governed by human review.",
          body: [
            "Eterna verifies authorization, agrees monitoring scope, investigates findings, preserves evidence and coordinates eligible platform or enforcement action.",
            "Removal is never guaranteed. Outcomes depend on authorization, platform policy and the facts of each case.",
          ],
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
