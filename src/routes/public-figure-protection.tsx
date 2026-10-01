import { createFileRoute } from "@tanstack/react-router";
import { ServiceLanding, landingHead, serviceSchema, webPageSchema } from "@/components/public/ServiceLanding";

const PATH = "/public-figure-protection";
const DESCRIPTION =
  "Digital identity protection for public figures, executives, creators and high-profile individuals facing impersonation, deepfakes and online reputation threats.";

export const Route = createFileRoute("/public-figure-protection")({
  head: () =>
    landingHead({
      path: PATH,
      title: "Public Figure & Executive Digital Protection | Eterna Sentinel",
      description: DESCRIPTION,
    }),
  component: Page,
});

function Page() {
  return (
    <ServiceLanding
      eyebrow="Public Figure Protection"
      section="Solutions"
      sourcePage="public-figure-protection"
      title="Digital Identity Protection for Public Figures & Executives"
      intro="For actors, athletes, creators, founders, executives and other high-profile individuals whose name, face and voice are targets for misuse."
      schema={`[${webPageSchema({ path: PATH, name: "Public Figure & Executive Digital Protection", description: DESCRIPTION })},${serviceSchema({ path: PATH, name: "Eterna Sentinel Public Figure Protection", serviceType: "Public figure digital identity protection", description: DESCRIPTION })}]`}
      sections={[
        {
          kicker: "Why it matters",
          heading: "A public identity attracts impersonation and synthetic media.",
          body: [
            "Fake accounts, fabricated endorsements and deepfakes can mislead fans, partners and investors, and harm reputation quickly.",
            "Eterna assesses each identified signal with human review and coordinates an authorized response. Removal is never guaranteed; outcomes depend on platform policy and the facts of each case.",
          ],
        },
      ]}
      cardsHeading="How Eterna supports public figures"
      cards={[
        { title: "Monitoring", body: "Supported public sources monitored for potential identity misuse." },
        { title: "Impersonation response", body: "Fake profiles assessed and eligible reports submitted." },
        { title: "Deepfake response", body: "Manipulated media verified and escalated where appropriate." },
        { title: "Reputation incidents", body: "Coordinated handling of harmful or misleading narratives." },
        { title: "Evidence preservation", body: "Records retained for platform, legal and advisor review." },
        { title: "Image Immunization", body: "Preventative protection for authorized images before publication." },
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
