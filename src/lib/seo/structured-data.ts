/**
 * Shared JSON-LD building blocks so every page references one consistent
 * Organization node (no conflicting duplicates).
 */
export const SITE_URL = "https://protectbyeterna.com";
export const ORG_ID = `${SITE_URL}/#organization`;
export const DEFAULT_ARTICLE_IMAGE = `${SITE_URL}/og-default.png`;

/**
 * Official social profile URLs for Organization.sameAs.
 * TODO(owner): fill in real profile URLs (e.g. LinkedIn, Instagram, X). Left
 * empty because no official profiles exist in the codebase; never guess.
 */
export const SOCIAL_PROFILES: string[] = [];

export const ORG_LOGO = {
  "@type": "ImageObject",
  url: `${SITE_URL}/eterna-logo.png`,
  width: 600,
  height: 168,
} as const;

/** Lightweight reference to the root Organization (defined on the homepage). */
export const ORG_REF = { "@type": "Organization", "@id": ORG_ID, name: "Eterna Sentinel", url: `${SITE_URL}/` } as const;

/** Publisher block for articles and pages (same Organization, with logo). */
export const PUBLISHER = { ...ORG_REF, logo: ORG_LOGO } as const;

export function organizationNode() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Eterna Sentinel",
    alternateName: ["Eterna", "Protect by Eterna"],
    url: `${SITE_URL}/`,
    logo: ORG_LOGO,
    description:
      "Digital identity protection, deepfake defense, impersonation monitoring and reputation protection.",
    areaServed: "Worldwide",
    knowsAbout: [
      "Deepfake protection",
      "Impersonation protection",
      "Online reputation protection",
      "Digital identity incident response",
      "Image Immunization",
    ],
    contactPoint: [
      { "@type": "ContactPoint", contactType: "customer support", email: "relations@protectbyeterna.com" },
      { "@type": "ContactPoint", contactType: "media", email: "press@protectbyeterna.com" },
      { "@type": "ContactPoint", contactType: "partnerships", email: "partnerships@protectbyeterna.com" },
    ],
    ...(SOCIAL_PROFILES.length ? { sameAs: SOCIAL_PROFILES } : {}),
  };
}

/** Optional named author for an article; omit to credit the Organization. */
export type ArticleAuthor = { name: string; jobTitle?: string; url?: string; sameAs?: string[] };

export function articleAuthor(author?: ArticleAuthor) {
  if (!author) return ORG_REF;
  return {
    "@type": "Person",
    name: author.name,
    ...(author.jobTitle ? { jobTitle: author.jobTitle } : {}),
    ...(author.url ? { url: author.url } : {}),
    ...(author.sameAs?.length ? { sameAs: author.sameAs } : {}),
  };
}

/** Common Article fields: image, mainEntityOfPage, author and publisher. */
export function articleCommon(opts: { url: string; image?: string; author?: ArticleAuthor }) {
  return {
    image: opts.image ?? DEFAULT_ARTICLE_IMAGE,
    mainEntityOfPage: { "@type": "WebPage", "@id": opts.url },
    author: articleAuthor(opts.author),
    publisher: PUBLISHER,
  };
}

export function serviceNode(opts: {
  url: string;
  name: string;
  serviceType: string;
  description: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    serviceType: opts.serviceType,
    description: opts.description,
    provider: { "@id": ORG_ID },
    areaServed: "Worldwide",
    url: opts.url,
  };
}
