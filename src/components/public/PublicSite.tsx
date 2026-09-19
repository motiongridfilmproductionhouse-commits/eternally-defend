import { Link } from "@tanstack/react-router";
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import eternaLogo from "@/assets/eterna-logo.png.asset.json";
import eternaLogoWhite from "@/assets/eterna-logo-white.png.asset.json";
import {
  EnquiryModalProvider,
  useEnquiryModal,
} from "@/components/public/enquiry/enquiry-modal-context";
import { ArticleHeroPlaceholder } from "@/components/public/ArticleHeroPlaceholder";

export function EternaLogo({
  inverse = false,
  className = "h-5",
  alt = "Éterna",
}: {
  inverse?: boolean;
  className?: string;
  alt?: string;
}) {
  const src = inverse ? eternaLogoWhite.url : eternaLogo.url;
  return (
    <span className={`landing-logo ${className}`}>
      <img src={src} alt={alt} className="h-full w-auto" width={1712} height={480} />
      <span
        aria-hidden="true"
        className="landing-logo-shine"
        style={{ WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }}
      />
    </span>
  );
}

// Route destinations use TanStack Router's own `Link` "to" type directly,
// so this stays in lockstep with the generated route tree (no manual route
// list to keep in sync, and a typo becomes a build-time type error).
type NavRouteTo = ComponentProps<typeof Link>["to"];

// Explicit discriminated union (rather than relying on structural
// inference over a large, complex route-literal union) so "to" in item /
// "href" in item narrows reliably everywhere it's used below.
type NavItem =
  | { label: string; description: string; href: string; to?: never; emphasis?: boolean }
  | { label: string; description: string; to: NavRouteTo; href?: never; emphasis?: boolean };

type NavCategory = { label: string; items: NavItem[] };

// Primary navigation information architecture: 4 dropdown categories + the
// Request Protection CTA. Every destination below is an existing route or an
// existing in-page anchor — none were invented for this redesign. See
// docs/navigation/PRIMARY_NAV_IA.md for the full before/after mapping.
const navigationCategories: NavCategory[] = [
  {
    label: "Platform",
    items: [
      {
        label: "Platform Overview",
        href: "/#platform",
        description: "One operating view, from signal to governed decision.",
      },
      {
        label: "How It Works",
        href: "/#how-it-works",
        description: "A continuous, human-governed protection cycle.",
      },
      {
        label: "Image Immunization",
        to: "/image-immunization" as const,
        description: "Preventative protection for authorized images.",
        emphasis: true,
      },
    ],
  },
  {
    label: "Solutions",
    items: [
      {
        label: "Solutions Overview",
        href: "/#solutions",
        description: "Identity, reputation and content, seen together.",
      },
      {
        label: "Deepfake Protection",
        to: "/deepfake-protection" as const,
        description: "Detection, response and preventative protection.",
      },
      {
        label: "AI Impersonation",
        to: "/ai-impersonation" as const,
        description: "Celebrity scams, executive fraud and cloned voices.",
      },
      {
        label: "Online Reputation Protection",
        to: "/online-reputation-protection" as const,
        description: "Evidence-led response to defamatory content.",
      },
    ],
  },
  {
    label: "Research",
    items: [
      {
        label: "Observatory",
        to: "/identity-response-observatory" as const,
        description: "Research and response intelligence.",
      },
      {
        label: "Case Studies",
        to: "/case-studies" as const,
        description: "Protection scenarios and operating examples.",
      },
      {
        label: "Newsroom",
        to: "/newsroom" as const,
        description: "Guides, announcements and analysis.",
      },
      {
        label: "Methodology",
        to: "/methodology" as const,
        description: "How Eterna verifies and assesses information.",
      },
    ],
  },
  {
    label: "Company",
    items: [
      {
        label: "About Eterna",
        to: "/about" as const,
        description: "Who Eterna Sentinel is and how we operate.",
      },
      {
        label: "Security",
        to: "/security" as const,
        description: "Governance, verification and evidence practices.",
      },
      {
        label: "Responsible Disclosure",
        href: "/security#responsible-disclosure",
        description: "Report a security issue responsibly.",
      },
      {
        label: "Contact",
        to: "/contact" as const,
        description: "Protection requests, partnerships and media enquiries.",
      },
    ],
  },
];

// Right-column feature panels for the desktop mega menu. Every line of copy
// here is drawn from that page's own existing, approved wording (its <head>
// description or intro), condensed for a compact card — not new marketing
// claims. Sources: image-immunization.tsx (Platform), the homepage tagline
// + solution pages (Solutions), newsroom_.detection-is-not-prevention.tsx
// (Research), security.tsx (Company).
type MegaFeature = {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  to: NavRouteTo;
};

const megaFeatures: Record<"platform" | "research", MegaFeature> = {
  platform: {
    eyebrow: "Preventative protection",
    title: "Image Immunization",
    body: "Eterna's proprietary pre-publication image protection, developed through internal R&D and currently under validation. Designed to reduce unauthorized AI identity reuse while preserving natural appearance.",
    ctaLabel: "Explore Image Immunization",
    to: "/image-immunization" as const,
  },
  research: {
    eyebrow: "From the Newsroom",
    title: "Detection Is Not Prevention",
    body: "Monitoring and takedown work after an image has already been misused — why prevention has to start earlier, and how detection and prevention fit together.",
    ctaLabel: "Read article",
    to: "/newsroom/detection-is-not-prevention" as const,
  },
};

function NavDestinationLink({
  item,
  className,
  onNavigate,
}: {
  item: NavItem;
  className?: string;
  onNavigate?: () => void;
}) {
  if ("to" in item) {
    return (
      <Link
        to={item.to}
        className={cn("group", className)}
        onClick={onNavigate}
        activeProps={{ "data-current": "true" }}
        activeOptions={{ exact: true }}
      >
        <span className="block text-sm font-semibold text-landing-ink transition-transform duration-150 ease-out group-hover:translate-x-[2px]">
          {item.label}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-landing-muted">
          {item.description}
        </span>
      </Link>
    );
  }
  return (
    <a href={item.href} className={cn("group", className)} onClick={onNavigate}>
      <span className="block text-sm font-semibold text-landing-ink transition-transform duration-150 ease-out group-hover:translate-x-[2px]">
        {item.label}
      </span>
      <span className="mt-0.5 block text-xs leading-5 text-landing-muted">{item.description}</span>
    </a>
  );
}

const megaLinkClassName =
  "block rounded-md px-3 py-2.5 outline-none transition-colors hover:bg-landing-soft focus-visible:bg-landing-soft data-[current=true]:bg-landing-soft";

function MegaEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-landing-muted">
      {children}
    </p>
  );
}

function MegaFeatureCard({ feature }: { feature: MegaFeature }) {
  return (
    <div className="eterna-nav-emphasis eterna-nav-feature flex h-full flex-col justify-between rounded-xl border p-6">
      <div>
        <MegaEyebrow>{feature.eyebrow}</MegaEyebrow>
        <h3 className="mt-2 text-lg font-semibold text-landing-ink">{feature.title}</h3>
        <p className="mt-3 text-sm leading-6 text-landing-muted">{feature.body}</p>
      </div>
      <NavigationMenuPrimitive.Link asChild>
        <Link
          to={feature.to}
          className="group mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-landing-ink"
        >
          {feature.ctaLabel}
          <ArrowRight
            className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-1"
            aria-hidden="true"
          />
        </Link>
      </NavigationMenuPrimitive.Link>
    </div>
  );
}

function PlatformMegaContent() {
  const category = navigationCategories[0];
  return (
    <div className="grid h-full grid-cols-[1.3fr_1fr] gap-10">
      <div>
        <MegaEyebrow>{category.label}</MegaEyebrow>
        <ul className="mt-3 flex flex-col gap-0.5">
          {category.items.map((item) => (
            <li key={item.label}>
              <NavigationMenuPrimitive.Link asChild>
                <NavDestinationLink
                  item={item}
                  className={cn(megaLinkClassName, item.emphasis && "eterna-nav-emphasis border")}
                />
              </NavigationMenuPrimitive.Link>
            </li>
          ))}
        </ul>
      </div>
      <MegaFeatureCard feature={megaFeatures.platform} />
    </div>
  );
}

function SolutionsMegaContent() {
  const { openEnquiryModal } = useEnquiryModal();
  const category = navigationCategories[1];
  return (
    <div className="grid h-full grid-cols-[1.3fr_1fr] gap-10">
      <div>
        <MegaEyebrow>{category.label}</MegaEyebrow>
        <ul className="mt-3 flex flex-col gap-0.5">
          {category.items.map((item) => (
            <li key={item.label}>
              <NavigationMenuPrimitive.Link asChild>
                <NavDestinationLink item={item} className={megaLinkClassName} />
              </NavigationMenuPrimitive.Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="eterna-nav-emphasis eterna-nav-feature flex h-full flex-col justify-between rounded-xl border p-6">
        <div>
          <MegaEyebrow>Who this is for</MegaEyebrow>
          <h3 className="mt-2 text-lg font-semibold text-landing-ink">
            Protection for high-exposure identities
          </h3>
          <p className="mt-3 text-sm leading-6 text-landing-muted">
            Digital identity protection for people and organizations in the public eye — deepfakes,
            impersonation and reputation threats, addressed together.
          </p>
        </div>
        <NavigationMenuPrimitive.Link asChild>
          <button
            type="button"
            onClick={() =>
              openEnquiryModal({
                sourcePage: "nav-solutions-feature",
                sourceCta: "Request Protection",
                department: "protection",
              })
            }
            className="group mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-landing-ink"
          >
            Request Protection
            <ArrowRight
              className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-1"
              aria-hidden="true"
            />
          </button>
        </NavigationMenuPrimitive.Link>
      </div>
    </div>
  );
}

function ResearchMegaContent() {
  const category = navigationCategories[2];
  const sideLinks = category.items.filter((item) => item.label !== "Newsroom");
  const newsroomLink = category.items.find((item) => item.label === "Newsroom");
  return (
    <div className="grid h-full grid-cols-[1fr_1fr_1.2fr] gap-10">
      <div>
        <MegaEyebrow>{category.label}</MegaEyebrow>
        <ul className="mt-3 flex flex-col gap-0.5">
          {sideLinks.map((item) => (
            <li key={item.label}>
              <NavigationMenuPrimitive.Link asChild>
                <NavDestinationLink item={item} className={megaLinkClassName} />
              </NavigationMenuPrimitive.Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-l border-landing-line pl-10">
        <MegaEyebrow>Newsroom</MegaEyebrow>
        {newsroomLink && (
          <ul className="mt-3 flex flex-col gap-0.5">
            <li>
              <NavigationMenuPrimitive.Link asChild>
                <NavDestinationLink item={newsroomLink} className={megaLinkClassName} />
              </NavigationMenuPrimitive.Link>
            </li>
          </ul>
        )}
      </div>
      <MegaFeatureCard feature={megaFeatures.research} />
    </div>
  );
}

function CompanyMegaContent() {
  const category = navigationCategories[3];
  return (
    <div className="grid h-full grid-cols-[1.3fr_1fr] gap-10">
      <div>
        <MegaEyebrow>{category.label}</MegaEyebrow>
        <ul className="mt-3 flex flex-col gap-0.5">
          {category.items.map((item) => (
            <li key={item.label}>
              <NavigationMenuPrimitive.Link asChild>
                <NavDestinationLink item={item} className={megaLinkClassName} />
              </NavigationMenuPrimitive.Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="eterna-nav-emphasis eterna-nav-feature flex h-full flex-col justify-between rounded-xl border p-6">
        <div>
          <MegaEyebrow>How we operate</MegaEyebrow>
          <h3 className="mt-2 text-lg font-semibold text-landing-ink">
            Built on authorization, evidence and human judgment
          </h3>
          <p className="mt-3 text-sm leading-6 text-landing-muted">
            Eterna combines technical controls with human review so protection work stays
            authorized, traceable and proportionate.
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          <NavigationMenuPrimitive.Link asChild>
            <Link
              to="/security"
              className="group inline-flex items-center gap-1.5 text-sm font-semibold text-landing-ink"
            >
              Security
              <ArrowRight
                className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          </NavigationMenuPrimitive.Link>
          <NavigationMenuPrimitive.Link asChild>
            <Link
              to="/methodology"
              className="group inline-flex items-center gap-1.5 text-sm font-semibold text-landing-ink"
            >
              Methodology
              <ArrowRight
                className="size-3.5 transition-transform duration-150 ease-out group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          </NavigationMenuPrimitive.Link>
        </div>
      </div>
    </div>
  );
}

const megaContentByCategory: Record<string, () => ReactNode> = {
  Platform: PlatformMegaContent,
  Solutions: SolutionsMegaContent,
  Research: ResearchMegaContent,
  Company: CompanyMegaContent,
};

// One shared premium shell (fixed position/size, `Viewport`-driven) instead
// of four small independent dropdowns: switching triggers only crossfades
// the inner content in place, the shell itself never closes/reopens or
// changes size. The shell (`Viewport`) is `forceMount`ed and shown/hidden
// via Radix's own `data-state` (which it sets correctly on itself), but
// Radix does NOT set `data-state` on each category's own `Content` node
// once it's rendered through a shared `Viewport` (confirmed by reading
// node_modules/@radix-ui/react-navigation-menu: `NavigationMenuViewportItem`
// forwards props straight into `NavigationMenuContentImpl` with no
// `data-state`, unlike the standalone-dropdown codepath) — so per-category
// visibility is driven explicitly here via controlled `value`/
// `onValueChange` state instead. Every `Content` stays `forceMount`ed so all
// destination links stay real, crawlable anchors in the server-rendered
// HTML at all times, and `data-motion` (which Radix does set correctly on
// every Content, active or not) still drives the crossfade animation.
function DesktopNav() {
  const [activeCategory, setActiveCategory] = useState("");
  return (
    <NavigationMenuPrimitive.Root
      aria-label="Main navigation"
      delayDuration={100}
      skipDelayDuration={200}
      value={activeCategory}
      onValueChange={setActiveCategory}
      className="hidden lg:flex"
    >
      <NavigationMenuPrimitive.List className="flex items-center gap-1 text-[13px] text-landing-muted">
        {navigationCategories.map((category) => (
          <NavigationMenuPrimitive.Item key={category.label} value={category.label}>
            <NavigationMenuPrimitive.Trigger className="group relative flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium text-landing-muted outline-none transition-colors duration-[180ms] ease-out hover:-translate-y-px hover:text-landing-ink focus-visible:text-landing-ink focus-visible:ring-2 focus-visible:ring-landing-accent/40 data-[state=open]:text-landing-ink">
              {category.label}
              <ChevronDown
                className="size-3 text-landing-muted/70 transition-transform duration-200 group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </NavigationMenuPrimitive.Trigger>
            {/*
              forceMount keeps this category's links in the server-rendered
              HTML at all times, not just while its content is the active one
              in the shared shell below — see the module-level comment above
              DesktopNav. Visibility inside the shell is driven by comparing
              this category to `activeCategory` (not Radix's `data-state`,
              which isn't set here); a hidden panel is display:none, which
              also removes it from the tab order.
            */}
            <NavigationMenuPrimitive.Content
              forceMount
              className={cn(
                "absolute inset-0 h-full w-full overflow-y-auto p-9 data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion^=from-]:slide-in-from-bottom-1 data-[motion^=to-]:slide-out-to-bottom-1",
                activeCategory === category.label ? "block" : "hidden",
              )}
            >
              {megaContentByCategory[category.label]?.()}
            </NavigationMenuPrimitive.Content>
          </NavigationMenuPrimitive.Item>
        ))}
        <NavigationMenuPrimitive.Indicator className="top-full flex h-2 items-end justify-center overflow-hidden transition-[width,transform] duration-200 ease-out data-[state=hidden]:animate-out data-[state=hidden]:fade-out data-[state=visible]:animate-in data-[state=visible]:fade-in">
          <div className="h-[2px] w-6 rounded-full bg-landing-accent" />
        </NavigationMenuPrimitive.Indicator>
      </NavigationMenuPrimitive.List>
      {/*
        Fixed-size shell (not Radix's auto width/height CSS vars, which
        would resize/animate the panel per active category's natural
        content size): every category's content is designed to fit the same
        box, so the shell truly never moves or resizes while switching —
        only the inner content crossfades. Positioned `absolute` against the
        nearest positioned ancestor — deliberately not Root itself (Root has
        no `position` set above), which is only as wide as the trigger row,
        but the surrounding `<header>` (`position: relative`, the same
        `max-w-[1380px] mx-auto` box the rest of the header content uses) —
        so the shell centers under the full header and never overflows the
        viewport at any width, instead of centering on the narrower trigger
        row's own off-center position within the header.
      */}
      <NavigationMenuPrimitive.Viewport
        forceMount
        className="eterna-nav-panel eterna-mega-shell absolute left-1/2 top-full z-50 mt-3 hidden h-[400px] w-[calc(100vw-3rem)] max-w-[1380px] -translate-x-1/2 overflow-hidden rounded-2xl border border-landing-line bg-landing data-[state=open]:block"
      />
    </NavigationMenuPrimitive.Root>
  );
}

function MobileNav({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { openEnquiryModal } = useEnquiryModal();
  return (
    <nav
      id="mobile-navigation"
      // Rendered at all times (not gated behind `open`) and toggled purely
      // with `hidden` / `block` so every link — including inside collapsed
      // accordion sections below — stays in the server-rendered HTML and
      // crawlable without JavaScript. This matters most here since Google
      // crawls with a mobile user agent by default.
      className={cn(
        "absolute inset-x-4 top-20 z-50 max-h-[calc(100vh-6rem)] overflow-y-auto border border-landing-line bg-landing p-4 shadow-lg lg:hidden",
        open ? "block" : "hidden",
      )}
      aria-label="Mobile navigation"
    >
      <Accordion type="single" collapsible className="w-full">
        {navigationCategories.map((category) => (
          <AccordionItem
            key={category.label}
            value={category.label}
            className="border-b border-landing-line"
          >
            <AccordionTrigger className="py-3 text-sm font-semibold text-landing-ink hover:no-underline">
              {category.label}
            </AccordionTrigger>
            <AccordionContent forceMount>
              <ul className="flex flex-col gap-1 pb-2">
                {category.items.map((item) => (
                  <li key={item.label}>
                    <NavDestinationLink
                      item={item}
                      onNavigate={onNavigate}
                      className="block rounded-md px-2 py-2 outline-none transition-colors hover:bg-landing-soft focus-visible:bg-landing-soft"
                    />
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          asChild
          variant="outline"
          className="border-landing-line bg-transparent text-landing-ink"
        >
          <Link to="/auth" onClick={onNavigate}>
            Client Sign In
          </Link>
        </Button>
        <Button
          type="button"
          className="landing-accent-fill text-landing-accent-foreground"
          onClick={() => {
            onNavigate();
            openEnquiryModal({
              sourcePage: "mobile-request-protection",
              sourceCta: "Request Protection",
              department: "protection",
            });
          }}
        >
          Request Protection
        </Button>
      </div>
    </nav>
  );
}

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const { openEnquiryModal } = useEnquiryModal();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="relative mx-auto flex h-20 max-w-[1380px] items-center justify-between px-5 md:px-10">
      <Link to="/" aria-label="Eterna Sentinel home">
        <EternaLogo className="h-4 md:h-[22px]" />
      </Link>
      <DesktopNav />
      <div className="hidden items-center gap-2 md:flex">
        <Button asChild variant="ghost" className="text-landing-ink hover:bg-landing-soft">
          <Link to="/auth">Client Sign In</Link>
        </Button>
        <Button
          type="button"
          className="landing-accent-fill text-landing-accent-foreground"
          onClick={() =>
            openEnquiryModal({
              sourcePage: "header",
              sourceCta: "Request Protection",
              department: "protection",
            })
          }
        >
          Request Protection
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-landing-ink hover:bg-landing-soft lg:hidden"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-navigation"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X /> : <Menu />}
      </Button>
      <MobileNav open={open} onNavigate={() => setOpen(false)} />
    </header>
  );
}

export function PublicFooter() {
  const groups = [
    {
      title: "Platform",
      links: [
        { label: "Protection", href: "/#solutions" },
        { label: "Image Immunization (EIP)", to: "/image-immunization" as const },
        { label: "How It Works", href: "/#how-it-works" },
        { label: "Case Studies", to: "/case-studies" as const },
        { label: "Identity Response Observatory", to: "/identity-response-observatory" as const },
      ],
    },
    {
      title: "Newsroom",
      links: [
        { label: "All guides", to: "/newsroom" as const },
        {
          label: "Eterna Introduces Image Immunization",
          to: "/newsroom/eterna-introduces-image-immunization" as const,
        },
        {
          label: "Deepfake Verification Guide",
          to: "/newsroom/deepfake-verification-guide" as const,
        },
        {
          label: "Impersonation Response Guide",
          to: "/newsroom/impersonation-response-guide" as const,
        },
        {
          label: "Executive First-Hour Playbook",
          to: "/newsroom/executive-first-hour-playbook" as const,
        },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", to: "/about" as const },
        { label: "Methodology", to: "/methodology" as const },
        { label: "Contact", to: "/contact" as const },
        { label: "Leadership", href: "/about#leadership" },
        { label: "Careers", href: "/about#careers" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy Policy", to: "/privacy" as const },
        { label: "Terms of Service", to: "/terms" as const },
        { label: "Cookie Policy", to: "/cookies" as const },
        { label: "Acceptable Use", to: "/acceptable-use" as const },
      ],
    },
    {
      title: "Client Access",
      links: [
        { label: "Sign In", to: "/auth" as const },
        { label: "Security & Governance", to: "/security" as const },
        { label: "Responsible Disclosure", href: "/security#responsible-disclosure" },
      ],
    },
  ];
  return (
    <footer className="border-t border-landing-line bg-landing">
      <div className="mx-auto grid max-w-[1380px] gap-12 px-6 py-16 md:grid-cols-[1.25fr_2fr] md:px-10">
        <div>
          <EternaLogo className="h-5" />
          <p className="mt-5 max-w-xs text-sm leading-6 text-landing-muted">
            Digital identity, reputation and content protection with evidence-led human review.
          </p>
          <p className="mt-5 text-xs font-semibold text-landing-ink">Eterna Sentinel</p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {groups.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-semibold uppercase text-landing-ink">{group.title}</h2>
              <ul className="mt-4 space-y-3 text-xs text-landing-muted">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link to={link.to} className="landing-link">
                        {link.label}
                      </Link>
                    ) : (
                      <a href={link.href} className="landing-link">
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="border-t border-landing-line pt-6 text-[11px] text-landing-muted md:col-span-2">
          © 2026 Eterna Sentinel. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

type ArticleBreadcrumbItem = {
  label: string;
  to?: ComponentProps<typeof Link>["to"];
};

export function PublicPage({
  eyebrow,
  title,
  intro,
  image,
  heroPlaceholder,
  breadcrumb,
  category,
  publishedDate,
  readTime,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  image?: { src: string; alt: string };
  heroPlaceholder?: {
    icon: ComponentProps<typeof ArticleHeroPlaceholder>["icon"];
    concept: string;
  };
  breadcrumb?: ArticleBreadcrumbItem[];
  category?: string;
  publishedDate?: string;
  readTime?: string;
  children: ReactNode;
}) {
  return (
    <EnquiryModalProvider>
      <div className="landing-shell min-h-screen bg-landing text-landing-ink">
        <PublicHeader />
        <main>
          <section className="border-y border-landing-line">
            <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
              <p className="landing-kicker">{eyebrow}</p>
              {breadcrumb && breadcrumb.length > 0 ? (
                <nav
                  aria-label="Breadcrumb"
                  className="mt-5 flex flex-wrap items-center gap-2 text-[11px] text-landing-muted"
                >
                  {breadcrumb.map((item, index) => (
                    <div key={`${item.label}-${index}`} className="flex items-center gap-2">
                      {item.to ? (
                        <Link to={item.to} className="landing-link">
                          {item.label}
                        </Link>
                      ) : (
                        <span className="text-landing-ink">{item.label}</span>
                      )}
                      {index < breadcrumb.length - 1 ? (
                        <span aria-hidden="true" className="text-landing-muted">
                          /
                        </span>
                      ) : null}
                    </div>
                  ))}
                </nav>
              ) : null}
              <h1 className="mt-5 max-w-4xl text-balance text-5xl font-medium leading-[1.02] md:text-7xl">
                {title}
              </h1>
              <p className="mt-7 max-w-2xl text-base leading-7 text-landing-muted">{intro}</p>
              {(category || publishedDate || readTime) && (
                <div className="mt-6 flex flex-wrap items-center gap-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-landing-muted">
                  {category ? <span>{category}</span> : null}
                  {publishedDate ? <span>{publishedDate}</span> : null}
                  {readTime ? <span>{readTime}</span> : null}
                </div>
              )}
            </div>
          </section>
          {image && (
            <section className="border-b border-landing-line bg-landing-soft">
              <div className="mx-auto max-w-3xl px-6 py-10 md:py-12">
                <div className="aspect-video w-full overflow-hidden rounded-sm border border-landing-line bg-landing">
                  <img
                    src={image.src}
                    alt={image.alt}
                    width={1344}
                    height={752}
                    loading="eager"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            </section>
          )}
          {!image && heroPlaceholder && (
            <section className="border-b border-landing-line bg-landing-soft">
              <div className="mx-auto max-w-3xl px-6 py-10 md:py-12">
                <div className="aspect-video w-full overflow-hidden rounded-sm border border-landing-line bg-landing">
                  <ArticleHeroPlaceholder
                    icon={heroPlaceholder.icon}
                    concept={heroPlaceholder.concept}
                  />
                </div>
              </div>
            </section>
          )}
          {children}
        </main>
        <PublicFooter />
      </div>
    </EnquiryModalProvider>
  );
}
