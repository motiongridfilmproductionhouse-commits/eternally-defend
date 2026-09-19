import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ComponentProps } from "react";

/**
 * A single, restrained conversion line for the end of a Newsroom article —
 * never "Contact us," never a banner. Phrasing and destination vary by the
 * article's subject (see the CTA_BY_CATEGORY map in each route file's
 * category), so an EIP article points at Image Immunization, a response
 * guide points at the Identity Response Observatory, and so on.
 */
export function ArticleCta({ text, to }: { text: string; to: ComponentProps<typeof Link>["to"] }) {
  return (
    <div className="border-t border-landing-line pt-8">
      <Link
        to={to}
        className="landing-link group inline-flex items-center gap-1 text-sm font-medium text-landing-ink"
      >
        {text}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
