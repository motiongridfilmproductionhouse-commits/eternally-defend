/**
 * Deduplicate provider results discovered via multiple expanded queries.
 */

import type { DedupedSearchResult } from "./identity-types";

export function normalizeUrlForDedupe(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Drop common tracking params
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref)/i.test(key)) u.searchParams.delete(key);
    }
    let host = u.hostname.replace(/^www\./, "").toLowerCase();
    let path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${host}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function extractPlatformIds(url: string): string[] {
  const ids: string[] = [];
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("youtube.com") || host === "youtu.be") {
      const v = u.searchParams.get("v");
      if (v) ids.push(`yt:${v}`);
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{6,})/i);
      if (m?.[2]) ids.push(`yt:${m[2]}`);
      if (host === "youtu.be") {
        const id = u.pathname.replace(/^\//, "").slice(0, 20);
        if (id) ids.push(`yt:${id}`);
      }
    }
    if (host.includes("reddit.com")) {
      const m = u.pathname.match(/\/comments\/([a-z0-9]+)/i);
      if (m?.[1]) ids.push(`reddit:${m[1]}`);
    }
    if (host.includes("instagram.com")) {
      const m = u.pathname.match(/\/(p|reel|tv)\/([^/]+)/i);
      if (m?.[2]) ids.push(`ig:${m[2]}`);
    }
    if (host.includes("facebook.com") || host.includes("fb.watch")) {
      const m = u.pathname.match(/\/(?:posts|videos|watch)\/(\d+)/i);
      if (m?.[1]) ids.push(`fb:${m[1]}`);
      const story = u.searchParams.get("story_fbid") || u.searchParams.get("v");
      if (story) ids.push(`fb:${story}`);
    }
  } catch {
    /* ignore */
  }
  return ids;
}

export function normalizeTitleForDedupe(title: string | null | undefined): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function resultFingerprint(opts: {
  url?: string | null;
  title?: string | null;
  platformId?: string | null;
  imageHash?: string | null;
  contentFingerprint?: string | null;
}): string {
  if (opts.contentFingerprint) return `cf:${opts.contentFingerprint}`;
  if (opts.imageHash) return `phash:${opts.imageHash}`;
  if (opts.platformId) return `pid:${opts.platformId}`;
  if (opts.url) {
    const ids = extractPlatformIds(opts.url);
    if (ids[0]) return ids[0];
    return `url:${normalizeUrlForDedupe(opts.url)}`;
  }
  if (opts.title) return `title:${normalizeTitleForDedupe(opts.title)}`;
  return `anon:${Math.random().toString(36).slice(2)}`;
}

export function mergeSearchResultsByFingerprint<T>(
  rows: Array<{
    item: T;
    url?: string | null;
    title?: string | null;
    platformId?: string | null;
    imageHash?: string | null;
    contentFingerprint?: string | null;
    discoveredByQuery: string;
  }>,
): DedupedSearchResult<T>[] {
  const map = new Map<string, DedupedSearchResult<T>>();
  for (const row of rows) {
    const fingerprint = resultFingerprint(row);
    const existing = map.get(fingerprint);
    if (!existing) {
      map.set(fingerprint, {
        item: row.item,
        fingerprint,
        discoveredByQueries: [row.discoveredByQuery],
      });
    } else if (!existing.discoveredByQueries.includes(row.discoveredByQuery)) {
      existing.discoveredByQueries.push(row.discoveredByQuery);
    }
  }
  return [...map.values()];
}
