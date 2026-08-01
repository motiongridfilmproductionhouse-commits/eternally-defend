/**
 * Identity-Aware Search Expansion — shared across all Eterna search modules.
 *
 * Flow: raw query → entity/context extract → spelling correction → canonical
 * identity → aliases/context → ranked query variants.
 *
 * Failures never abort a scan: callers should use resolveAndExpandSearchQuerySafe.
 */

import {
  correctSpellingAgainstKnown,
  extractContextHints,
  findIdentityCandidates,
  normalizeKey,
  type KnownIdentity,
} from "./identity-knowledge.server";
import {
  allowsPlatformQueries,
  copyrightTermsForModule,
  riskTermsForModule,
} from "./module-query-policy.server";
import {
  IDENTITY_CONFIDENCE_THRESHOLD,
  QUERY_LIMITS,
  type AliasSource,
  type AmbiguityCandidate,
  type ExpandedSearchQuery,
  type SearchEntityType,
  type SearchExpansionInput,
  type SearchExpansionResult,
  type SearchModulePolicy,
  type SearchQueryCategory,
} from "./identity-types";

const MEMORY_CACHE = new Map<string, { expires: number; value: SearchExpansionResult }>();

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t) continue;
    const key = normalizeKey(t) || t;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function asEntityType(value: string | undefined): SearchEntityType {
  const v = (value ?? "unknown").toLowerCase().replace(/\s+/g, "_");
  const allowed: SearchEntityType[] = [
    "person", "actress", "actor", "influencer", "politician", "businessperson",
    "brand", "company", "film", "television_series", "character", "product",
    "social_username", "organization", "unknown",
  ];
  return (allowed.includes(v as SearchEntityType) ? v : "unknown") as SearchEntityType;
}

function quote(value: string): string {
  const cleaned = value.replaceAll('"', "").trim();
  return cleaned ? `"${cleaned}"` : "";
}

function cacheKey(input: SearchExpansionInput): string {
  return JSON.stringify({
    q: input.query.trim().toLowerCase(),
    e: input.entityType ?? "",
    m: input.module ?? "general",
    a: [...(input.knownAliases ?? [])].map((x) => x.toLowerCase()).sort(),
    h: [...(input.knownHandles ?? [])].map((x) => x.toLowerCase()).sort(),
    c: input.country ?? "",
    l: input.language ?? "",
    u: input.userId ?? "",
  });
}

export function invalidateIdentityExpansionCache(opts?: {
  query?: string;
  userId?: string | null;
  all?: boolean;
}): void {
  if (opts?.all) {
    MEMORY_CACHE.clear();
    return;
  }
  for (const key of MEMORY_CACHE.keys()) {
    try {
      const parsed = JSON.parse(key) as { q?: string; u?: string };
      if (opts?.query && parsed.q === opts.query.trim().toLowerCase()) {
        MEMORY_CACHE.delete(key);
      }
      if (opts?.userId && parsed.u === opts.userId) {
        MEMORY_CACHE.delete(key);
      }
    } catch {
      MEMORY_CACHE.delete(key);
    }
  }
}

function pushQuery(
  bucket: ExpandedSearchQuery[],
  query: string,
  category: SearchQueryCategory,
  priority: number,
) {
  const q = query.replace(/\s+/g, " ").trim();
  if (!q || q.length < 2) return;
  if (bucket.some((b) => normalizeKey(b.query) === normalizeKey(q))) return;
  bucket.push({ query: q, category, priority });
}

function buildQueries(opts: {
  original: string;
  corrected: string;
  canonical: string | null;
  identity: KnownIdentity | null;
  aliases: string[];
  localNames: string[];
  usernames: string[];
  shows: string[];
  films: string[];
  characters: string[];
  professions: string[];
  module: SearchModulePolicy;
  entityType: SearchEntityType;
}): ExpandedSearchQuery[] {
  const out: ExpandedSearchQuery[] = [];
  const canonical = opts.canonical;
  const filmLike =
    opts.module === "copyright" ||
    opts.entityType === "film" ||
    opts.entityType === "television_series";

  // 1–2. Canonical + corrected + original
  if (canonical) pushQuery(out, quote(canonical), "canonical", 1);
  if (opts.corrected && normalizeKey(opts.corrected) !== normalizeKey(canonical ?? "")) {
    pushQuery(out, quote(opts.corrected), "canonical", 2);
  }
  pushQuery(out, quote(opts.original), "canonical", 2);
  if (canonical) {
    for (const role of ["actress", "actor", "official"]) {
      pushQuery(out, `${quote(canonical)} ${role}`, "canonical", 3);
    }
  }

  // 3. Strong aliases
  for (const alias of opts.aliases) {
    pushQuery(out, quote(alias), "alias", 3);
  }

  // 4. Official handles / social
  for (const handle of opts.usernames) {
    const h = handle.replace(/^@/, "").trim();
    if (!h) continue;
    pushQuery(out, quote(h), "social_handle", 4);
    pushQuery(out, `@${h}`, "social_handle", 4);
    if (allowsPlatformQueries(opts.module)) {
      pushQuery(out, `site:instagram.com ${quote(h)}`, "platform", 5);
    }
  }

  // 5. Context (show/character/film)
  for (const show of opts.shows) {
    if (canonical) pushQuery(out, `${quote(canonical)} ${quote(show)}`, "context", 5);
    for (const ch of opts.characters) {
      pushQuery(out, `${quote(show)} ${quote(ch)}`, "context", 5);
      pushQuery(out, `${quote(ch)} actress`, "context", 6);
    }
    const partial = (canonical ?? opts.corrected).split(/\s+/)[0];
    if (partial) {
      pushQuery(out, `${quote(show)} actress ${quote(partial)}`, "context", 5);
    }
    pushQuery(out, `${quote(show)} actress`, "context", 6);
  }
  for (const film of opts.films) {
    if (canonical) pushQuery(out, `${quote(canonical)} ${quote(film)}`, "context", 5);
  }
  for (const ch of opts.characters) {
    if (canonical) pushQuery(out, `${quote(canonical)} ${quote(ch)}`, "context", 5);
  }

  // Preserve rich contextual originals like "Aliyans actress Manju"
  if (/\b(actress|actor|aliyan)/i.test(opts.original)) {
    pushQuery(out, opts.original, "context", 5);
  }

  // 6. Local-language
  for (const local of opts.localNames) {
    pushQuery(out, local, "local_language", 6);
  }

  // 7. Platform queries
  if (allowsPlatformQueries(opts.module) && canonical) {
    for (const platform of ["Instagram", "Facebook", "YouTube"]) {
      pushQuery(out, `${quote(canonical)} ${platform}`, "platform", 7);
    }
    pushQuery(out, `site:facebook.com ${quote(canonical)}`, "platform", 7);
    pushQuery(out, `site:youtube.com ${quote(canonical)}`, "platform", 7);
  }

  // 8. Module-specific risk / copyright terms
  const riskTerms = riskTermsForModule(opts.module);
  const riskName = canonical ?? opts.corrected ?? opts.original;
  for (const term of riskTerms) {
    pushQuery(out, `${quote(riskName)} ${term}`, "risk", 8);
  }

  const copyrightTerms = copyrightTermsForModule(opts.module);
  const title = filmLike ? (canonical ?? opts.corrected ?? opts.original) : null;
  if (title) {
    for (const term of copyrightTerms) {
      pushQuery(out, `${quote(title)} ${term}`, "risk", 8);
    }
  }

  // Profession spice for people
  if (canonical && opts.professions[0] && !filmLike) {
    pushQuery(out, `${quote(canonical)} ${opts.professions[0]}`, "alias", 4);
  }

  return rankAndLimitQueries(out);
}

function rankAndLimitQueries(queries: ExpandedSearchQuery[]): ExpandedSearchQuery[] {
  const byCat = new Map<SearchQueryCategory, ExpandedSearchQuery[]>();
  for (const q of queries) {
    const list = byCat.get(q.category) ?? [];
    list.push(q);
    byCat.set(q.category, list);
  }

  const limits: Record<SearchQueryCategory, number> = {
    canonical: QUERY_LIMITS.canonical,
    alias: QUERY_LIMITS.alias,
    local_language: QUERY_LIMITS.local_language,
    context: QUERY_LIMITS.context,
    social_handle: QUERY_LIMITS.social_handle,
    platform: QUERY_LIMITS.platform,
    risk: QUERY_LIMITS.risk,
  };

  const selected: ExpandedSearchQuery[] = [];
  for (const [cat, limit] of Object.entries(limits) as Array<[SearchQueryCategory, number]>) {
    const list = (byCat.get(cat) ?? []).sort((a, b) => a.priority - b.priority).slice(0, limit);
    selected.push(...list);
  }

  return selected
    .sort((a, b) => a.priority - b.priority || a.query.localeCompare(b.query))
    .slice(0, QUERY_LIMITS.total);
}

function emptyFallback(input: SearchExpansionInput, corrected: string): SearchExpansionResult {
  const aliases = uniqueStrings([...(input.knownAliases ?? [])]);
  const handles = uniqueStrings([...(input.knownHandles ?? [])]);
  const module = (input.module ?? "general") as SearchModulePolicy;
  const searchQueries = buildQueries({
    original: input.query.trim(),
    corrected,
    canonical: corrected || input.query.trim(),
    identity: null,
    aliases,
    localNames: [],
    usernames: handles,
    shows: [],
    films: [],
    characters: [],
    professions: [],
    module,
    entityType: asEntityType(input.entityType),
  });

  return {
    originalQuery: input.query.trim(),
    correctedQuery: corrected,
    canonicalName: corrected || input.query.trim() || null,
    entityType: asEntityType(input.entityType),
    confidence: corrected !== input.query.trim() ? 0.55 : 0.4,
    ambiguous: false,
    aliases,
    localLanguageNames: [],
    nicknames: [],
    formerNames: [],
    usernames: handles,
    hashtags: [],
    relatedShows: [],
    relatedFilms: [],
    characterNames: [],
    professions: [],
    organizations: [],
    searchQueries,
    ambiguityCandidates: [],
    resolutionSource: ["fallback"],
    aliasSources: Object.fromEntries(aliases.map((a) => [a, "user_provided" as AliasSource])),
    diagnostics: {
      extractedShow: null,
      extractedProfession: null,
      extractedPartialName: null,
      extractedCharacter: null,
      fallback: true,
      cacheHit: false,
    },
  };
}

/**
 * Resolve identity + expand search queries. Prefer the Safe wrapper in scans.
 */
export async function resolveAndExpandSearchQuery(
  input: SearchExpansionInput,
): Promise<SearchExpansionResult> {
  const original = (input.query ?? "").trim();
  if (!original) {
    return emptyFallback({ ...input, query: "" }, "");
  }

  const key = cacheKey(input);
  const cached = MEMORY_CACHE.get(key);
  if (cached && cached.expires > Date.now()) {
    return {
      ...cached.value,
      diagnostics: { ...cached.value.diagnostics, cacheHit: true },
    };
  }

  const hints = extractContextHints(original);
  const corrected = correctSpellingAgainstKnown(original);
  const module = (input.module ?? "general") as SearchModulePolicy;

  const candidates = findIdentityCandidates({
    query: original,
    corrected,
    profession: hints.profession,
    show: hints.show,
    character: hints.character,
    partialName: hints.partialName,
    knownAliases: input.knownAliases,
    knownHandles: input.knownHandles,
  });

  const top = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  const ambiguous =
    !top ||
    top.confidence < IDENTITY_CONFIDENCE_THRESHOLD ||
    (second != null && top.confidence - second.confidence < 0.15 && second.confidence >= 0.25);

  const ambiguityCandidates: AmbiguityCandidate[] = candidates.slice(0, 5).map((c) => ({
    name: c.identity.canonicalName,
    reason: c.reasons.join(", ") || "name_similarity",
    confidence: Number(c.confidence.toFixed(4)),
  }));

  // Do not auto-commit low-confidence identities as canonical.
  const identity = top && top.confidence >= IDENTITY_CONFIDENCE_THRESHOLD ? top.identity : null;
  const canonicalName = identity?.canonicalName ?? (ambiguous ? null : corrected);
  const confidence = top?.confidence ?? (corrected !== original ? 0.5 : 0.35);

  const userAliases = uniqueStrings(input.knownAliases ?? []);
  const userHandles = uniqueStrings(input.knownHandles ?? []);

  const aliases = uniqueStrings([
    ...(identity?.aliases ?? []),
    ...userAliases,
    corrected !== original ? corrected : null,
    // Keep misspelling as searchable alias when we corrected it
    original !== (canonicalName ?? corrected) ? original : null,
    ...(identity && !ambiguous ? [] : []),
  ]).filter((a) => normalizeKey(a) !== normalizeKey(canonicalName ?? ""));

  const localLanguageNames = uniqueStrings(identity?.localLanguageNames ?? []);
  const nicknames = uniqueStrings(identity?.nicknames ?? []);
  const formerNames = uniqueStrings(identity?.formerNames ?? []);
  const usernames = uniqueStrings([...(identity?.usernames ?? []), ...userHandles]);
  const relatedShows = uniqueStrings([
    ...(identity?.relatedShows ?? []),
    hints.show,
  ]);
  const relatedFilms = uniqueStrings(identity?.relatedFilms ?? []);
  const characterNames = uniqueStrings([
    ...(identity?.characterNames ?? []),
    hints.character,
  ]);
  const professions = uniqueStrings([
    ...(identity?.professions ?? []),
    hints.profession,
  ]);

  const entityType: SearchEntityType =
    asEntityType(input.entityType) !== "unknown"
      ? asEntityType(input.entityType)
      : (identity?.entityType ??
        (hints.profession === "actress" || hints.profession === "actor"
          ? (hints.profession as SearchEntityType)
          : hints.show
            ? "actress"
            : "person"));

  const aliasSources: Record<string, AliasSource> = {};
  for (const a of userAliases) aliasSources[a] = "user_provided";
  for (const a of identity?.aliases ?? []) {
    if (!aliasSources[a]) aliasSources[a] = "knowledge_base";
  }

  const searchQueries = buildQueries({
    original,
    corrected,
    canonical: canonicalName,
    identity,
    aliases,
    localNames: localLanguageNames,
    usernames,
    shows: relatedShows,
    films: relatedFilms,
    characters: characterNames,
    professions,
    module,
    entityType,
  });

  const result: SearchExpansionResult = {
    originalQuery: original,
    correctedQuery: corrected,
    canonicalName,
    entityType,
    confidence: Number(confidence.toFixed(4)),
    ambiguous: Boolean(ambiguous && candidates.length > 0),
    aliases,
    localLanguageNames,
    nicknames,
    formerNames,
    usernames,
    hashtags: [],
    relatedShows,
    relatedFilms,
    characterNames,
    professions,
    organizations: uniqueStrings(identity?.organizations ?? []),
    searchQueries,
    ambiguityCandidates,
    resolutionSource: [
      "heuristic_context",
      "spelling_correction",
      identity ? "knowledge_base" : "unresolved",
      ...(input.knownAliases?.length ? ["user_aliases"] : []),
      ...(input.knownHandles?.length ? ["user_handles"] : []),
    ],
    aliasSources,
    diagnostics: {
      extractedShow: hints.show,
      extractedProfession: hints.profession,
      extractedPartialName: hints.partialName,
      extractedCharacter: hints.character,
      fallback: false,
      cacheHit: false,
    },
  };

  MEMORY_CACHE.set(key, {
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    value: result,
  });

  return result;
}

/**
 * Fail-open wrapper — expansion errors must never stop a scan.
 */
export async function resolveAndExpandSearchQuerySafe(
  input: SearchExpansionInput,
): Promise<SearchExpansionResult> {
  try {
    return await resolveAndExpandSearchQuery(input);
  } catch (error) {
    console.warn(
      "[identity-search-expander] resolution failed; using safe fallback:",
      error instanceof Error ? error.message : String(error),
    );
    const corrected = correctSpellingAgainstKnown(input.query ?? "");
    return emptyFallback(input, corrected || (input.query ?? "").trim());
  }
}

/** Convenience: identity strings for provider matching / query generators. */
export function expansionToIdentityList(expansion: SearchExpansionResult): string[] {
  return uniqueStrings([
    expansion.canonicalName,
    expansion.correctedQuery,
    expansion.originalQuery,
    ...expansion.aliases,
    ...expansion.localLanguageNames,
    ...expansion.nicknames,
    ...expansion.usernames,
  ]);
}

/** Provider-facing query strings in priority order. */
export function expansionQueryStrings(expansion: SearchExpansionResult): string[] {
  return expansion.searchQueries.map((q) => q.query);
}

/** Compact diagnostics object safe for JSON persistence / server-fn returns. */
export type ExpansionDiagnosticsJson = {
  original_query: string;
  corrected_query: string;
  canonical_name: string | null;
  entity_type: string;
  confidence: number;
  ambiguous: boolean;
  aliases: string[];
  local_language_names: string[];
  usernames: string[];
  related_shows: string[];
  related_films: string[];
  character_names: string[];
  professions: string[];
  search_queries: ExpandedSearchQuery[];
  ambiguity_candidates: AmbiguityCandidate[];
  resolution_source: string[];
  diagnostics: {
    extractedShow: string | null;
    extractedProfession: string | null;
    extractedPartialName: string | null;
    extractedCharacter: string | null;
    fallback: boolean;
    cacheHit: boolean;
  };
};

export function expansionDiagnostics(expansion: SearchExpansionResult): ExpansionDiagnosticsJson {
  return {
    original_query: expansion.originalQuery,
    corrected_query: expansion.correctedQuery,
    canonical_name: expansion.canonicalName,
    entity_type: expansion.entityType,
    confidence: expansion.confidence,
    ambiguous: expansion.ambiguous,
    aliases: expansion.aliases,
    local_language_names: expansion.localLanguageNames,
    usernames: expansion.usernames,
    related_shows: expansion.relatedShows,
    related_films: expansion.relatedFilms,
    character_names: expansion.characterNames,
    professions: expansion.professions,
    search_queries: expansion.searchQueries,
    ambiguity_candidates: expansion.ambiguityCandidates,
    resolution_source: expansion.resolutionSource,
    diagnostics: {
      extractedShow: expansion.diagnostics.extractedShow ?? null,
      extractedProfession: expansion.diagnostics.extractedProfession ?? null,
      extractedPartialName: expansion.diagnostics.extractedPartialName ?? null,
      extractedCharacter: expansion.diagnostics.extractedCharacter ?? null,
      fallback: expansion.diagnostics.fallback,
      cacheHit: expansion.diagnostics.cacheHit,
    },
  };
}
