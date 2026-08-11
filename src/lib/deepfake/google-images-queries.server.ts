/**
 * Mandatory Google Images threat discovery query generation.
 * Searches specifically for indexed images associated with target synthetic impersonation.
 */

import { expandIdentityVariants } from "./identity-variants.server";

export const GOOGLE_IMAGES_INVESTIGATION_KEYWORDS = [
  "deepfake",
  "face swap",
  "faceswap",
  "fake nude",
  "nude fake",
  "AI fake",
  "synthetic media",
  "fake video",
  "fake images",
  "explicit AI",
  "leaked AI",
] as const;

export const GOOGLE_IMAGES_PRIORITY_KEYWORDS = [
  "deepfake",
  "face swap",
  "fake nude",
  "AI fake",
] as const;

export const GOOGLE_IMAGES_MAX_QUERIES = 58;
export const GOOGLE_IMAGES_TARGET_MIN = 300;
export const GOOGLE_IMAGES_TARGET_MAX = 1000;

function quoteIdentity(identity: string): string {
  const clean = identity.replaceAll('"', "").trim();
  if (!clean) return "";
  return `"${clean}"`;
}

function isNativeScript(value: string): boolean {
  return /[\u0900-\u0DFF]/.test(value);
}

function uniquePreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

/**
 * Build target-specific Google Images threat search queries for a protected identity.
 */
export function buildGoogleImagesInvestigationQueries(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
  maxQueries?: number;
}): string[] {
  const max = Math.min(
    GOOGLE_IMAGES_MAX_QUERIES,
    Math.max(12, input.maxQueries ?? GOOGLE_IMAGES_MAX_QUERIES),
  );

  const variants = expandIdentityVariants({
    name: input.name,
    aliases: input.aliases,
    handles: input.handles,
  });

  const primary = input.name.trim();
  const explicitAliases = (input.aliases ?? []).map((a) => a.trim()).filter(Boolean);
  const shortNicknames = uniquePreserve([
    ...explicitAliases,
    ...variants.filter((v) => {
      const tokens = v.split(/\s+/);
      return tokens.length === 1 && v.length <= 6 && !isNativeScript(v);
    }),
  ]);
  const nativeVariants = variants.filter(isNativeScript);
  const otherIdentities = variants.filter(
    (v) =>
      v !== primary &&
      !shortNicknames.some((n) => n.toLowerCase() === v.toLowerCase()) &&
      !nativeVariants.includes(v),
  );

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (query: string) => {
    const key = query.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    out.push(query.trim());
    return true;
  };

  const pushIdentityKeywords = (identity: string, keywords: readonly string[]) => {
    const quoted = quoteIdentity(identity);
    if (!quoted) return;
    for (const keyword of keywords) {
      push(`${quoted} ${keyword}`);
      if (out.length >= max) return;
    }
  };

  pushIdentityKeywords(primary, GOOGLE_IMAGES_INVESTIGATION_KEYWORDS);
  if (out.length >= max) return out.slice(0, max);

  for (const nickname of shortNicknames.slice(0, 4)) {
    pushIdentityKeywords(nickname, GOOGLE_IMAGES_PRIORITY_KEYWORDS);
    if (out.length >= max) return out.slice(0, max);
  }

  for (const native of nativeVariants.slice(0, 4)) {
    pushIdentityKeywords(native, GOOGLE_IMAGES_PRIORITY_KEYWORDS);
    if (out.length >= max) return out.slice(0, max);
  }

  for (const identity of otherIdentities.slice(0, 10)) {
    pushIdentityKeywords(identity, GOOGLE_IMAGES_INVESTIGATION_KEYWORDS);
    if (out.length >= max) return out.slice(0, max);
  }

  return out.slice(0, max);
}
