import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import { EnquiryModalProvider } from "@/components/public/enquiry/enquiry-modal-context";
import { RemovalFlow } from "@/components/public/removal/RemovalFlow";
import { PASTEL_STYLE } from "@/components/public/removal/RemovalPortalModal";

const CANONICAL = "https://protectbyeterna.com/remove-content";
const TITLE = "Online Content Removal — Submit a Link | Eterna Sentinel";
const DESC = "Submit a harmful webpage, post, video, image, or review for individual assessment by Eterna Sentinel. Pay per link and track your removal case online.";

const BREADCRUMB_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://protectbyeterna.com/" },
    { "@type": "ListItem", position: 2, name: "Remove Content", item: CANONICAL },
  ],
});

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
    <EnquiryModalProvider>
      <div className="landing-shell min-h-screen bg-landing text-landing-ink">
        <PublicHeader />
        <main>
          <section
            className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden text-zinc-950"
            style={PASTEL_STYLE}
          >
            <div className="relative z-10 w-full max-w-xl px-4 py-16 sm:px-6">
              <div
                className="rounded-[2rem] border border-white/70 bg-white/70 p-6 shadow-[0_40px_90px_-25px_rgba(70,90,180,0.35)] backdrop-blur-2xl sm:p-10"
                style={PASTEL_STYLE}
              >
                <div className="mx-auto flex w-fit items-center rounded-full border border-white/80 bg-white/60 p-1 text-xs font-medium shadow-sm">
                  <span className="rounded-full bg-white px-4 py-1.5 text-zinc-950 shadow-sm">
                    Remove a link
                  </span>
                  <Link
                    to="/track-case"
                    className="rounded-full px-4 py-1.5 text-zinc-500 transition-colors hover:text-zinc-950"
                  >
                    Track a case
                  </Link>
                </div>

                <h1 className="mt-7 text-balance text-3xl font-semibold leading-tight tracking-tight text-zinc-950 sm:text-4xl">
                  Remove Harmful Content From the Internet
                </h1>
                <p className="mt-3 text-pretty text-sm leading-6 text-zinc-500 sm:text-base">
                  Paste the exact link below. Eterna AI will analyze the page, identify the
                  platform, and determine the appropriate removal pathway.
                </p>

                <div className="mt-7">
                  <RemovalFlow initialUrl={url} variant="dark" />
                </div>

                <p className="mt-5 text-center text-sm">
                  <Link
                    to="/track-case"
                    className="text-zinc-500 underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-zinc-950"
                  >
                    Already submitted? Track your case
                  </Link>
                </p>
              </div>
            </div>
          </section>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: BREADCRUMB_LD }} />
        </main>
        <PublicFooter />
      </div>
    </EnquiryModalProvider>
  );
}
