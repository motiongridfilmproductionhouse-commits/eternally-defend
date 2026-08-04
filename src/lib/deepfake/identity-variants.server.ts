/**
 * Automatic investigation alias expansion for Deepfake Intelligence.
 * Never rely on a single name spelling — generate multilingual and nickname variants.
 */

import { isUsableIdentityPhrase, normalizeIdentityText } from "./identity.server";

export interface IdentityVariantInput {
  name: string;
  aliases?: string[];
  handles?: string[];
  /** Optional native-script hints, e.g. Malayalam for Dulquer Salmaan */
  nativeScriptAliases?: string[];
}

const MAX_AUTO_ALIASES = 48;

/** Common transliteration pairs for Indian film celebrities (extendable). */
const KNOWN_NATIVE_VARIANTS: Record<string, string[]> = {
  "dulquer salmaan": ["ഡുൽഖർ", "ദുൽഖർ", "ദുൽഖർ സൽമാൻ", "dulquer salman", "dq"],
  "dulquer salman": ["ഡുൽഖർ", "ദുൽഖർ", "dulquer salmaan", "dq"],
  "mohanlal": ["മോഹൻലാൽ", "lalettan"],
  "mammootty": ["മമ്മൂട്ടി", "mammooty"],
  "prithviraj": ["പ്രിത്വിരാജ്", "prithvi"],
  "fahadh faasil": ["ഫഹദ് ഫാസിൽ", "fahad faasil"],
  "nayanthara": ["നയൻതാര", "nayantara"],
  "deepika padukone": ["दीपिका पादुकोण", "deepika"],
  "sarayu mohan": ["സരയു മോഹൻ", "സരയു", "sarayu", "sarayumohan"],
  "sarayu": ["സരയു", "sarayu mohan"],
};

function uniquePreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.trim().replace(/\s+/g, " ");
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function initialsFrom(name: string): string[] {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [];
  const letters = tokens.map((t) => t[0]?.toUpperCase()).filter(Boolean);
  if (letters.length < 2) return [];
  const joined = letters.join("");
  return [
    joined,
    `${joined} Actor`,
    `${joined} ${tokens[tokens.length - 1]}`,
  ];
}

function misspellings(name: string): string[] {
  const out: string[] = [];
  const lower = name.toLowerCase();
  if (lower.includes("salmaan")) out.push(name.replace(/salmaan/i, "salman"));
  if (lower.includes("salman") && !lower.includes("salmaan")) {
    out.push(name.replace(/salman/i, "salmaan"));
  }
  if (lower.includes("mohammed")) out.push(name.replace(/mohammed/i, "mohammad"));
  if (lower.includes("mohammad")) out.push(name.replace(/mohammad/i, "mohammed"));
  if (/\bmohan\b/i.test(name) && !/mohanlal/i.test(name)) {
    out.push(name.replace(/mohan/i, "mohaan"));
    out.push(name.replace(/mohan/i, "mohan."));
  }
  if (/\bsarayu\b/i.test(name)) {
    out.push(name.replace(/sarayu/i, "sarayoo"));
    out.push(name.replace(/sarayu/i, "sarayau"));
    out.push(name.replace(/sarayu/i, "saray u"));
  }
  // Common vowel / double-letter slips for multi-token identities
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const first = tokens[0]!;
    const rest = tokens.slice(1).join(" ");
    if (/ayu$/i.test(first)) out.push(`${first.replace(/ayu$/i, "ayoo")} ${rest}`);
    if (/oo$/i.test(first)) out.push(`${first.replace(/oo$/i, "u")} ${rest}`);
    if (/([a-z])\1/i.test(first)) {
      out.push(`${first.replace(/([a-z])\1/i, "$1")} ${rest}`);
    }
    // Spaced initials (e.g. "S. M.")
    const letters = tokens.map((t) => t[0]?.toUpperCase()).filter(Boolean);
    if (letters.length >= 2) out.push(letters.join(". ") + ".");
  }
  return out;
}

function handleVariants(handles: string[]): string[] {
  const out: string[] = [];
  for (const h of handles) {
    const clean = h.replace(/^@+/, "").trim();
    if (!clean) continue;
    out.push(`@${clean}`, clean);
  }
  return out;
}

function filmContextPhrases(name: string): string[] {
  return [
    `${name} actor`,
    `${name} movie`,
    `${name} film`,
    `${name} photos`,
    `${name} images`,
  ];
}

/**
 * Expand a target into investigation-grade aliases without manual entry.
 */
export function expandIdentityVariants(input: IdentityVariantInput): string[] {
  const base = input.name.trim();
  if (!base) return [];

  const seeds = uniquePreserve([
    base,
    ...(input.aliases ?? []),
    ...(input.nativeScriptAliases ?? []),
    ...handleVariants(input.handles ?? []),
  ]);

  const generated: string[] = [...seeds];

  for (const seed of seeds.slice(0, 6)) {
    generated.push(...initialsFrom(seed));
    generated.push(...misspellings(seed));
    generated.push(...filmContextPhrases(seed));

    const key = normalizeIdentityText(seed);
    const known = KNOWN_NATIVE_VARIANTS[key];
    if (known) generated.push(...known);

    // Hyphenated / compact forms
    const compact = seed.replace(/\s+/g, "");
    if (compact.length >= 4 && compact !== seed) generated.push(compact);
    const hyphen = seed.replace(/\s+/g, "-");
    if (hyphen !== seed) generated.push(hyphen);
  }

  return uniquePreserve(generated)
    .filter((phrase) => {
      const knownNicknames = new Set(Object.values(KNOWN_NATIVE_VARIANTS).flat());
      if (knownNicknames.has(phrase)) return true;
      return isUsableIdentityPhrase(phrase) || /[\u0900-\u0DFF]/u.test(phrase);
    })
    .slice(0, MAX_AUTO_ALIASES);
}

/** Aliases for query generation — excludes the primary name. */
export function expandedAliasesForTarget(input: IdentityVariantInput): string[] {
  const all = expandIdentityVariants(input);
  const primary = normalizeIdentityText(input.name);
  return all.filter((a) => normalizeIdentityText(a) !== primary);
}
