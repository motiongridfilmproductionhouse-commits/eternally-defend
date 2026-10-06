import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage } from "@/components/public/PublicSite";
import { RemovalFlow } from "@/components/public/removal/RemovalFlow";

const CANONICAL = "https://protectbyeterna.com/remove-content";
const TITLE = "Online Content Removal — Submit a Link | Eterna Sentinel";
const DESC = "Submit a harmful webpage, post, video, image, or review for individual assessment by Eterna Sentinel. Pay per link and track your removal case online.";

export const Route = createFileRoute("/remove-content")({
  validateSearch: (s: Record<string, unknown>): { url?: string } =>
    typeof s.url === "string" && s.url.length < 2048 ? { url: s.url } : {},
  head: () => ({
    meta: [
      { title: TITLE }, { name: "description", content: DESC },
      { property: "og:title", content: TITLE }, { property: "og:description", content: DESC },
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
      { property: "og:url", content: CANONICAL },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: Page,
});

function Page() {
  const { url } = Route.useSearch();
  return (
    <PublicPage
      eyebrow="Pay-per-link removal"
      title="Remove Harmful Content From the Internet"
      intro="Paste the exact URL of the content you want reviewed. Eterna AI will analyze the page, identify the platform and content type, review the information you provide, and determine the appropriate removal pathway."
    >
      <RemovalFlow initialUrl={url} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already submitted? <Link to="/track-case" className="text-primary underline">Track your case</Link>
      </p>
    </PublicPage>
  );
}
