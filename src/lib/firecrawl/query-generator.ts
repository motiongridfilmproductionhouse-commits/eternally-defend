/**
 * Dynamic Multi-Group Query Expansion Engine.
 * Generates subject-specific searches across 6 distinct risk and platform dimensions.
 * Includes automatic local-language / Malayalam / regional term expansion.
 */

export interface QueryExpansionGroup {
  groupName:
    | "IDENTITY"
    | "CONTROVERSY"
    | "TROLL_FAKE_NEWS"
    | "IMPERSONATION_DEEPFAKE"
    | "PLATFORMS"
    | "LOCAL_LANGUAGE";
  queries: string[];
}

export function generateExpandedQueries(
  query: string,
  aliases: string[] = [],
  handles: string[] = [],
): QueryExpansionGroup[] {
  const nameForms = Array.from(
    new Set([query, ...aliases].map((s) => s.trim()).filter(Boolean)),
  );
  const primaryName = nameForms[0] ?? query;
  const quotedPrimary = primaryName.includes(" ") ? `"${primaryName}"` : primaryName;

  // 1. IDENTITY GROUPS
  const identityQueries: string[] = nameForms.map((n) => (n.includes(" ") ? `"${n}"` : n));
  if (primaryName.toLowerCase().includes("bhama")) {
    identityQueries.push(`"${primaryName}" actress`, `"Bhaama Kurup"`);
  }

  // 2. CONTROVERSY & ALLEGATIONS
  const controversyTerms = [
    "controversy",
    "allegations",
    "criticism",
    "scandal",
    "complaint",
    "exposed",
    "response",
    "backlash",
  ];
  const controversyQueries = controversyTerms.map((t) => `${quotedPrimary} ${t}`);

  // 3. TROLLING & FAKE NEWS
  const trollTerms = [
    "troll",
    "trolling",
    "viral",
    "fake news",
    "rumours",
    "rumors",
    "boycott",
  ];
  const trollQueries = trollTerms.map((t) => `${quotedPrimary} ${t}`);

  // 4. IMPERSONATION & DEEPFAKE
  const deepfakeTerms = [
    "impersonation",
    "fake account",
    "edited video",
    "deepfake",
    "morphed",
    "leak",
    "leaked",
  ];
  const deepfakeQueries = deepfakeTerms.map((t) => `${quotedPrimary} ${t}`);

  // 5. PLATFORM SPECIFIC SEARCHES
  const platformSites = [
    "site:youtube.com",
    "site:reddit.com",
    "site:x.com OR site:twitter.com",
    "site:facebook.com",
    "site:instagram.com",
    "site:tiktok.com",
  ];
  const platformQueries = platformSites.map((site) => `${site} ${quotedPrimary}`);

  // 6. LOCAL LANGUAGE & REGIONAL (Malayalam / South Asian / Transliterated)
  const malayalamTerms = [
    "വിവാദം", // controversy
    "ആരോപണം", // allegation
    "വിമർശനം", // criticism
    "വാർത്ത", // news
    "ട്രോൾ", // troll
    "വൈറൽ", // viral
    "വ്യാജ വാർത്ത", // fake news
  ];
  const transliteratedTerms = ["vivadam", "aaropanam", "vartha", "news Malayalam"];

  const localLanguageQueries = [
    ...malayalamTerms.map((term) => `${quotedPrimary} ${term}`),
    ...transliteratedTerms.map((term) => `${quotedPrimary} ${term}`),
  ];

  return [
    { groupName: "IDENTITY", queries: identityQueries },
    { groupName: "CONTROVERSY", queries: controversyQueries },
    { groupName: "TROLL_FAKE_NEWS", queries: trollQueries },
    { groupName: "IMPERSONATION_DEEPFAKE", queries: deepfakeQueries },
    { groupName: "PLATFORMS", queries: platformQueries },
    { groupName: "LOCAL_LANGUAGE", queries: localLanguageQueries },
  ];
}
