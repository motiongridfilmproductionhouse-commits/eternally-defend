/**
 * Shared target-identity matching for Deepfake Intelligence.
 *
 * Multi-word names (e.g. "Honey Rose") must match as a full phrase.
 * Generic single tokens such as "honey" or "rose" are never enough.
 */

export interface IdentityTarget {
  name: string;
  aliases?: string[];
  handles?: string[];
}

export function normalizeIdentityText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Common single tokens that must never count as identity evidence alone.
 * Multi-word phrases that include these tokens (e.g. "Honey Rose") remain valid.
 */
const GENERIC_IDENTITY_TOKENS = new Set([
  "honey",
  "rose",
  "star",
  "queen",
  "king",
  "baby",
  "love",
  "angel",
  "diamond",
  "crystal",
  "ruby",
  "jade",
  "amber",
  "candy",
  "cherry",
  "peach",
  "lady",
  "girl",
  "boy",
  "prince",
  "princess",
  "devi",
  "rani",
  "maya",
  "priya",
  "ananya",
  "model",
  "actress",
  "actor",
  "beauty",
  "indian",
  "malayalam",
  "cinema",
]);

function phraseTokens(phrase: string): string[] {
  return phrase.split(/\s+/).filter(Boolean);
}

/**
 * True when a normalized identity phrase is strong enough to use for matching.
 * Rejects bare generic tokens like "honey" or "rose".
 */
export function isUsableIdentityPhrase(phrase: string): boolean {
  const normalized = normalizeIdentityText(phrase);
  if (normalized.length < 3) return false;

  const tokens = phraseTokens(normalized);
  if (tokens.length >= 2) {
    /*
     * Multi-word phrases are accepted when at least one token is distinctive
     * or the full phrase is long enough to be a real person name.
     */
    return normalized.length >= 5;
  }

  const token = tokens[0] ?? "";
  if (token.length < 4) return false;
  if (GENERIC_IDENTITY_TOKENS.has(token)) return false;
  return true;
}

/**
 * Identity phrases used for matching: full name, aliases and handles.
 * Generic single-token aliases/handles are dropped.
 */
export function getIdentityPhrases(target: IdentityTarget): string[] {
  const raw = [
    target.name,
    ...(target.aliases ?? []),
    ...(target.handles ?? []),
  ];

  const phrases = raw
    .map(normalizeIdentityText)
    .filter(isUsableIdentityPhrase);

  return Array.from(new Set(phrases));
}

/**
 * True when text contains a usable full identity phrase for the selected target.
 * Partial token hits (only "honey" or only "rose" for "Honey Rose") return false.
 */
export function matchesSelectedIdentity(
  text: string,
  target: IdentityTarget,
): boolean {
  const normalized = normalizeIdentityText(text);
  if (!normalized) return false;

  const phrases = getIdentityPhrases(target);
  if (!phrases.length) return false;

  return phrases.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(normalized);
  });
}

/**
 * True when text contains only a generic token from the target name and not
 * the full selected identity (e.g. "wild honey recipe" for target Honey Rose).
 */
export function isGenericTokenOnlyMention(
  text: string,
  target: IdentityTarget,
): boolean {
  if (matchesSelectedIdentity(text, target)) return false;

  const normalized = normalizeIdentityText(text);
  const primaryTokens = phraseTokens(normalizeIdentityText(target.name));

  if (primaryTokens.length < 2) return false;

  const hasGenericToken = primaryTokens.some(
    (token) =>
      GENERIC_IDENTITY_TOKENS.has(token) &&
      new RegExp(`(?:^|\\s)${token}(?:$|\\s)`, "i").test(normalized),
  );

  return hasGenericToken;
}
