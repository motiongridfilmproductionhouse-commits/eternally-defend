/**
 * Optional known-URL investigation seeds for Copyright Intelligence.
 *
 * User-supplied URLs are high-priority discovery seeds only — never auto-guilty.
 * Every URL still passes SSRF/DNS safety, exact-page crawl, title identity and
 * distribution-access evidence gates.
 */

import { assertSafePublicUrlForFetch, isSafePublicHttpUrl } from "@/lib/deepfake/url-safety.server";
import { canonicalUrl, hostOf } from "./url.server";

export const MAX_KNOWN_URLS = 10;

export type KnownUrlRejectReason =
  | "invalid_url"
  | "unsupported_protocol"
  | "private_or_reserved"
  | "url_safety_rejected"
  | "dns_resolution_failed"
  | "duplicate";

export interface KnownUrlSeed {
  input: string;
  url: string;
  host: string | null;
  accepted: boolean;
  rejectReason?: KnownUrlRejectReason;
  rejectDetail?: string;
}

/** Parse / normalize / dedupe raw known-URL input (max 10). */
export function parseKnownUrlInputs(raw: unknown): string[] {
  const list: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) list.push(item.trim());
    }
  } else if (typeof raw === "string") {
    for (const part of raw.split(/[\n,]+/)) {
      const t = part.trim();
      if (t) list.push(t);
    }
  }
  return [...new Set(list)].slice(0, MAX_KNOWN_URLS);
}

/**
 * Validate known URLs for investigation. Does not crawl.
 * Rejects non-http(s), private/reserved hosts, and duplicates after canonicalization.
 */
export async function validateKnownUrlSeeds(inputs: string[]): Promise<KnownUrlSeed[]> {
  const out: KnownUrlSeed[] = [];
  const seen = new Set<string>();

  for (const input of inputs.slice(0, MAX_KNOWN_URLS)) {
    const trimmed = input.trim();
    if (!trimmed) continue;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      out.push({
        input: trimmed,
        url: trimmed,
        host: null,
        accepted: false,
        rejectReason: "invalid_url",
        rejectDetail: "Could not parse as a URL.",
      });
      continue;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      out.push({
        input: trimmed,
        url: trimmed,
        host: hostOf(trimmed),
        accepted: false,
        rejectReason: "unsupported_protocol",
        rejectDetail: `Only http/https are allowed (got ${parsed.protocol}).`,
      });
      continue;
    }

    if (!isSafePublicHttpUrl(trimmed)) {
      out.push({
        input: trimmed,
        url: trimmed,
        host: hostOf(trimmed),
        accepted: false,
        rejectReason: "private_or_reserved",
        rejectDetail: "URL failed static public-http safety checks.",
      });
      continue;
    }

    try {
      await assertSafePublicUrlForFetch(trimmed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const dns = /dns|resolve|ENOTFOUND|getaddrinfo/i.test(msg);
      out.push({
        input: trimmed,
        url: trimmed,
        host: hostOf(trimmed),
        accepted: false,
        rejectReason: dns ? "dns_resolution_failed" : "url_safety_rejected",
        rejectDetail: msg.slice(0, 240),
      });
      continue;
    }

    const canon = canonicalUrl(trimmed);
    if (seen.has(canon)) {
      out.push({
        input: trimmed,
        url: canon,
        host: hostOf(canon),
        accepted: false,
        rejectReason: "duplicate",
        rejectDetail: "Duplicate after normalization.",
      });
      continue;
    }
    seen.add(canon);
    out.push({
      input: trimmed,
      url: canon,
      host: hostOf(canon),
      accepted: true,
    });
  }

  return out;
}

export function acceptedKnownUrls(seeds: KnownUrlSeed[]): string[] {
  return seeds.filter((s) => s.accepted).map((s) => s.url);
}

/**
 * Merge known-URL seeds ahead of provider candidates so they receive crawl budget.
 * Dedupes by canonical URL. Known URLs never bypass later evidence gates.
 *
 * Capacity is reserved: every accepted known URL is included before provider
 * candidates, even when provider volume exceeds the page cap.
 */
export function prioritizeKnownUrlLeads<T extends { url: string }>(
  known: T[],
  provider: T[],
  limit = 32,
): T[] {
  const knownSlots = Math.min(known.length, MAX_KNOWN_URLS);
  const effectiveCap = Math.max(limit, knownSlots);
  const providerSlots = Math.max(0, effectiveCap - knownSlots);

  const leadSeen = new Set<string>();
  const out: T[] = [];

  for (const lead of known.slice(0, knownSlots)) {
    const key = canonicalUrl(lead.url);
    if (leadSeen.has(key)) continue;
    leadSeen.add(key);
    out.push({ ...lead, url: key });
  }

  let providerAdded = 0;
  for (const lead of provider) {
    if (providerAdded >= providerSlots) break;
    const key = canonicalUrl(lead.url);
    if (leadSeen.has(key)) continue;
    leadSeen.add(key);
    out.push({ ...lead, url: key });
    providerAdded += 1;
  }

  return out;
}
