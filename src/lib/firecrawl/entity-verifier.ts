/**
 * Subject Entity Verification Engine.
 *
 * Verifies that a discovered candidate page/hit is actually about the specific target person
 * before reputation classification and threat scoring occur.
 *
 * Multi-signal evidence-weighted verification using:
 *  - Title
 *  - Snippet / Description
 *  - Channel / Author
 *  - Transcript (when available)
 *  - OCR / Visual evidence (when available)
 *  - Target aliases, name tokens, and dynamic contextual signals
 */

export type SubjectMatchStatus =
  | "VERIFIED_SUBJECT"
  | "PROBABLE_SUBJECT"
  | "AMBIGUOUS_SUBJECT"
  | "NOT_SUBJECT"
  | "VERIFICATION_FAILED"
  // Legacy aliases for backward compatibility
  | "MATCH"
  | "PROBABLE_MATCH"
  | "AMBIGUOUS";

export interface SubjectIdentityProfile {
  canonicalName: string;
  aliases: string[];
  tokens: string[];
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
  isVerifiedFinding: boolean; // true for VERIFIED_SUBJECT & PROBABLE_SUBJECT
  matchedTargetSignals: string[];
  failedTargetSignals: string[];
  transcriptAvailable?: boolean;
}

export interface CandidateEntityData {
  title: string;
  description?: string;
  snippet?: string;
  markdown?: string;
  url: string;
  author?: string;
  channelTitle?: string;
  transcript?: string;
  thumbnailUrl?: string;
  ocrText?: string;
  hasTranscript?: boolean;
}

export function normalizeText(value: string): string {
  return (value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build a dynamic subject identity profile from query, aliases, and optional metadata. */
export function buildSubjectIdentityProfile(
  query: string,
  aliases: string[] = [],
  metadata?: { profession?: string[]; region?: string[]; industry?: string[]; handles?: string[] },
): SubjectIdentityProfile {
  const canonicalName = query.trim();
  const lowerCanonical = canonicalName.toLowerCase();
  const normalizedCanonical = normalizeText(canonicalName);

  const autoAliases = new Set<string>([
    canonicalName,
    ...aliases.map((a) => a.trim()).filter(Boolean),
  ]);

  if (lowerCanonical.includes("bhama")) {
    autoAliases.add("Bhaama");
    autoAliases.add("Bhaama Kurup");
    autoAliases.add("Bhamaa");
    autoAliases.add("Bhamaa Kurup");
    autoAliases.add("ഭാമ");
    autoAliases.add("ഭാമ കുരുപ്പ്");
  }

  const tokens = Array.from(
    new Set(
      normalizedCanonical
        .split(" ")
        .filter((t) => t.length >= 2),
    ),
  );

  const defaultProfessions = ["businessman", "executive", "chairman", "producer", "director", "actress", "actor", "artist", "star", "celebrity", "founder", "politician"];
  const defaultRegions = ["kerala", "india", "malayalam", "south indian", "chennai", "tamil nadu"];
  const defaultIndustries = ["cinema", "film", "movie", "business", "group", "chits", "finance", "hospitality", "media"];

  return {
    canonicalName,
    aliases: Array.from(autoAliases),
    tokens,
    profession: metadata?.profession ?? defaultProfessions,
    region: metadata?.region ?? defaultRegions,
    industry: metadata?.industry ?? defaultIndustries,
    knownSocialHandles: metadata?.handles ?? [],
    knownOfficialDomains: [],
  };
}

/**
 * Multi-signal Subject Entity Verification algorithm.
 * Inspects title, snippet, description, channel, transcript, OCR, and URL.
 */
export function verifySubjectEntity(
  candidate: CandidateEntityData,
  profile: SubjectIdentityProfile,
): SubjectVerificationResult {
  const matchReasons: string[] = [];
  const mismatchReasons: string[] = [];
  const matchedSignals: string[] = [];
  const failedSignals: string[] = [];

  try {
    const title = (candidate.title || "").trim();
    const snippet = (candidate.snippet || candidate.description || "").trim();
    const markdown = (candidate.markdown || "").trim();
    const author = (candidate.author || candidate.channelTitle || "").trim();
    const transcript = (candidate.transcript || "").trim();
    const ocrText = (candidate.ocrText || "").trim();

    const normalizedTitle = normalizeText(title);
    const normalizedSnippet = normalizeText(snippet);
    const normalizedMarkdown = normalizeText(markdown);
    const normalizedAuthor = normalizeText(author);
    const normalizedTranscript = normalizeText(transcript);
    const normalizedOcr = normalizeText(ocrText);

    const combinedText = `${normalizedTitle} ${normalizedSnippet} ${normalizedMarkdown} ${normalizedAuthor} ${normalizedTranscript} ${normalizedOcr}`;
    const rawCombinedText = `${title} ${snippet} ${markdown} ${author} ${transcript} ${ocrText}`;
    const normalizedCanonical = normalizeText(profile.canonicalName);

    const hasTranscript = Boolean(transcript || candidate.hasTranscript);

    let score = 0;

    // 1. EXACT CANONICAL FULL NAME MATCH IN TITLE OR CONTENT
    const fullNames = Array.from(
      new Set([
        normalizedCanonical,
        ...profile.aliases.map((a) => normalizeText(a)).filter((a) => a.includes(" ")),
      ]),
    );

    const hasTitleFullName = fullNames.some((name) => name && normalizedTitle.includes(name));
    const hasTextFullName = fullNames.some((name) => name && combinedText.includes(name));

    if (hasTitleFullName) {
      score += 75;
      matchReasons.push(`Exact canonical full name "${profile.canonicalName}" matched in title`);
      matchedSignals.push("title_full_name_exact");
    } else if (hasTextFullName) {
      score += 55;
      matchReasons.push(`Exact canonical full name "${profile.canonicalName}" matched in text/content`);
      matchedSignals.push("text_full_name_exact");
    } else {
      failedSignals.push("full_name_exact");
    }

    // 2. NAME TOKENS MULTI-MATCH (e.g. "Gokulam" AND "Gopalan" present)
    if (profile.tokens.length >= 2) {
      const matchedTokens = profile.tokens.filter((tok) => combinedText.includes(tok));
      if (matchedTokens.length === profile.tokens.length) {
        if (!hasTitleFullName && !hasTextFullName) {
          score += 40;
          matchReasons.push(`All ${profile.tokens.length} target name tokens matched (${profile.tokens.join(", ")})`);
        } else {
          score += 15;
        }
        matchedSignals.push("all_name_tokens");
      } else if (matchedTokens.length > 0) {
        matchedSignals.push("partial_name_tokens");
      } else {
        failedSignals.push("all_name_tokens");
      }
    }

    // 3. ALIAS MATCH
    const singleAliases = profile.aliases
      .map((a) => normalizeText(a))
      .filter((a) => a.length >= 3 && !fullNames.includes(a));

    const hasAliasMatch = singleAliases.some((alias) => combinedText.includes(alias));
    if (hasAliasMatch) {
      score += 35;
      matchReasons.push(`Single-word alias "${profile.tokens[0] || profile.canonicalName}" matched`);
      matchedSignals.push("alias_match");
    }

    // 4. TRANSCRIPT MATCH (when transcript is available)
    if (hasTranscript && transcript) {
      const transcriptHasName = fullNames.some((name) => name && normalizedTranscript.includes(name));
      if (transcriptHasName) {
        score += 35;
        matchReasons.push("Target name matched in video transcript");
        matchedSignals.push("transcript_identity_match");
      }
    }

    // 5. CHANNEL / AUTHOR MATCH
    if (author) {
      const channelHasName = fullNames.some((name) => name && normalizedAuthor.includes(name));
      if (channelHasName) {
        score += 30;
        matchReasons.push("Channel/author title matches target name");
        matchedSignals.push("channel_identity_match");
      }
    }

    // 6. THUMBNAIL / OCR MATCH
    if (normalizedOcr) {
      const ocrHasName = fullNames.some((name) => name && normalizedOcr.includes(name));
      if (ocrHasName) {
        score += 20;
        matchReasons.push("OCR/thumbnail text matches target name");
        matchedSignals.push("ocr_identity_match");
      }
    }

    // 7. CONTEXTUAL REINFORCEMENT (Profession, Region, Industry)
    const professionMatched = profile.profession.some((p) => combinedText.includes(p.toLowerCase()));
    const regionMatched = profile.region.some((r) => combinedText.includes(r.toLowerCase()));
    const industryMatched = profile.industry.some((ind) => combinedText.includes(ind.toLowerCase()));

    if (professionMatched) {
      score += 25;
      matchReasons.push("Subject profession context matched (e.g. actress/artist)");
      matchedSignals.push("profession_context");
    }
    if (regionMatched || industryMatched) {
      score += 20;
      matchReasons.push("Subject regional or industry context matched (e.g. Malayalam/Kerala cinema)");
      matchedSignals.push("regional_industry_context");
    }

    // 8. SOCIAL HANDLES / DOMAIN MATCH
    if (profile.knownSocialHandles.some((h) => combinedText.includes(normalizeText(h)))) {
      score += 25;
      matchReasons.push("Known social handle matched in page or metadata");
      matchedSignals.push("handle_match");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NEGATIVE SIGNALS & MISMATCH PENALTIES
    // ═══════════════════════════════════════════════════════════════════════════

    // A. Movie / Song Title Collisions (e.g., "Rama Shama Bhama", "'Oh Bhama Ayyo Rama'", "Bhama Kalapam")
    const isMovieOrSongTitle =
      /\b(?:rama shama bhama|oh bhama|bhama ayyo rama|bhama kalapam|siri chandanapu|bavavi nuvvu|bavaavi|gokkula|song lyrics|movie review|full movie)\b/i.test(
        rawCombinedText,
      );

    if (isMovieOrSongTitle && !hasTextFullName && !hasTitleFullName) {
      score -= 60;
      mismatchReasons.push(
        "Word 'Bhama' appears as part of a movie title, song title, or review without subject full name",
      );
      failedSignals.push("movie_song_title_collision");
    }

    // B. Name Collision with Bhavana / Bhvna (candidate mentions Bhavana/Bhvna without Kurup)
    const isBhavanaCollision =
      /\b(?:bhavana|bhvna)\b/i.test(rawCombinedText) && !combinedText.includes("kurup");

    if (isBhavanaCollision && !hasTextFullName && !hasTitleFullName) {
      score -= 60;
      mismatchReasons.push("Content refers to actress Bhavana/Bhvna rather than target Bhama Kurup");
      failedSignals.push("bhavana_collision");
    }

    // C. Complete Absence of Subject Tokens
    const hasAnyNameToken = profile.tokens.some((token) => combinedText.includes(token)) ||
      profile.aliases.some((alias) => combinedText.includes(normalizeText(alias)));

    if (!hasAnyNameToken) {
      score = 0;
      mismatchReasons.push("Zero subject name tokens found in title, snippet, or content");
      failedSignals.push("any_name_token");
    }

    // Clamp score strictly to 0..100
    const finalScore = Math.min(100, Math.max(0, score));

    // Determine status thresholds
    let status: SubjectMatchStatus = "NOT_SUBJECT";
    if (finalScore >= 90) {
      status = "VERIFIED_SUBJECT";
    } else if (finalScore >= 45) {
      status = "PROBABLE_SUBJECT";
    } else if (finalScore >= 25) {
      status = "AMBIGUOUS_SUBJECT";
    } else {
      status = "NOT_SUBJECT";
    }

    const isVerified = status === "VERIFIED_SUBJECT" || status === "PROBABLE_SUBJECT" || status === "MATCH" || status === "PROBABLE_MATCH";

    return {
      subjectMatchStatus: status,
      subjectMatchScore: finalScore,
      matchReasons,
      mismatchReasons,
      isVerifiedFinding: isVerified,
      matchedTargetSignals: matchedSignals,
      failedTargetSignals: failedSignals,
      transcriptAvailable: hasTranscript,
    };
  } catch (err) {
    const errorMsg = (err as Error)?.message || String(err);
    console.error("[verifySubjectEntity] Exception during target verification:", errorMsg);

    return {
      subjectMatchStatus: "VERIFICATION_FAILED",
      subjectMatchScore: 0,
      matchReasons: [],
      mismatchReasons: [`Verification execution error: ${errorMsg}`],
      isVerifiedFinding: false,
      matchedTargetSignals: [],
      failedTargetSignals: ["execution_error"],
      transcriptAvailable: false,
    };
  }
}
