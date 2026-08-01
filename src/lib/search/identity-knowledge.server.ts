/**
 * Curated identity knowledge + spelling heuristics for offline-safe expansion.
 * AI enrichment may extend this; curated rows are never treated as legal proof.
 */

import type { SearchEntityType } from "./identity-types";

export type KnownIdentity = {
  canonicalName: string;
  entityType: SearchEntityType;
  aliases: string[];
  localLanguageNames: string[];
  nicknames: string[];
  formerNames: string[];
  usernames: string[];
  relatedShows: string[];
  relatedFilms: string[];
  characterNames: string[];
  professions: string[];
  organizations: string[];
  countries?: string[];
  languages?: string[];
};

/** High-signal seed identities used when AI/network enrichment is unavailable. */
export const KNOWN_IDENTITIES: KnownIdentity[] = [
  {
    canonicalName: "Manju Pathrose",
    entityType: "actress",
    aliases: [
      "Manju Pauthrose",
      "Manju Pathros",
      "Manju Sunichen",
      "Manju Sunichan",
      "Manju Sunichen Pathrose",
    ],
    localLanguageNames: ["മഞ്ജു പത്രോസ്", "മഞ്ജു സുനിച്ചൻ", "മഞ്ജു സുനിച്ചന്"],
    nicknames: ["Thankam"],
    formerNames: [],
    usernames: [],
    relatedShows: ["Aliyans", "Aliyan's"],
    relatedFilms: [],
    characterNames: ["Thankam"],
    professions: ["actress", "actor", "television actress"],
    organizations: [],
    countries: ["India"],
    languages: ["ml", "en"],
  },
  {
    canonicalName: "Manju Warrier",
    entityType: "actress",
    aliases: ["Manju Warrior", "Manju Varier"],
    localLanguageNames: ["മഞ്ജു വാര്യർ"],
    nicknames: [],
    formerNames: [],
    usernames: [],
    relatedShows: [],
    relatedFilms: ["Kannezhuthi Pottum Thottu", "How Old Are You"],
    characterNames: [],
    professions: ["actress", "actor"],
    organizations: [],
    countries: ["India"],
    languages: ["ml", "en"],
  },
  {
    canonicalName: "Manju Pillai",
    entityType: "actress",
    aliases: ["Manju Pillay"],
    localLanguageNames: ["മഞ്ജു പിള്ള"],
    nicknames: [],
    formerNames: [],
    usernames: [],
    relatedShows: ["Uppum Mulakum"],
    relatedFilms: [],
    characterNames: [],
    professions: ["actress", "actor"],
    organizations: [],
    countries: ["India"],
    languages: ["ml", "en"],
  },
];

const PROFESSION_RE =
  /\b(actress|actor|influencer|politician|businessperson|business\s*man|business\s*woman|model|singer|director|producer|brand|company|organization|org)\b/i;

const SHOW_HINT_RE =
  /\b(show|serial|series|reality|film|movie|cinema|character|role)\b/i;

export function normalizeKey(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u0D00-\u0D7F]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cur = a[i] === b[j] ? row[j]! : Math.min(row[j]!, row[j + 1]!, prev) + 1;
      row[j] = prev;
      prev = cur;
    }
    row[b.length] = prev;
  }
  return row[b.length]!;
}

export function extractContextHints(query: string): {
  profession: string | null;
  show: string | null;
  character: string | null;
  partialName: string | null;
  remainder: string;
} {
  const raw = query.trim();
  const professionMatch = raw.match(PROFESSION_RE);
  const profession = professionMatch?.[1]?.toLowerCase() ?? null;

  let working = raw;
  if (professionMatch) {
    working = working.replace(professionMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Patterns like "Aliyans actress Manju" / "Aliyans Thankam"
  const tokens = working.split(/\s+/).filter(Boolean);
  let show: string | null = null;
  let character: string | null = null;
  let partialName: string | null = null;

  const aliyansIdx = tokens.findIndex((t) => /^aliyan'?s?$/i.test(t));
  if (aliyansIdx >= 0) {
    show = "Aliyans";
    const after = tokens.slice(aliyansIdx + 1);
    if (after.length === 1) {
      // Aliyans Thankam OR Aliyans Manju
      if (/^thankam$/i.test(after[0]!)) character = "Thankam";
      else partialName = after[0]!;
    } else if (after.length >= 2) {
      partialName = after.join(" ");
    }
  }

  // "Thankam Aliyans"
  if (!show && tokens.length >= 2 && /^aliyan'?s?$/i.test(tokens[tokens.length - 1]!)) {
    show = "Aliyans";
    const head = tokens.slice(0, -1).join(" ");
    if (/^thankam$/i.test(head)) character = "Thankam";
    else partialName = head;
  }

  if (!partialName && tokens.length) {
    // Drop generic show/film hint words, keep likely name tokens.
    const nameTokens = tokens.filter(
      (t) => !SHOW_HINT_RE.test(t) && !/^aliyan'?s?$/i.test(t) && !/^thankam$/i.test(t),
    );
    if (nameTokens.length) partialName = nameTokens.join(" ");
    if (!character && tokens.some((t) => /^thankam$/i.test(t))) character = "Thankam";
  }

  return {
    profession,
    show,
    character,
    partialName,
    remainder: working,
  };
}

export function correctSpellingAgainstKnown(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return query;

  const surnamePool = new Set<string>();
  for (const id of KNOWN_IDENTITIES) {
    for (const name of [id.canonicalName, ...id.aliases]) {
      const parts = name.split(/\s+/);
      if (parts.length >= 2) surnamePool.add(parts[parts.length - 1]!);
    }
  }

  const corrected = tokens.map((tok) => {
    const n = normalizeKey(tok);
    if (n.length < 4) return tok;
    let best: string | null = null;
    let bestDist = Infinity;
    for (const s of surnamePool) {
      const sn = normalizeKey(s);
      const dist = levenshtein(n, sn);
      const threshold = Math.max(1, Math.floor(sn.length * 0.34));
      if (dist > 0 && dist <= threshold && dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    // Preserve original casing style loosely.
    if (best && bestDist <= 2) {
      return best[0]!.toUpperCase() + best.slice(1);
    }
    return tok;
  });

  return corrected.join(" ");
}

export function scoreIdentityMatch(
  identity: KnownIdentity,
  opts: {
    query: string;
    corrected: string;
    profession: string | null;
    show: string | null;
    character: string | null;
    partialName: string | null;
    knownAliases?: string[];
    knownHandles?: string[];
  },
): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const q = normalizeKey(opts.query);
  const c = normalizeKey(opts.corrected);
  const canon = normalizeKey(identity.canonicalName);
  const allNames = [
    identity.canonicalName,
    ...identity.aliases,
    ...identity.localLanguageNames,
    ...identity.nicknames,
    ...identity.formerNames,
  ].map(normalizeKey);

  if (allNames.includes(q) || allNames.includes(c) || c === canon || q === canon) {
    score += 0.78;
    reasons.push("exact_or_alias_name");
  } else if (q.includes(canon) || c.includes(canon)) {
    score += 0.5;
    reasons.push("canonical_in_query");
  } else if (opts.partialName) {
    const pn = normalizeKey(opts.partialName);
    const first = canon.split(" ")[0] ?? "";
    if (pn === canon || allNames.includes(pn)) {
      score += 0.55;
      reasons.push("partial_full_match");
    } else if (pn === first || canon.startsWith(`${pn} `)) {
      score += 0.18;
      reasons.push("first_name_only");
    }
  }

  if (opts.show) {
    const showN = normalizeKey(opts.show);
    if (identity.relatedShows.some((s) => normalizeKey(s) === showN || normalizeKey(s).includes(showN))) {
      score += 0.35;
      reasons.push("show_match");
    }
  }

  if (opts.character) {
    const ch = normalizeKey(opts.character);
    if (
      identity.characterNames.some((s) => normalizeKey(s) === ch) ||
      identity.nicknames.some((s) => normalizeKey(s) === ch)
    ) {
      score += 0.35;
      reasons.push("character_match");
    }
  }

  if (opts.profession) {
    const p = normalizeKey(opts.profession);
    if (identity.professions.some((x) => normalizeKey(x).includes(p) || p.includes(normalizeKey(x)))) {
      score += 0.15;
      reasons.push("profession_match");
    }
  }

  // Unique contextual bundle: show + (character OR profession+partial name)
  if (
    reasons.includes("show_match") &&
    (reasons.includes("character_match") ||
      (reasons.includes("profession_match") && reasons.includes("first_name_only")))
  ) {
    score += 0.2;
    reasons.push("contextual_bundle");
  }

  // Local-language direct hit
  if (identity.localLanguageNames.some((n) => opts.query.includes(n))) {
    score += 0.5;
    reasons.push("local_language_name");
  }

  for (const handle of opts.knownHandles ?? []) {
    const h = normalizeKey(handle.replace(/^@/, ""));
    if (identity.usernames.some((u) => normalizeKey(u.replace(/^@/, "")) === h)) {
      score += 0.4;
      reasons.push("official_handle");
    }
  }

  for (const alias of opts.knownAliases ?? []) {
    if (allNames.includes(normalizeKey(alias))) {
      score += 0.15;
      reasons.push("user_alias_overlap");
    }
  }

  return { confidence: Math.max(0, Math.min(0.99, score)), reasons };
}

export function findIdentityCandidates(opts: {
  query: string;
  corrected: string;
  profession: string | null;
  show: string | null;
  character: string | null;
  partialName: string | null;
  knownAliases?: string[];
  knownHandles?: string[];
}): Array<{ identity: KnownIdentity; confidence: number; reasons: string[] }> {
  return KNOWN_IDENTITIES.map((identity) => {
    const scored = scoreIdentityMatch(identity, opts);
    return { identity, confidence: scored.confidence, reasons: scored.reasons };
  })
    .filter((c) => c.confidence > 0.05)
    .sort((a, b) => b.confidence - a.confidence);
}
