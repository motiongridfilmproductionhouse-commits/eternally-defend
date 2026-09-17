import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
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

const navigation = [
  { label: "Platform", href: "/#platform" },
  { label: "Solutions", href: "/#solutions" },
  { label: "Image Immunization", to: "/image-immunization" as const },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Case Studies", to: "/case-studies" as const },
  { label: "Observatory", to: "/identity-response-observatory" as const },
  { label: "Newsroom", to: "/newsroom" as const },
  { label: "Company", to: "/about" as const },
  { label: "Resources", to: "/security" as const },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="mx-auto flex h-20 max-w-[1380px] items-center justify-between px-5 md:px-10">
      <Link to="/" aria-label="Eterna Sentinel home">
        <EternaLogo className="h-4 md:h-[22px]" />
      </Link>
      <nav
        className="hidden items-center gap-6 text-[13px] text-landing-muted lg:flex"
        aria-label="Main navigation"
      >
        {navigation.map((item) =>
          item.to ? (
            <Link key={item.label} to={item.to} className="landing-link">
              {item.label}
            </Link>
          ) : (
            <a key={item.label} href={item.href} className="landing-link">
              {item.label}
            </a>
          ),
        )}
      </nav>
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
        className="text-landing-ink hover:bg-landing-soft md:hidden"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X /> : <Menu />}
      </Button>
      {open && (
        <nav
          className="absolute inset-x-4 top-20 z-50 border border-landing-line bg-landing p-4 shadow-lg md:hidden"
          aria-label="Mobile navigation"
        >
          {navigation.map((item) =>
            item.to ? (
              <Link
                key={item.label}
                to={item.to}
                className="block border-b border-landing-line py-3 text-sm"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <a
                key={item.label}
                href={item.href}
                className="block border-b border-landing-line py-3 text-sm"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ),
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              asChild
              variant="outline"
              className="border-landing-line bg-transparent text-landing-ink"
            >
              <Link to="/auth">Client Sign In</Link>
            </Button>
            <Button asChild className="landing-accent-fill text-landing-accent-foreground">
              <Link to="/waitinglist" search={{ source: "mobile-request-protection" }}>
                Request Protection
              </Link>
            </Button>
          </div>
        </nav>
      )}
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
        { label: "Deepfake Protection", to: "/deepfake-protection" as const },
        {
          label: "Online Reputation Protection",
          to: "/online-reputation-protection" as const,
        },
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
