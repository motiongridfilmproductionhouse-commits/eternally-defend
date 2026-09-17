import { Link } from "@tanstack/react-router";
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu";
import { ChevronDown, Menu, X } from "lucide-react";
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
        className={className}
        onClick={onNavigate}
        activeProps={{ "data-current": "true" }}
        activeOptions={{ exact: true }}
      >
        <span className="block text-sm font-semibold text-landing-ink">{item.label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-landing-muted">
          {item.description}
        </span>
      </Link>
    );
  }
  return (
    <a href={item.href} className={className} onClick={onNavigate}>
      <span className="block text-sm font-semibold text-landing-ink">{item.label}</span>
      <span className="mt-0.5 block text-xs leading-5 text-landing-muted">{item.description}</span>
    </a>
  );
}

function DesktopNav() {
  return (
    <NavigationMenuPrimitive.Root
      aria-label="Main navigation"
      delayDuration={150}
      skipDelayDuration={200}
      className="relative hidden lg:flex"
    >
      <NavigationMenuPrimitive.List className="flex items-center gap-1 text-[13px] text-landing-muted">
        {navigationCategories.map((category) => (
          <NavigationMenuPrimitive.Item key={category.label} className="relative">
            <NavigationMenuPrimitive.Trigger className="group flex items-center gap-1 rounded-md px-3 py-2 text-[13px] font-medium text-landing-muted outline-none transition-colors hover:text-landing-ink focus-visible:text-landing-ink focus-visible:ring-2 focus-visible:ring-landing-accent/40 data-[state=open]:text-landing-ink">
              {category.label}
              <ChevronDown
                className="size-3 text-landing-muted/70 transition-transform duration-200 group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </NavigationMenuPrimitive.Trigger>
            {/*
              forceMount keeps every dropdown's links in the server-rendered
              HTML at all times (not just after the trigger is opened), so
              they stay normal crawlable anchors instead of depending on
              JavaScript interaction. Visibility is handled purely by the
              data-state-driven `hidden` / `block` classes below; closed
              content is display:none, which also removes it from the tab
              order until its trigger is opened.
            */}
            <NavigationMenuPrimitive.Content
              forceMount
              className="eterna-nav-panel absolute left-1/2 top-full z-50 mt-2 hidden w-[300px] max-w-[calc(100vw-2.5rem)] -translate-x-1/2 rounded-md border border-landing-line bg-landing p-2 data-[state=open]:block data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion^=from-]:zoom-in-95 data-[motion^=to-]:zoom-out-95"
            >
              <ul className="flex flex-col gap-0.5">
                {category.items.map((item) => (
                  <li key={item.label}>
                    <NavigationMenuPrimitive.Link asChild>
                      <NavDestinationLink
                        item={item}
                        className={cn(
                          "block rounded-md px-3 py-2.5 outline-none transition-colors hover:bg-landing-soft focus-visible:bg-landing-soft data-[current=true]:bg-landing-soft",
                          item.emphasis && "eterna-nav-emphasis border",
                        )}
                      />
                    </NavigationMenuPrimitive.Link>
                  </li>
                ))}
              </ul>
            </NavigationMenuPrimitive.Content>
          </NavigationMenuPrimitive.Item>
        ))}
      </NavigationMenuPrimitive.List>
    </NavigationMenuPrimitive.Root>
  );
}

function MobileNav({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
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
      <Accordion type="multiple" className="w-full">
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
        <Button asChild className="landing-accent-fill text-landing-accent-foreground">
          <Link
            to="/waitinglist"
            search={{ source: "mobile-request-protection" }}
            onClick={onNavigate}
          >
            Request Protection
          </Link>
        </Button>
      </div>
    </nav>
  );
}

export function PublicHeader() {
  const [open, setOpen] = useState(false);

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
        <Button asChild className="landing-accent-fill text-landing-accent-foreground">
          <Link to="/waitinglist" search={{ source: "request-protection" }}>
            Request Protection
          </Link>
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

export function PublicPage({
  eyebrow,
  title,
  intro,
  image,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  image?: { src: string; alt: string };
  children: ReactNode;
}) {
  return (
    <div className="landing-shell min-h-screen bg-landing text-landing-ink">
      <PublicHeader />
      <main>
        <section className="border-y border-landing-line">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="landing-kicker">{eyebrow}</p>
            <h1 className="mt-5 max-w-4xl text-balance text-5xl font-medium leading-[1.02] md:text-7xl">
              {title}
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-landing-muted">{intro}</p>
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
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
