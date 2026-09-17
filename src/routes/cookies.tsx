import { createFileRoute } from "@tanstack/react-router";
import { PublicPage } from "@/components/public/PublicSite";
import { PolicySections } from "./terms";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookie Policy: Eterna Sentinel" },
      {
        name: "description",
        content: "How Eterna Sentinel uses essential cookies and similar technologies.",
      },
      { property: "og:title", content: "Cookie Policy: Eterna Sentinel" },
      {
        property: "og:description",
        content: "How Eterna Sentinel uses essential cookies and similar technologies.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://protectbyeterna.com/cookies" }],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <PublicPage
      eyebrow="Legal"
      title="Cookie Policy"
      intro="Eterna uses limited browser storage and similar technologies to operate secure sessions, remember necessary settings and understand service performance."
    >
      <PolicySections
        sections={[
          [
            "Essential technologies",
            "Essential cookies or local storage may be used for authentication, security, session continuity and core service operation.",
          ],
          [
            "Preferences",
            "Preference storage may remember choices such as interface state where that improves continuity.",
          ],
          [
            "Performance",
            "Limited technical information may be used to identify errors, measure reliability and improve service performance.",
          ],
          [
            "Third-party services",
            "Service providers may set or process necessary technical identifiers when supporting hosting, authentication or other requested functionality.",
          ],
          [
            "Your choices",
            "Browser controls can remove or block stored data, but disabling essential storage may prevent sign-in or other protected functions from working.",
          ],
        ]}
      />
    </PublicPage>
  );
}
