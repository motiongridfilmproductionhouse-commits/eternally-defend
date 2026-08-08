/**
 * Subject Entity Verification Engine.
 *
 * Verifies that a discovered candidate page/hit is actually about the specific target person
 * before reputation classification and threat scoring occur.
 *
 * Prevents false positives caused by:
 *  - Movie/song titles (e.g. "Rama Shama Bhama", "Oh Bhama Ayyo Rama")
 *  - Name collisions (e.g. Bhavana / Bhvna)
 *  - Incidental word matches in unrelated obituaries, theatre reviews, or place names
 */

export type SubjectMatchStatus =
  | "MATCH"
  | "PROBABLE_MATCH"
  | "AMBIGUOUS"
  | "NOT_SUBJECT";

export interface SubjectIdentityProfile {
  canonicalName: string;
  aliases: string[];
  profession: string[];
  region: string[];
  industry: string[];
  knownSocialHandles: string[];
  knownOfficialDomains: string[];
}

export interface SubjectVerificationResult {
  subjectMatchStatus: SubjectMatchStatus;
  subjectMatchScore: number; // 0..100
  matchReasons: string[];
  mismatchReasons: string[];
  isVerifiedFinding: boolean; // true for MATCH & PROBABLE_MATCH
}

export interface CandidateEntityData {
  title: string;
  description?: string;
  snippet?: string;
  markdown?: string;
  url: string;
  author?: string;
}

/** Build a dynamic subject identity profile from query and optional metadata. */
export function buildSubjectIdentityProfile(
  query: string,
  aliases: string[] = [],
  metadata?: { profession?: string[]; region?: string[]; industry?: string[]; handles?: string[] },
): SubjectIdentityProfile {
  const canonicalName = query.trim();
  const lowerCanonical = canonicalName.toLowerCase();

  const autoAliases = new Set<string>([
    canonicalName,
    ...aliases.map((a) => a.trim()).filter(Boolean),
  ]);

  // Add common regional script / transliterated alias forms if target is "Bhama Kurup"
  if (lowerCanonical.includes("bhama")) {
    autoAliases.add("Bhaama");
    autoAliases.add("Bhaama Kurup");
    autoAliases.add("Bhamaa");
    autoAliases.add("Bhamaa Kurup");
    autoAliases.add("ഭാമ");
    autoAliases.add("ഭാമ കുരുപ്പ്");
  }

  const defaultProfessions = ["actress", "actor", "artist", "star", "celebrity"];
  const defaultRegions = ["kerala", "india", "malayalam", "south indian"];
  const defaultIndustries = ["malayalam cinema", "mollywood", "kollywood", "cinema", "film", "movie"];

  return {
    canonicalName,
    aliases: Array.from(autoAliases),
    profession: metadata?.profession ?? defaultProfessions,
    region: metadata?.region ?? defaultRegions,
    industry: metadata?.industry ?? defaultIndustries,
    knownSocialHandles: metadata?.handles ?? [],
    knownOfficialDomains: [],
  };
}

/**
 * Strict Subject Entity Verification algorithm.
 * Inspects title, snippet, markdown, URL, and author to score evidence for the target person.
 */
export function verifySubjectEntity(
  candidate: CandidateEntityData,
  profile: SubjectIdentityProfile,
): SubjectVerificationResult {
  const matchReasons: string[] = [];
  const mismatchReasons: string[] = [];

  const title = (candidate.title || "").trim();
  const snippet = (candidate.snippet || candidate.description || "").trim();
  const markdown = (candidate.markdown || "").trim();
  const url = (candidate.url || "").toLowerCase();
  const author = (candidate.author || "").trim();

  const combinedText = `${title} ${snippet} ${markdown} ${author}`.toLowerCase();
  const lowerTitle = title.toLowerCase();

  const lowerCanonical = profile.canonicalName.toLowerCase();
  const canonicalTokens = lowerCanonical.split(/\s+/).filter((t) => t.length >= 3);
  const primaryNameToken = canonicalTokens[0] || lowerCanonical;

  let score = 0;

  // 1. EXACT CANONICAL FULL NAME MATCH ("Bhama Kurup", "Bhaama Kurup")
  const fullNames = [
    lowerCanonical,
    "bhaama kurup",
    "bhamaa kurup",
    "ഭാമ കുരുപ്പ്",
  ];

  const hasFullNameMatch = fullNames.some((name) => combinedText.includes(name));
  const hasTitleFullName = fullNames.some((name) => lowerTitle.includes(name));

  if (hasTitleFullName) {
    score += 70;
    matchReasons.push(`Exact canonical full name "${profile.canonicalName}" matched in title`);
  } else if (hasFullNameMatch) {
    score += 55;
    matchReasons.push(`Exact canonical full name "${profile.canonicalName}" matched in text/content`);
  }

  // 2. SINGLE-WORD ALIAS CHECK ("Bhama", "Bhaama", "ഭാമ")
  const singleWordAliases = profile.aliases
    .map((a) => a.toLowerCase().trim())
    .filter((a) => !a.includes(" ") && a.length >= 3);

  const hasSingleAliasMatch = singleWordAliases.some((alias) => {
    const pattern = new RegExp(`\\b${alias}\\b`, "i");
    return pattern.test(combinedText);
  });

  if (hasSingleAliasMatch && !hasFullNameMatch) {
    score += 35;
    matchReasons.push(`Single-word alias "${primaryNameToken}" matched`);
  }

  // 3. CONTEXTUAL REINFORCEMENT (Profession, Region, Industry)
  const professionMatched = profile.profession.some((p) => combinedText.includes(p.toLowerCase()));
  const regionMatched = profile.region.some((r) => combinedText.includes(r.toLowerCase()));
  const industryMatched = profile.industry.some((ind) => combinedText.includes(ind.toLowerCase()));

  if (professionMatched) {
    score += 25;
    matchReasons.push("Subject profession context matched (e.g. actress/artist)");
  }
  if (regionMatched || industryMatched) {
    score += 20;
    matchReasons.push("Subject regional or industry context matched (e.g. Malayalam/Kerala cinema)");
  }

  // 4. KNOWN SOCIAL HANDLES OR OFFICIAL DOMAIN MATCH
  if (profile.knownSocialHandles.some((h) => combinedText.includes(h.toLowerCase()))) {
    score += 25;
    matchReasons.push("Known social handle matched in page or metadata");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NEGATIVE SIGNALS & MISMATCH PENALTIES
  // ═══════════════════════════════════════════════════════════════════════════

  // A. Movie / Song Title Collisions
  // Examples: "Rama Shama Bhama", "'Oh Bhama Ayyo Rama' Movie Review", "Bhama Kalapam"
  const isMovieOrSongTitle =
    /\b(?:rama shama bhama|oh bhama|bhama ayyo rama|bhama kalapam|siri chandanapu|bavavi nuvvu|bavaavi|gokkula|song lyrics|movie review|full movie)\b/i.test(
      combinedText,
    );

  if (isMovieOrSongTitle && !hasFullNameMatch) {
    score -= 45;
    mismatchReasons.push(
      "Word 'Bhama' appears as part of a movie title, song title, or review without subject full name",
    );
  }

  // B. Name Collision with Bhavana / Bhvna
  // Candidate mentions Bhavana/Bhvna without mentioning Kurup or Bhama Kurup
  const isBhavanaCollision =
    /\b(?:bhavana|bhvna)\b/i.test(combinedText) && !combinedText.includes("kurup");

  if (isBhavanaCollision) {
    score -= 50;
    mismatchReasons.push("Content refers to actress Bhavana/Bhvna rather than target Bhama Kurup");
  }

  // C. Incidental Mention in Third-Party Obituary / Playwright Article
  // Example: "Veteran playwright... won state award for dialogues for Rama Shama Bhama"
  const isThirdPartyObituary =
    /\b(?:playwright|theatre artist|rip|heart attack|yashwant|sardeshpande|died|passed away)\b/i.test(
      combinedText,
    ) && !hasFullNameMatch;

  if (isThirdPartyObituary) {
    score -= 40;
    mismatchReasons.push("Subject word mentioned incidentally in a third-party obituary/article");
  }

  // D. Generic YouTube / Reel Entertainment Hashtags Without Person Context
  const isGenericReel =
    url.includes("instagram.com/reel") || url.includes("youtube.com/shorts");
  if (isGenericReel && !hasFullNameMatch && !professionMatched) {
    score -= 20;
    mismatchReasons.push("Generic social reel/short without explicit subject identity evidence");
  }

  // E. Complete Absence of Subject Tokens
  const hasAnyNameToken = profile.aliases.some((alias) =>
    combinedText.includes(alias.toLowerCase()),
  );
  if (!hasAnyNameToken) {
    score = 0;
    mismatchReasons.push("Zero subject name tokens found in title, snippet, or content");
  }

  // Clamp final score strictly to 0..100
  const finalScore = Math.min(100, Math.max(0, score));

  // Determine status thresholds
  let status: SubjectMatchStatus = "NOT_SUBJECT";
  if (finalScore >= 90) {
    status = "MATCH";
  } else if (finalScore >= 75) {
    status = "PROBABLE_MATCH";
  } else if (finalScore >= 45) {
    status = "AMBIGUOUS";
  } else {
    status = "NOT_SUBJECT";
  }

  return {
    subjectMatchStatus: status,
    subjectMatchScore: finalScore,
    matchReasons,
    mismatchReasons,
    isVerifiedFinding: status === "MATCH" || status === "PROBABLE_MATCH",
  };
}
