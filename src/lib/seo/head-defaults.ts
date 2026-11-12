export const SITE_ORIGIN = "https://protectbyeterna.com";
export const DEFAULT_TITLE = "Eterna Sentinel";
export const DEFAULT_DESCRIPTION =
  "Digital identity protection, deepfake defense, impersonation monitoring and reputation protection for individuals, public figures and organizations.";
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-default.png`;
export const DEFAULT_OG_IMAGE_WIDTH = "1200";
export const DEFAULT_OG_IMAGE_HEIGHT = "630";
export const DEFAULT_OG_IMAGE_ALT = "Eterna Sentinel: Digital Identity Protection for the AI Era";

type Tag = { tag: string; attrs?: Record<string, unknown>; children?: unknown };

const key = (t: Tag) => (t.attrs?.property ?? t.attrs?.name) as string | undefined;

/**
 * Fills share metadata from the route's own head(): og:title/og:description
 * fall back to the route's title/description, twitter:* fall back to og:*,
 * and og:image falls back to the branded default (routes may override it).
 */
export const NOT_FOUND_TITLE = "Page not found | Eterna Sentinel";

export function completeShareTags<T extends Tag>(input: T[], opts: { notFound?: boolean } = {}): T[] {
  const tags = opts.notFound
    ? (input
        .filter((t) => !(t.tag === "link" && t.attrs?.rel === "canonical"))
        .map((t) => {
          if (t.tag === "title") return { ...t, children: NOT_FOUND_TITLE };
          const k = key(t);
          if (t.tag === "meta" && k === "description") return { ...t, attrs: { ...t.attrs, content: DEFAULT_DESCRIPTION } };
          return t;
        })
        .filter((t) => !(t.tag === "meta" && /^(og:title|og:description|og:url|twitter:title|twitter:description|robots)$/.test(key(t) ?? ""))) as T[])
    : input;
  const metaIndex = new Map<string, number>();
  let title: string | undefined;
  let canonical: string | undefined;
  tags.forEach((t, i) => {
    if (t.tag === "title" && typeof t.children === "string") title = t.children;
    if (t.tag === "meta") {
      const k = key(t);
      if (k) metaIndex.set(k, i);
    }
    if (t.tag === "link" && t.attrs?.rel === "canonical") canonical = String(t.attrs.href);
  });
  const added = new Map<string, string>();
  const get = (k: string) => {
    if (added.has(k)) return added.get(k);
    const i = metaIndex.get(k);
    return i === undefined ? undefined : (tags[i].attrs?.content as string | undefined);
  };
  const out = [...tags];
  const lastMeta = Math.max(-1, ...Array.from(metaIndex.values()));
  const hasCustomImage = metaIndex.has("og:image");
  const extra: Tag[] = [];
  const add = (attr: "name" | "property", k: string, content: string | undefined) => {
    if (!content || metaIndex.has(k) || added.has(k)) return;
    added.set(k, content);
    extra.push({ tag: "meta", attrs: { [attr]: k, content } });
  };
  if (opts.notFound) add("name", "robots", "noindex, follow");
  const description = get("description");
  add("property", "og:title", title);
  add("property", "og:description", description);
  const ogTitle = get("og:title") ?? title;
  const ogDescription = get("og:description") ?? description;
  add("name", "twitter:title", ogTitle);
  add("name", "twitter:description", ogDescription);
  add("property", "og:url", canonical);
  add("property", "og:image", DEFAULT_OG_IMAGE);
  if (!hasCustomImage) {
    add("property", "og:image:width", DEFAULT_OG_IMAGE_WIDTH);
    add("property", "og:image:height", DEFAULT_OG_IMAGE_HEIGHT);
  }
  const imageAlt = get("og:image:alt") ?? (hasCustomImage ? ogTitle : DEFAULT_OG_IMAGE_ALT);
  add("property", "og:image:alt", imageAlt);
  add("name", "twitter:image", get("og:image") ?? DEFAULT_OG_IMAGE);
  add("name", "twitter:image:alt", imageAlt);
  add("name", "twitter:card", "summary_large_image");
  out.splice(lastMeta + 1, 0, ...(extra as T[]));
  return out;
}
