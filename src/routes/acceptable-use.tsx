import { createFileRoute } from "@tanstack/react-router";
import { PublicPage } from "@/components/public/PublicSite";
import { PolicySections } from "./terms";

export const Route = createFileRoute("/acceptable-use")({
  head: () => ({
    meta: [
      { title: "Acceptable Use — Eterna Sentinel" },
      {
        name: "description",
        content:
          "Responsible and authorized use requirements for Eterna Sentinel protection services.",
      },
      { property: "og:title", content: "Acceptable Use — Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Responsible and authorized use requirements for Eterna Sentinel protection services.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://protectbyeterna.com/acceptable-use" }],
  }),
  component: AcceptableUsePage,
});

function AcceptableUsePage() {
  return (
    <PublicPage
      eyebrow="Legal"
      title="Acceptable Use"
      intro="Eterna protection services must be used lawfully, truthfully and only by people with authority to protect the relevant identity, organization or asset."
    >
      <PolicySections
        sections={[
          [
            "Required authorization",
            "Do not enroll, monitor or act for another person, organization or asset without appropriate authority.",
          ],
          [
            "Truthful claims",
            "Do not submit false ownership, impersonation, privacy, copyright or legal claims, or alter evidence to make content appear actionable.",
          ],
          [
            "No harmful use",
            "Do not use Eterna to harass, surveil unlawfully, discriminate, suppress lawful expression, expose private information or interfere with legitimate platform activity.",
          ],
          [
            "Evidence integrity",
            "Do not tamper with source records, timestamps, identity references, authorization material or case history.",
          ],
          [
            "Enforcement",
            "Access may be limited or suspended when use creates safety, legal, security or integrity risk. Serious concerns may be preserved and escalated where required.",
          ],
        ]}
      />
    </PublicPage>
  );
}
