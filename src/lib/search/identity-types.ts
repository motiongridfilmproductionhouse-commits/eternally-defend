/**
 * Shared types for Identity-Aware Search Expansion.
 */

export const SEARCH_ENTITY_TYPES = [
  "person",
  "actress",
  "actor",
  "influencer",
  "politician",
  "businessperson",
  "brand",
  "company",
  "film",
  "television_series",
  "character",
  "product",
  "social_username",
  "organization",
  "unknown",
] as const;

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export type SearchModulePolicy =
  | "general"
  | "reputation"
  | "deepfake"
  | "impersonation"
  | "copyright"
  | "youtube"
  | "reddit"
  | "news"
  | "social"
  | "image"
  | "monitoring"
  | "manual";

export type SearchQueryCategory =
  | "canonical"
  | "alias"
  | "local_language"
  | "context"
  | "social_handle"
  | "risk"
  | "platform";

export type AliasSource =
  | "ai_discovered"
  | "user_provided"
  | "reviewer_approved"
  | "rejected"
  | "knowledge_base"
  | "heuristic";

export type PersistedIdentityHints = {
  /** Existing DB row id when a persisted profile matched. */
  profileId?: string | null;
  canonicalName?: string | null;
  aliases?: string[];
  handles?: string[];
  localLanguageNames?: string[];
  reviewerConfirmed?: boolean;
  rejectedAliases?: string[];
};

export type SearchExpansionInput = {
  query: string;
  entityType?: string;
  country?: string;
  language?: string;
  referenceImages?: string[];
  knownAliases?: string[];
  knownHandles?: string[];
  /** Module policy controls risk/copyright query injection. */
  module?: SearchModulePolicy;
  /** Optional user/org id for cache scoping. */
  userId?: string | null;
  /** Skip network/AI enrichment (tests). */
  offlineOnly?: boolean;
  /** Reviewer/user-persisted identity hints (loaded by callers). */
  persistedProfile?: PersistedIdentityHints | null;
};

export type ExpandedSearchQuery = {
  query: string;
  category: SearchQueryCategory;
  priority: number;
};

export type AmbiguityCandidate = {
  name: string;
  reason: string;
  confidence: number;
};

export type SearchExpansionResult = {
  originalQuery: string;
  correctedQuery: string;
  canonicalName: string | null;
  entityType: SearchEntityType;
  confidence: number;
  ambiguous: boolean;

  aliases: string[];
  localLanguageNames: string[];
  nicknames: string[];
  formerNames: string[];
  usernames: string[];
  hashtags: string[];

  relatedShows: string[];
  relatedFilms: string[];
  characterNames: string[];
  professions: string[];
  organizations: string[];

  searchQueries: ExpandedSearchQuery[];
  ambiguityCandidates: AmbiguityCandidate[];

  /** Diagnostic audit trail — never treat as confirmed legal labels. */
  resolutionSource: string[];
  aliasSources: Record<string, AliasSource>;
  diagnostics: {
    extractedShow?: string | null;
    extractedProfession?: string | null;
    extractedPartialName?: string | null;
    extractedCharacter?: string | null;
    fallback: boolean;
    cacheHit: boolean;
  };
};

export type IdentityRelevance = {
  matchedIdentity: boolean;
  confidence: number;
  matchedTerms: string[];
  conflictingIdentity?: string;
  quarantine: boolean;
  reason: string;
};

export type DedupedSearchResult<T> = {
  item: T;
  discoveredByQueries: string[];
  fingerprint: string;
};

export const QUERY_LIMITS = {
  canonical: 5,
  alias: 10,
  local_language: 5,
  context: 10,
  platform: 10,
  social_handle: 10,
  risk: 10,
  total: 35,
} as const;

export const IDENTITY_CONFIDENCE_THRESHOLD = 0.7;
export const IDENTITY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
