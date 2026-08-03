/**
 * Enriched public-page extraction for Copyright Intelligence exact-page crawls.
 * Extraction only — no form submission or authenticated access.
 */

import { isSafePublicHttpUrl } from "@/lib/deepfake/url-safety.server";
import { hostOf } from "./url.server";

const WATCH_TERMS =
  /\b(watch|play|stream|download|mirror|server|torrent|magnet|print|hdrip|webrip|dvdscr|cam|hdts|hdcam|tsrip|full\s*movie)\b/i;

export function detectChallengeOrShellPage(html: string, text: string): boolean {
  const blob = `${html}\n${text}`.toLowerCase();
  if (blob.length < 80) return true;
  return (
    /enable\s+javascript|javascript\s+is\s+(required|disabled|needed)/i.test(blob) ||
    /checking your browser|just a moment|cf-browser-verification|cloudflare/i.test(blob) ||
    /access denied|forbidden|bot detection|ddos protection/i.test(blob) ||
    /please wait while we verify/i.test(blob)
  );
}

export function extractJsonLdBlocks(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(m[1]!.trim()) as unknown;
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          if (row && typeof row === "object") out.push(row as Record<string, unknown>);
        }
      } else if (parsed && typeof parsed === "object") {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out;
}

function pushUrl(out: Set<string>, raw: string | null | undefined, baseUrl: string): void {
  if (!raw?.trim()) return;
  try {
    const url = new URL(raw.trim(), baseUrl).toString();
    if (url.startsWith("magnet:") || isSafePublicHttpUrl(url)) out.add(url);
  } catch {
    // ignore
  }
}

/** Collect anchors, iframes, media, lazy-src, and script-visible URLs from HTML. */
export function enrichLinksFromHtml(html: string, baseUrl: string): string[] {
  const out = new Set<string>();

  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    pushUrl(out, m[1], baseUrl);
  }
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
    pushUrl(out, m[1], baseUrl);
  }
  for (const m of html.matchAll(/<(?:video|source|embed)[^>]+(?:src|data-src)=["']([^"']+)["']/gi)) {
    pushUrl(out, m[1], baseUrl);
  }
  for (const m of html.matchAll(/\bdata-(?:src|lazy-src|video-src)=["']([^"']+)["']/gi)) {
    pushUrl(out, m[1], baseUrl);
  }
  for (const m of html.matchAll(/\b(?:https?:\/\/|magnet:)[^\s"'<>]+/gi)) {
    pushUrl(out, m[0], baseUrl);
  }
  for (const m of html.matchAll(
    /<(?:button|a|div|span)[^>]*>[\s\S]{0,120}?(watch|play|stream|download|mirror|server)[\s\S]{0,120}?<\/(?:button|a|div|span)>/gi,
  )) {
    const tag = m[0];
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href && WATCH_TERMS.test(tag)) pushUrl(out, href, baseUrl);
  }

  return [...out].slice(0, 120);
}

export function mergeUniqueLinks(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const link of group) {
      const key = link.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out.slice(0, 120);
}

export function jsonLdTitleHints(blocks: Array<Record<string, unknown>>): string[] {
  const hints: string[] = [];
  for (const block of blocks) {
    const type = String(block["@type"] ?? "");
    if (!/Movie|VideoObject|TVSeries|CreativeWork/i.test(type)) continue;
    for (const key of ["name", "alternateName", "headline"]) {
      const v = block[key];
      if (typeof v === "string" && v.trim()) hints.push(v.trim());
    }
  }
  return hints;
}

export function isLikelyListingPage(input: {
  url: string;
  primaryPurpose?: string;
  linkCount: number;
  html?: string;
  markdown?: string;
}): boolean {
  if (input.primaryPurpose === "listing_or_search") return true;
  if (/\/(search|category|tag|genre|latest|movies|browse|page\/\d+)(\/|$|\?)/i.test(input.url)) {
    return true;
  }
  const text = `${input.html ?? ""}\n${input.markdown ?? ""}`;
  if (input.linkCount >= 12) return true;
  if (/\/$/.test(input.url.replace(/^https?:\/\/[^/]+/i, "")) && input.linkCount >= 8) return true;
  if (/\b(latest movies|browse movies|all movies|search results)\b/i.test(text)) return true;
  return false;
}

const FILE_HOST_HINTS = [
  "mega.nz",
  "mediafire.com",
  "gofile.io",
  "pixeldrain.com",
  "drive.google.com",
  "terabox.com",
  "terabox.app",
  "1024terabox.com",
  "youtube.com",
  "youtu.be",
  "ok.ru",
  "dailymotion.com",
  "bilibili.tv",
  "bilibili.com",
  "archive.org",
  "ogomovies1.com.pk",
];

export function isRecognizedExternalDetailHost(url: string, pageHost: string | null): boolean {
  const host = hostOf(url)?.toLowerCase() ?? "";
  if (!host || host === pageHost) return false;
  return FILE_HOST_HINTS.some((h) => host === h || host.endsWith(`.${h}`));
}
