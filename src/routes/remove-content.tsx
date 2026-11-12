import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import { EnquiryModalProvider } from "@/components/public/enquiry/enquiry-modal-context";
import { RemovalFlow } from "@/components/public/removal/RemovalFlow";
import { PASTEL_STYLE } from "@/components/public/removal/RemovalPortalModal";
import { serviceNode } from "@/lib/seo/structured-data";
import {
  ServiceFaqSection,
  ServiceGuidesSection,
  ServiceSectionList,
  type ServiceSection,
} from "@/components/public/ServiceLanding";

const CANONICAL = "https://protectbyeterna.com/remove-content";
const TITLE = "Internet Content Removal Service | Eterna Sentinel";
const DESC = "Harmful post, video, image or review online? Our content removal service assesses each link individually, pay per link, with case tracking. Submit a link.";

const BREADCRUMB_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://protectbyeterna.com/" },
    { "@type": "ListItem", position: 2, name: "Remove Content", item: CANONICAL },
  ],
});

const SERVICE_LD = JSON.stringify(
  serviceNode({ url: CANONICAL, name: "Eterna Content Removal", serviceType: "Internet content removal", description: DESC }),
);

const RC_FAQS = [
  {
    q: "Can you guarantee removal?",
    a: "No. No honest internet content removal service can guarantee removal. Platforms, site owners and search engines make their own decisions under their own policies and the law. Eterna assesses each link, uses the eligible routes and tells you plainly what happened.",
  },
  {
    q: "What kinds of content can I submit?",
    a: "Posts, videos, images, reviews, fake profiles and articles. Each link is assessed individually against the platform's policies and the facts you provide.",
  },
  {
    q: "What if the content is negative but true?",
    a: "Accurate content that does not break a platform's rules or the law is often not removable. In those cases the assessment explains whether other approaches, such as search suppression or reputation recovery, are more realistic.",
  },
  {
    q: "How is the fee charged?",
    a: "Pricing is per link and shown during submission. Eterna sends a payment request; the case starts once payment is confirmed.",
  },
  {
    q: "Can I submit content about someone else?",
    a: "Only if you are authorized to act for them, for example as their representative. Eterna may ask you to confirm your identity and authorization before acting.",
  },
  {
    q: "How do I follow my case?",
    a: "You receive a case ID when you submit. Use it with the email address you submitted with on the Track Case page to see the current stage and updates.",
  },
];

const RC_SECTIONS: ServiceSection[] = [
  {
    kicker: "What can be assessed",
    heading: "Content our internet content removal service can assess.",
    body: [
      "If you need to remove harmful content from the internet, start by submitting the exact link. Eterna assesses each link individually. Common types include:",
    ],
    bullets: [
      "Posts on social platforms, including comments and shared content.",
      "Videos, including reels, shorts and reuploads.",
      "Images, including manipulated or non-consensual images.",
      "Reviews that may be fake, abusive or posted in breach of a platform's rules.",
      "Fake profiles that impersonate you or your organization.",
      "Articles and web pages that contain false or unlawful material.",
    ],
  },
  {
    kicker: "What removal can achieve",
    heading: "What removal can and can't achieve.",
    body: [
      "Removal means the content is taken down at its source. It is possible when the content breaks a platform's policy or the law, and when the right person reports it with the right evidence.",
      "Removal is not always available. Content that is negative but accurate is often not removable. Search suppression only changes what appears in search, and reputation recovery is a longer process of building accurate information. Knowing which applies saves time and money.",
    ],
    links: [
      {
        label: "Content removal vs search suppression vs recovery",
        to: "/newsroom/content-removal-vs-search-suppression-vs-reputation-recovery",
      },
    ],
  },
  {
    kicker: "Assessment",
    heading: "How assessment works.",
    body: ["Every submission goes through the same steps before any action is taken:"],
    bullets: [
      "The link is analyzed to identify the platform and the type of content.",
      "The content is checked against the platform's published policies and any relevant legal routes.",
      "A reviewer considers the details and evidence you supplied.",
      "You are told which removal pathway is appropriate, or why removal is unlikely.",
      "Evidence of the content is preserved before anything is reported.",
    ],
  },
  {
    kicker: "What to include",
    heading: "What to include in your submission.",
    body: ["Clear information makes assessment faster and more accurate. Where you can, include:"],
    bullets: [
      "The exact link to the content, not just the account or homepage.",
      "Why it is harmful: for example impersonation, a manipulated image, a false claim or private material shared without consent.",
      "Your relationship to the content: are you the person shown, or acting for them?",
      "Screenshots, dates and any earlier reports you have already made.",
      "A contact email you check regularly.",
    ],
  },
  {
    kicker: "Who can submit",
    heading: "Who can submit a link.",
    body: [
      "You can submit content that shows or concerns you, your business, or someone you are authorized to represent, such as a client, family member or employer. Eterna may ask you to confirm your identity and authorization before acting, so that nobody can request removal of content in someone else's name.",
      "If the content involves a threat to your safety, contact local emergency services first. If someone is threatening to publish private material, do not pay them; preserve the messages and submit the details.",
    ],
  },
  {
    kicker: "Evidence",
    heading: "Why evidence is preserved first.",
    body: [
      "Content is often edited, hidden or deleted once it is reported or noticed. Before anything is submitted to a platform, Eterna keeps a record of the content with its link, the time it was captured and the surrounding context. That record supports the platform report and is available if legal advisors need it later.",
      "Your uploaded screenshots and documents are stored privately and used only for your case.",
    ],
  },
  {
    kicker: "Example scenario",
    heading: "Illustrative example: a fake review.",
    body: [
      "Example scenario, not a real client: a business owner submits a review that names a customer who never visited. The assessment finds the review may breach the platform's rules on fake engagement, preserves a copy and reports it through that route. The owner follows the case on the tracking page.",
    ],
  },
  {
    kicker: "After you submit",
    heading: "What happens after you submit.",
    body: [
      "You receive a case ID and a payment request. Once payment is confirmed, the case moves through review, submission to the platform and the platform's decision. Each update appears on the tracking page, and you can check progress at any time with your case ID and email.",
    ],
    links: [{ label: "Track your case", to: "/track-case" }],
  },
];

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
          <ServiceSectionList sections={RC_SECTIONS} />
          <ServiceFaqSection heading="Content removal questions" faqs={RC_FAQS} />
          <ServiceGuidesSection
            guides={[
              { label: "Content removal vs search suppression vs recovery", to: "/newsroom/content-removal-vs-search-suppression-vs-reputation-recovery" },
              { label: "False allegations online: what to do", to: "/newsroom/false-allegations-online-what-to-do" },
              { label: "When negative search results define your brand", to: "/newsroom/negative-search-results-brand-reputation" },
              { label: "Fake account using your name or photos?", to: "/newsroom/fake-account-using-my-name-photos" },
            ]}
          />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: BREADCRUMB_LD }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: SERVICE_LD }} />
        </main>
        <PublicFooter />
      </div>
    </EnquiryModalProvider>
  );
}
