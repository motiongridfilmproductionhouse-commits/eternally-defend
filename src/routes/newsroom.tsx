import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  FileText,
  Layers,
  Megaphone,
  Radar,
  ScanFace,
  Users,
} from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";

const CANONICAL = "https://protectbyeterna.com/newsroom";

export const Route = createFileRoute("/newsroom")({
  head: () => ({
    meta: [
      { title: "Newsroom & Insights: Eterna Sentinel" },
      {
        name: "description",
        content:
          "Eterna Sentinel guidance on deepfake verification and impersonation response, written and published by Eterna.",
      },
      { property: "og:title", content: "Newsroom & Insights: Eterna Sentinel" },
      {
        property: "og:description",
        content:
          "Eterna-owned guides on verification, response and executive readiness for digital-identity incidents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: NewsroomPage,
});

function schema() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Newsroom & Insights: Eterna Sentinel",
    description:
      "Eterna Sentinel guidance on deepfake verification and impersonation response, written and published by Eterna.",
    publisher: {
      "@type": "Organization",
      name: "Eterna Sentinel",
      url: "https://protectbyeterna.com/",
    },
    mainEntityOfPage: CANONICAL,
  });
}

const guides = [
  {
    icon: ScanFace,
    to: "/newsroom/deepfake-verification-guide" as const,
    title: "The Deepfake Verification Guide",
    summary:
      "What actually counts as a verified deepfake, and the four-part test behind that call.",
    image: "/images/newsroom/executive-first-hour-response-playbook.png",
    imageAlt: "Layered faces with biometric analysis and synthetic media signals",
  },
  {
    icon: Users,
    to: "/newsroom/impersonation-response-guide" as const,
    title: "The Impersonation Response Guide",
    summary: "What to do, in order, right after discovering impersonation or synthetic media.",
    image: "/images/newsroom/impersonation-response-guide.png",
    imageAlt: "Identity cards protected by a blue shield",
  },
  {
    icon: FileText,
    to: "/newsroom/executive-first-hour-playbook" as const,
    title: "The Executive First Hour Response Playbook",
    summary:
      "A condensed playbook for executives and comms teams for the first hour after an incident surfaces.",
    image: "/images/newsroom/deepfake-verification-guide.png",
    imageAlt: "Desk with a checklist, clock, documents, and response workspace",
  },
  {
    icon: Megaphone,
    to: "/newsroom/eterna-introduces-image-immunization" as const,
    title: "Eterna Introduces Image Immunization",
    summary:
      "Eterna's proprietary pre-publication image protection technology, developed through internal R&D and currently under validation.",
    image: "/images/newsroom/image-immunization-hero.png",
    imageAlt: "A glass-pane before-and-after portrait representing Eterna Image Immunization",
  },
  {
    icon: BookOpen,
    to: "/newsroom/what-is-image-immunization" as const,
    title: "What Is Image Immunization?",
    summary:
      "A plain-language introduction to what Image Immunization is and how it's designed to work.",
    image: "/images/newsroom/image-immunization-audiences.png",
    imageAlt:
      "A photographer and a group of people, representing who Image Immunization is designed for",
  },
  {
    icon: Layers,
    to: "/newsroom/inside-eterna-image-immunization" as const,
    title: "Inside Eterna Image Immunization",
    summary:
      "A technically grounded, public-safe look at how Image Immunization approaches pre-publication protection.",
    image: "/images/newsroom/image-immunization-identity-signal.png",
    imageAlt:
      "A duplicated ID-style portrait with a network visualization, representing Eterna Image Immunization",
  },
  {
    icon: ClipboardCheck,
    to: "/newsroom/how-eterna-validates-image-immunization-responsibly" as const,
    title: "How Eterna Validates Image Immunization Responsibly",
    summary:
      "How Eterna validates Image Immunization responsibly, including what's still in progress.",
    image: undefined,
    imageAlt: undefined,
  },
  {
    icon: Radar,
    to: "/newsroom/detection-is-not-prevention" as const,
    title: "Detection Is Not Prevention",
    summary:
      "Monitoring and takedown work after an image has already been misused. Why prevention has to start earlier.",
    image: undefined,
    imageAlt: undefined,
  },
  {
    icon: AlertTriangle,
    to: "/newsroom/someone-made-a-deepfake-of-me" as const,
    title: "Someone Made a Deepfake of Me — What Should I Do?",
    summary:
      "A direct, 10-step framework for what to do right now if you've discovered a deepfake of yourself.",
    image: undefined,
    imageAlt: undefined,
  },
] as const;

function NewsroomPage() {
  return (
    <PublicPage
      eyebrow="Newsroom"
      title="Guidance Eterna publishes, written by Eterna."
      intro="Practical, sourced guidance on verification and incident response. These are Eterna-owned educational guides, not independent journalism or third-party press coverage."
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema() }} />

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-px overflow-hidden border border-landing-line bg-landing-line md:grid-cols-3">
            {guides.map(({ icon: Icon, to, title, summary, image, imageAlt }) => (
              <Link
                key={to}
                to={to}
                className="landing-feature-card group flex flex-col bg-landing transition-colors hover:bg-landing-soft"
              >
                {image && (
                  <div className="aspect-video w-full overflow-hidden border-b border-landing-line bg-landing-soft">
                    <img
                      src={image}
                      alt={imageAlt}
                      width={1344}
                      height={752}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-8">
                  <Icon className="size-5 text-landing-accent" />
                  <h2
                    className={image ? "mt-14 text-lg font-semibold" : "mt-2 text-lg font-semibold"}
                  >
                    {title}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-landing-muted">{summary}</p>
                  <span className="mt-6 inline-flex items-center gap-1 text-xs font-semibold text-landing-ink">
                    Read the guide <ArrowRight className="size-3.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-landing-soft py-16">
        <div className="mx-auto max-w-6xl px-6">
          <p className="max-w-2xl text-xs leading-6 text-landing-muted">
            Eterna Sentinel publishes these guides as original, evidence-based educational content.
            Statistics cited are sourced and referenced in each guide; where a figure is drawn from
            a third-party report via an aggregator, that is stated explicitly. These pages are not
            press coverage of Eterna by an independent outlet. For that, see future updates on this
            page as Eterna's media presence develops.
          </p>
        </div>
      </section>
    </PublicPage>
  );
}
