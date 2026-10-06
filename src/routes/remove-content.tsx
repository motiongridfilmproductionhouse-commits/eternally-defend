import { createFileRoute, Link } from "@tanstack/react-router";
import { EnquiryModalProvider, PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import { RemovalFlow } from "@/components/public/removal/RemovalFlow";

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
          <section className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden bg-[#050505] text-white">
            {/* Atmospheric glows */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              <div className="absolute left-1/2 top-1/2 h-[400px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-[120px]" />
              <div className="absolute right-[-5%] top-[-10%] h-[500px] w-[500px] rounded-full bg-white/5 blur-[100px]" />
            </div>

            <div className="relative z-10 flex w-full max-w-4xl flex-col items-center px-6 py-24 text-center">
              <span className="mb-6 text-[11px] font-bold uppercase tracking-[0.2em] text-blue-400">
                Pay-Per-Link Removal
              </span>

              <h1 className="mb-8 text-5xl font-semibold leading-[1.1] tracking-tight text-white md:text-7xl">
                Remove Harmful Content <br className="hidden md:block" /> From the Internet
              </h1>

              <p className="mb-12 max-w-2xl text-lg leading-relaxed text-zinc-400">
                Paste the exact URL of the content you want reviewed. Eterna AI will analyze the
                page, identify the platform, and determine the appropriate removal pathway.
              </p>

              <RemovalFlow initialUrl={url} variant="dark" />

              <div className="mt-10">
                <Link
                  to="/track-case"
                  className="text-sm text-zinc-400 underline decoration-zinc-800 underline-offset-4 transition-colors hover:text-white"
                >
                  Already submitted? Track your case
                </Link>
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
