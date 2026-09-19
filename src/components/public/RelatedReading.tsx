import { Link } from "@tanstack/react-router";

export function RelatedReading({
  heading,
  items,
}: {
  heading?: string;
  items: Array<{
    to: string;
    title: string;
    description: string;
  }>;
}) {
  return (
    <div className="border-t border-landing-line pt-8">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-landing-muted">
        {heading ?? "Related reading"}
      </h3>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {items.map(({ to, title, description }) => (
          <Link
            key={to}
            to={to as never}
            className="rounded-md border border-landing-line bg-landing-soft p-4 transition-colors hover:bg-landing"
          >
            <p className="text-sm font-semibold text-landing-ink">{title}</p>
            <p className="mt-2 text-sm leading-6 text-landing-muted">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
