/**
 * Platform / host classification for discovered URLs.
 *
 * The only purpose of this module is to tell the enforcement pipeline WHO the
 * page belongs to and whether that party can actually remove the content.
 * A CDN, proxy, cache or search-engine result is NEVER the removal party —
 * those classify as `removalCapable: false` so enforcement must resolve the
 * origin host instead.
 *
 * This module does not create removal routes and does not verify contacts.
 */

export type PlatformKind =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "x"
  | "pinterest"
  | "reddit"
  | "telegram"
  | "marketplace"
  | "blog"
  | "forum"
  | "image_host"
  | "video_host"
  | "cdn_proxy"
  | "search_engine"
  | "website";

export interface PlatformClassification {
  kind: PlatformKind;
  host: string;
  registrableDomain: string;
  /** Human label for UI. */
  label: string;
  /** True when this host itself is normally able to remove the content. */
  removalCapable: boolean;
  /** True when the URL points at infrastructure that only mirrors content. */
  isInfrastructure: boolean;
  /** True when the URL is a search result / index page, not the infringing page. */
  isSearchSurface: boolean;
  /** True when the URL identifies a specific post/page (not just a domain root). */
  hasExactPage: boolean;
  reason: string;
}

const UGC: Array<{ kind: PlatformKind; label: string; hosts: string[] }> = [
  { kind: "instagram", label: "Instagram", hosts: ["instagram.com", "cdninstagram.com"] },
  { kind: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.com", "fb.watch"] },
  { kind: "tiktok", label: "TikTok", hosts: ["tiktok.com", "vt.tiktok.com"] },
  { kind: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be", "m.youtube.com"] },
  { kind: "x", label: "X / Twitter", hosts: ["x.com", "twitter.com", "t.co"] },
  { kind: "pinterest", label: "Pinterest", hosts: ["pinterest.com", "pin.it", "pinimg.com"] },
  { kind: "reddit", label: "Reddit", hosts: ["reddit.com", "redd.it"] },
  { kind: "telegram", label: "Telegram", hosts: ["t.me", "telegram.me", "telegra.ph"] },
];

const MARKETPLACES = [
  "amazon.",
  "ebay.",
  "etsy.com",
  "aliexpress.",
  "alibaba.com",
  "flipkart.com",
  "meesho.com",
  "shopify.com",
  "redbubble.com",
  "teespring.com",
  "gumroad.com",
];

const BLOGS = [
  "blogspot.",
  "wordpress.com",
  "medium.com",
  "tumblr.com",
  "substack.com",
  "wixsite.com",
  "weebly.com",
  "ghost.io",
];

const FORUMS = ["discourse.", "phpbb.", "forum.", "boards.", "4chan.org", "quora.com"];

const IMAGE_HOSTS = [
  "imgur.com",
  "ibb.co",
  "postimg.cc",
  "imgbb.com",
  "imagebam.com",
  "pixhost.to",
  "imgbox.com",
  "tinypic.",
  "gyazo.com",
];

const VIDEO_HOSTS = [
  "dailymotion.com",
  "vimeo.com",
  "rumble.com",
  "streamable.com",
  "bitchute.com",
  "odysee.com",
  "ok.ru",
  "vk.com",
];

const CDN_PROXY = [
  "cloudfront.net",
  "akamaihd.net",
  "akamaized.net",
  "fastly.net",
  "fbcdn.net",
  "cdninstagram.com",
  "pinimg.com",
  "ggpht.com",
  "ytimg.com",
  "twimg.com",
  "licdn.com",
  "cloudflare-ipfs.com",
  "cdn.jsdelivr.net",
  "imagedelivery.net",
  "wp.com",
  "webcache.googleusercontent.com",
  "gstatic.com",
  "googleusercontent.com",
  "b-cdn.net",
  "bunnycdn.com",
  "cf-ipfs.com",
];

const SEARCH_SURFACES = [
  "google.com",
  "google.co",
  "bing.com",
  "duckduckgo.com",
  "yandex.",
  "search.marcia",
  "baidu.com",
  "lens.google.com",
  "images.google.",
  "yahoo.com",
  "ecosia.org",
  "startpage.com",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function registrable(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  // Handles the common two-label public suffixes we care about.
  const twoLabelSuffix = /\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(host);
  return parts.slice(twoLabelSuffix ? -3 : -2).join(".");
}

function matches(host: string, needles: string[]): boolean {
  return needles.some((n) => host === n || host.endsWith(`.${n}`) || host.includes(n));
}

/** True when the URL addresses a specific page/post rather than a bare domain. */
export function hasExactPageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (path.length > 1) return true;
    // Query-only permalinks (e.g. ?p=123, ?v=abc) still identify a page.
    return u.search.length > 1;
  } catch {
    return false;
  }
}

export function classifyPlatform(url: string): PlatformClassification | null {
  const host = hostOf(url);
  if (!host) return null;
  const base = {
    host,
    registrableDomain: registrable(host),
    hasExactPage: hasExactPageUrl(url),
  };

  if (matches(host, SEARCH_SURFACES) && !matches(host, ["googleusercontent.com"])) {
    return {
      ...base,
      kind: "search_engine",
      label: "Search engine result",
      removalCapable: false,
      isInfrastructure: false,
      isSearchSurface: true,
      reason: "Search surfaces index content; they are not the hosting party.",
    };
  }

  if (matches(host, CDN_PROXY)) {
    return {
      ...base,
      kind: "cdn_proxy",
      label: "CDN / proxy",
      removalCapable: false,
      isInfrastructure: true,
      isSearchSurface: false,
      reason: "CDN/proxy host only mirrors media; the origin host must be resolved.",
    };
  }

  for (const entry of UGC) {
    if (matches(host, entry.hosts)) {
      return {
        ...base,
        kind: entry.kind,
        label: entry.label,
        removalCapable: true,
        isInfrastructure: false,
        isSearchSurface: false,
        reason: `Known UGC platform (${entry.label}) with a first-party reporting channel.`,
      };
    }
  }

  const bucket: Array<[PlatformKind, string, string[]]> = [
    ["marketplace", "Marketplace", MARKETPLACES],
    ["blog", "Blog / CMS", BLOGS],
    ["forum", "Forum", FORUMS],
    ["image_host", "Image host", IMAGE_HOSTS],
    ["video_host", "Video host", VIDEO_HOSTS],
  ];
  for (const [kind, label, hosts] of bucket) {
    if (matches(host, hosts)) {
      return {
        ...base,
        kind,
        label,
        removalCapable: true,
        isInfrastructure: false,
        isSearchSurface: false,
        reason: `Classified as ${label} by host pattern.`,
      };
    }
  }

  return {
    ...base,
    kind: "website",
    label: "Independent website",
    removalCapable: true,
    isInfrastructure: false,
    isSearchSurface: false,
    reason: "Independent host — removal party must still be verified separately.",
  };
}

/**
 * Enforcement pre-check. Returns why a URL is not actionable, or null when the
 * URL is at least *shaped* like an actionable target. This never asserts that a
 * removal route exists — route verification stays with the enforcement layer.
 */
export function actionabilityBlocker(url: string): string | null {
  const c = classifyPlatform(url);
  if (!c) return "Unparseable URL";
  if (c.isSearchSurface) return "Search-engine result, not the hosting page";
  if (c.isInfrastructure) return "CDN/proxy host — origin host not resolved";
  if (!c.hasExactPage) return "Domain-only URL — exact page/post URL required";
  return null;
}
