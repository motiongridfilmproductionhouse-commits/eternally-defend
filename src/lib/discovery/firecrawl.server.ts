// Server-only Firecrawl helpers for social-account discovery.
// Uses direct API mode (FIRECRAWL_API_KEY as `fc-...`), matching the existing project setup.

import type { Platform } from "./scoring";
import { PLATFORM_HOST } from "./scoring";

interface SearchItem {
  url?: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

interface FirecrawlSearchResponse {
  data?: SearchItem[];
  web?: SearchItem[];
  news?: SearchItem[];
  error?: string;
}

interface ScrapeResponseInner {
  markdown?: string;
  html?: string;
  links?: string[];
  metadata?: Record<string, unknown>;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: ScrapeResponseInner;
  markdown?: string;
  html?: string;
  links?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
}

const FC = "https://api.firecrawl.dev/v2";

function requireKey(): string {
  const k = process.env.FIRECRAWL_API_KEY;
  if (!k) throw new Error("FIRECRAWL_API_KEY is not configured");
  return k;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const key = requireKey();
  const res = await fetch(`${FC}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Firecrawl ${path} [${res.status}]: ${text.slice(0, 400)}`);
  }
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`Firecrawl ${path} returned non-JSON`); }
}

export interface CandidateSeed {
  platform: Platform;
  url: string;
  title?: string;
  description?: string;
  source: "firecrawl_search" | "website_links";
}

/** Google-style query per platform. */
function queryForPlatform(subject: string, platform: Platform): string {
  const q = `"${subject}" official`;
  const host = PLATFORM_HOST[platform];
  if (!host) return q;
  return `site:${host} ${q}`;
}

/** Search a single platform for candidate profiles. */
export async function searchPlatform(subject: string, platform: Platform, limit = 6): Promise<CandidateSeed[]> {
  if (platform === "website") return [];
  const res = await post<FirecrawlSearchResponse>("/search", {
    query: queryForPlatform(subject, platform),
    limit,
  });
  const raw = [
    ...(Array.isArray(res.data) ? res.data : []),
    ...(Array.isArray(res.web) ? res.web : []),
    ...(Array.isArray(res.news) ? res.news : []),
  ];
  const seen = new Set<string>();
  const out: CandidateSeed[] = [];
  for (const item of raw) {
    if (!item.url) continue;
    const u = item.url;
    if (seen.has(u)) continue;
    seen.add(u);
    // Only keep URLs on the target platform host.
    try {
      const host = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
      if (!host.endsWith(PLATFORM_HOST[platform])) continue;
    } catch { continue; }
    out.push({
      platform,
      url: u,
      title: typeof item.title === "string" ? item.title : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
      source: "firecrawl_search",
    });
  }
  return out;
}

/** Scrape user's official website to pull outbound social links + host list. */
export async function scrapeOfficialSite(url: string): Promise<{
  outboundHosts: string[];
  outboundLinks: string[];
  logoUrl?: string;
  title?: string;
}> {
  try {
    const res = await post<FirecrawlScrapeResponse>("/scrape", {
      url,
      formats: ["links", "html"],
      onlyMainContent: false,
    });
    const inner = res.data ?? res;
    const links = Array.isArray(inner.links) ? inner.links : [];
    const outboundLinks = links.filter((l): l is string => typeof l === "string");
    const outboundHosts = Array.from(new Set(
      outboundLinks.map((l) => {
        try { return new URL(l).hostname.replace(/^www\./, "").toLowerCase(); }
        catch { return ""; }
      }).filter(Boolean),
    ));
    const md = (inner.metadata ?? {}) as Record<string, unknown>;
    const logoUrl = typeof md["ogImage"] === "string" ? (md["ogImage"] as string)
      : typeof md["og:image"] === "string" ? (md["og:image"] as string) : undefined;
    const title = typeof md["title"] === "string" ? (md["title"] as string) : undefined;
    return { outboundHosts, outboundLinks, logoUrl, title };
  } catch (e) {
    console.warn("[discovery] scrapeOfficialSite failed:", (e as Error).message);
    return { outboundHosts: [], outboundLinks: [] };
  }
}

/** Scrape a single candidate profile page for richer metadata. */
export async function scrapeProfile(url: string): Promise<{
  displayName?: string;
  bio?: string;
  profileImageUrl?: string;
  websiteLinks: string[];
  platformVerified: boolean;
  followerCount?: number;
  html?: string;
}> {
  try {
    const res = await post<FirecrawlScrapeResponse>("/scrape", {
      url,
      formats: ["links", "html", "markdown"],
      onlyMainContent: false,
    });
    const inner = res.data ?? res;
    const md = (inner.metadata ?? {}) as Record<string, unknown>;
    const links = Array.isArray(inner.links) ? inner.links.filter((l): l is string => typeof l === "string") : [];
    const displayName = str(md["title"]) ?? str(md["og:title"]);
    const bio = str(md["description"]) ?? str(md["og:description"]);
    const profileImageUrl = str(md["ogImage"]) ?? str(md["og:image"]) ?? str(md["twitter:image"]);

    const websiteLinks = links.filter((l) => {
      try {
        const h = new URL(l).hostname.replace(/^www\./, "");
        if (!h) return false;
        // Drop links to the same social platform host (usually navigation)
        return !PROVIDER_HOSTS.some((p) => h.endsWith(p));
      } catch { return false; }
    });

    const text = `${inner.markdown ?? ""}\n${bio ?? ""}`.toLowerCase();
    // Very rough follower parser: e.g. "12.3M followers", "245K subscribers"
    const followerCount = parseCount(text);
    // Verified badge hints — extremely rough, best-effort:
    const platformVerified = /"is_verified"\s*:\s*true|verified\s*(account|badge|user)/i.test(inner.html ?? inner.markdown ?? "");

    return {
      displayName, bio, profileImageUrl,
      websiteLinks: Array.from(new Set(websiteLinks)),
      platformVerified,
      followerCount,
      html: inner.html,
    };
  } catch (e) {
    console.warn("[discovery] scrapeProfile failed for", url, ":", (e as Error).message);
    return { websiteLinks: [], platformVerified: false };
  }
}

const PROVIDER_HOSTS = [
  "youtube.com", "youtu.be", "instagram.com", "facebook.com", "fb.com",
  "tiktok.com", "x.com", "twitter.com", "linkedin.com", "reddit.com",
];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function parseCount(text: string): number | undefined {
  const m = text.match(/([\d,.]+)\s*([kmb])?\s*(followers|subscribers|fans|members)/i);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return undefined;
  const suffix = (m[2] ?? "").toLowerCase();
  const mult = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
  return Math.round(n * mult);
}
