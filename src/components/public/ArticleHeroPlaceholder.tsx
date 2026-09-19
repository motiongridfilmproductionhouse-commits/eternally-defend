import type { LucideIcon } from "lucide-react";

/**
 * A designed placeholder for an article's hero visual, used where a
 * bespoke photographed or illustrated hero asset doesn't exist yet.
 * Renders in the exact same aspect-video, bordered container a real
 * hero image uses (see PublicPage's `image` prop), so swapping in a
 * real asset later requires no layout change.
 *
 * Deliberately abstract (an icon on a soft field) rather than a
 * fabricated technical diagram — it doesn't imply any specific
 * capability or claim, it just marks the article's visual theme.
 */
export function ArticleHeroPlaceholder({
  icon: Icon,
  concept,
}: {
  icon: LucideIcon;
  /** Short label naming the visual concept this hero will eventually depict. */
  concept: string;
}) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 bg-landing-soft">
      <Icon className="size-10 text-landing-accent" strokeWidth={1.25} />
      <p className="text-[11px] font-semibold uppercase tracking-wide text-landing-muted">
        {concept}
      </p>
    </div>
  );
}
