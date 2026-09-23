/**
 * Pre-Enrollment Intelligence — identity resolution.
 *
 * A full-name match alone can NEVER produce MATCHED: common names (and staged
 * SEO pages) make name-only matching unsafe. MATCHED requires a name/alias hit
 * PLUS at least one STRONG corroborating signal. Anything weaker is
 * POSSIBLE_MATCH or NEEDS_IDENTITY_REVIEW and contributes to nothing until a
 * staff member approves the identity.
 *
 * Every result carries the factor list that produced its confidence, because
 * the UI is never allowed to print a percentage without its factors.
 */

export type IdentityBucket = "MATCHED" | "POSSIBLE_MATCH" | "NEEDS_IDENTITY_REVIEW" | "UNRELATED";

export interface IdentityFactor {
  key: string;
  label: string;
  points: number;
  strong: boolean;
}

export interface IdentityTargetProfile {
  name: string;
  aliases?: Array<string | null | undefined>;
  profession?: string | null;
  organization?: string | null;
  countryRegion?: string | null;
  knownWebsite?: string | null;
  knownProfileUrl?: string | null;
  /** Handles without the leading @, e.g. ["eterna.official"] */
  knownHandles?: Array<string | null | undefined>;
  /**
   * Staff-supplied or already-verified target-specific context: known works,
   * titles, projects, productions. Generic vocabulary never counts as context.
   */
  knownWorks?: Array<string | null | undefined>;
  /** Staff-supplied linked entities: co-occurring people, companies, labels. */
  linkedEntities?: Array<string | null | undefined>;
  /** True when the name is common or several distinct entities share it. */
  nameIsAmbiguous?: boolean;
}

export interface IdentityCandidate {
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  description?: string | null;
  author?: string | null;
  platform?: string | null;
  pageText?: string | null;
  /** 0–100 similarity from a lawful public reference-image comparison, when available. */
  imageSimilarity?: number | null;
  /** Other distinct entity names observed for the same query in this scan. */
  competingEntities?: string[];
}

export interface IdentityResolution {
  bucket: IdentityBucket;
  confidence: number;
  factors: IdentityFactor[];
  /** "Identity confidence: 94% — Matched name + profession + official Instagram handle" */
  explanation: string;
  strongSignals: string[];
  nameMatched: boolean;
  ambiguityDetected: boolean;
}

export function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-/?#&=+.@]+/g, " ")
    // Malayalam range kept so native-script names still match.
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[^a-zA-Z0-9\u0D00-\u0D7F ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function nameForms(target: IdentityTargetProfile): string[] {
  return Array.from(
    new Set(
      [target.name, ...(target.aliases ?? [])]
        .map((v) => normalizeText(v))
        .filter((v) => v.length >= 3),
    ),
  );
}

/** Common Indian/global surname and honorific tokens that alone mean nothing. */
const GENERIC_TOKENS = new Set([
  "the","and","actor","actress","official","movie","film","video","news","star","singer","director",
  "kumar","singh","khan","nair","menon","devi","reddy","kumari","das","kim","lee","wang","garcia",
  "smith","jones","mohammed","ali","hassan","jose","maria","raj","dev","tom","babu",
]);

/**
 * Ambiguity detection: a short name, a name made only of generic tokens, or
 * several distinct entities observed for the same name.
 */
export function detectAmbiguity(
  target: IdentityTargetProfile,
  candidate: IdentityCandidate,
): { ambiguous: boolean; reason: string | null } {
  if (target.nameIsAmbiguous) return { ambiguous: true, reason: "Name flagged as common/ambiguous" };
  const tokens = normalizeText(target.name).split(" ").filter(Boolean);
  if (tokens.length < 2) return { ambiguous: true, reason: "Single-token name" };
  if (tokens.every((t) => GENERIC_TOKENS.has(t))) {
    return { ambiguous: true, reason: "Name consists only of common tokens" };
  }
  if ((candidate.competingEntities ?? []).length > 0) {
    return { ambiguous: true, reason: "Multiple distinct entities observed for this name" };
  }
  return { ambiguous: false, reason: null };
}

export function resolveIdentity(
  target: IdentityTargetProfile,
  candidate: IdentityCandidate,
): IdentityResolution {
  const forms = nameForms(target);
  const factors: IdentityFactor[] = [];

  const haystacks = {
    pageText: normalizeText(candidate.pageText),
    title: normalizeText(candidate.title),
    url: normalizeText(candidate.url),
    author: normalizeText(candidate.author),
    snippet: normalizeText([candidate.snippet, candidate.description].filter(Boolean).join(" ")),
  };
  const combined = Object.values(haystacks).join(" ");

  const { ambiguous, reason: ambiguityReason } = detectAmbiguity(target, candidate);

  // --- 1. Name / alias signal (necessary, never sufficient) -----------------
  const fullNameHit = forms.some((form) => form.includes(" ") && combined.includes(form));
  const aliasHit =
    !fullNameHit &&
    (target.aliases ?? [])
      .map((a) => normalizeText(a))
      .filter((a) => a.length >= 4)
      .some((a) => combined.includes(a));
  const nameMatched = fullNameHit || aliasHit;

  if (fullNameHit) {
    factors.push({ key: "name", label: "Matched full name", points: 35, strong: false });
  } else if (aliasHit) {
    factors.push({ key: "alias", label: "Matched known alias", points: 30, strong: false });
  }

  // --- 2. Corroborating signals -------------------------------------------
  const handles = (target.knownHandles ?? [])
    .map((h) => normalizeText(h))
    .filter((h) => h.length >= 3);
  const handleHit = handles.some((h) => haystacks.url.includes(h) || haystacks.author.includes(h));
  if (handleHit) {
    factors.push({ key: "handle", label: "Official/known profile handle", points: 30, strong: true });
  }

  const knownHosts = [hostOf(target.knownWebsite), hostOf(target.knownProfileUrl)].filter(
    (h): h is string => Boolean(h),
  );
  const candidateHost = hostOf(candidate.url);
  const domainHit = Boolean(
    candidateHost && knownHosts.some((h) => candidateHost === h || candidateHost.endsWith(`.${h}`)),
  );
  const domainMentioned = knownHosts.some((h) => combined.includes(normalizeText(h)));
  if (domainHit || domainMentioned) {
    factors.push({
      key: "domain",
      label: domainHit ? "Confirmed website/domain" : "Known domain referenced on page",
      points: domainHit ? 25 : 14,
      strong: domainHit,
    });
  }

  const professionHit = Boolean(
    target.profession && combined.includes(normalizeText(target.profession)),
  );
  const contextHit = /\b(interview|statement|arrest|allegation|case|complaint|film|album|company|ceo|founder|court|police)\b/.test(
    combined,
  );
  if (professionHit) {
    factors.push({
      key: "profession",
      label: contextHit ? "Profession plus matching context" : "Profession referenced",
      points: contextHit ? 22 : 12,
      strong: contextHit,
    });
  }

  const orgHit = Boolean(
    target.organization && combined.includes(normalizeText(target.organization)),
  );
  if (orgHit) {
    factors.push({ key: "organization", label: "Organisation association", points: 22, strong: true });
  }

  const locationHit = Boolean(
    target.countryRegion && combined.includes(normalizeText(target.countryRegion)),
  );
  if (locationHit) {
    const withContext = professionHit || orgHit || contextHit;
    factors.push({
      key: "location",
      label: withContext ? "Known location plus contextual signal" : "Known location referenced",
      points: withContext ? 18 : 8,
      strong: withContext,
    });
  }

  const similarity = typeof candidate.imageSimilarity === "number" ? candidate.imageSimilarity : null;
  if (similarity !== null && similarity >= 80) {
    factors.push({
      key: "image",
      label: `Public reference-image match (${Math.round(similarity)}%)`,
      points: 28,
      strong: true,
    });
  } else if (similarity !== null && similarity >= 60) {
    factors.push({
      key: "image",
      label: `Partial reference-image similarity (${Math.round(similarity)}%)`,
      points: 10,
      strong: false,
    });
  }

  const pageRetrieved = haystacks.pageText.length >= 200;

  // --- 3. Bucketing --------------------------------------------------------
  const strongSignals = factors.filter((f) => f.strong).map((f) => f.label);
  const confidence = Math.min(97, factors.reduce((sum, f) => sum + f.points, 0));

  if (!nameMatched) {
    if (pageRetrieved) {
      return {
        bucket: "UNRELATED",
        confidence: 0,
        factors,
        explanation: "Identity confidence: 0% — page retrieved and contains no name or alias signal",
        strongSignals,
        nameMatched: false,
        ambiguityDetected: ambiguous,
      };
    }
    return {
      bucket: "NEEDS_IDENTITY_REVIEW",
      confidence: Math.min(confidence, 20),
      factors,
      explanation:
        "Identity confidence: " +
        `${Math.min(confidence, 20)}% — no name signal in retrieved metadata; full page not extracted`,
      strongSignals,
      nameMatched: false,
      ambiguityDetected: ambiguous,
    };
  }

  let bucket: IdentityBucket;
  if (strongSignals.length >= 1 && (!ambiguous || strongSignals.length >= 1)) {
    // Ambiguous names need the strong signal to be a hard identifier.
    const hardKeys = ["handle", "domain", "organization", "image"];
    const hasHard = factors.some((f) => f.strong && hardKeys.includes(f.key));
    if (ambiguous && !hasHard) {
      bucket = "NEEDS_IDENTITY_REVIEW";
    } else {
      bucket = "MATCHED";
    }
  } else if (ambiguous) {
    bucket = "NEEDS_IDENTITY_REVIEW";
  } else {
    bucket = "POSSIBLE_MATCH";
  }

  const factorText = factors.map((f) => f.label).join(" + ") || "no corroborating signals";
  const suffix =
    bucket === "MATCHED"
      ? ""
      : bucket === "NEEDS_IDENTITY_REVIEW"
        ? ` · needs identity review${ambiguityReason ? ` (${ambiguityReason})` : ""}`
        : " · name only, no strong corroboration";

  return {
    bucket,
    confidence: bucket === "MATCHED" ? confidence : Math.min(confidence, 79),
    factors,
    explanation: `Identity confidence: ${bucket === "MATCHED" ? confidence : Math.min(confidence, 79)}% — ${factorText}${suffix}`,
    strongSignals,
    nameMatched: true,
    ambiguityDetected: ambiguous,
  };
}

/** Only MATCHED items may contribute to totals or to either risk score. */
export function contributesToTotals(bucket: IdentityBucket): boolean {
  return bucket === "MATCHED";
}

export function needsIdentityQueue(bucket: IdentityBucket): boolean {
  return bucket === "NEEDS_IDENTITY_REVIEW" || bucket === "POSSIBLE_MATCH";
}
