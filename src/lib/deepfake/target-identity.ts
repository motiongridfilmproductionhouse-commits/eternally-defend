/**
 * Deepfake Intelligence — strict target-identity verification gate.
 *
 * Zero false-positive mode. A discovery lead may only become a client-visible
 * deepfake finding when BOTH gates pass:
 *   Gate 1 — the evidence itself (title / URL / page text / alt text / face
 *            match) identifies the scan target.
 *   Gate 2 — the evidence indicates target-specific synthetic or explicit
 *            misuse.
 *
 * The search query is NEVER identity evidence. "bhama kurup deepfake telegram"
 * returning a general Telegram-deepfake news article is NOT_SUBJECT.
 *
 * Pure + client-safe: no imports, usable in server pipelines and UI gating.
 */

export type IdentityStatus = "VERIFIED" | "PROBABLE" | "NOT_VERIFIED";

export type TargetThreatDecision =
  | "VERIFIED_TARGET_THREAT"
  | "PROBABLE_TARGET_THREAT"
  | "NOT_SUBJECT"
  | "NOT_DEEPFAKE_THREAT";

export interface TargetIdentityInput {
  /** Canonical target name, e.g. "Bhama Kurup". */
  target: string;
  /** Registered aliases / known name variants. */
  aliases?: Array<string | null | undefined>;
  title?: string | null;
  url?: string | null;
  snippet?: string | null;
  pageText?: string | null;
  altText?: string | null;
  /** Rekognition-style face similarity 0..100 for the target collection. */
  faceSimilarity?: number | null;
  targetFaceMatch?: boolean | null;
}

export interface TargetIdentityResult {
  status: IdentityStatus;
  confidence: number;
  evidence: string[];
  rejectionReason: string | null;
}

const GENERIC_TOKENS = new Set([
  "the",
  "and",
  "actor",
  "actress",
  "official",
  "movie",
  "video",
  "photo",
  "photos",
  "images",
  "news",
  "deepfake",
  "deepfakes",
  "nude",
  "nudes",
  "porn",
  "sex",
  "ai",
  "fake",
  "leaked",
  "viral",
  "star",
  "kumar",
  "singh",
  "khan",
  "devi",
  "reddy",
  "kumari",
]);

/**
 * Phrases that mark a page as coverage of the deepfake phenomenon in general
 * (policy, courts, platform statements, other jurisdictions/victims).
 */
const GENERIC_PHENOMENON_PATTERNS: RegExp[] = [
  /\bdeepfake (?:porn )?(?:scandal|crisis|epidemic|law|laws|bill|rules|ban|regulation)\b/,
  /\b(?:high court|hc|supreme court|court) (?:asks|seeks|orders|directs|tells)\b/,
  /\bapolog(?:y|ise|ize|ised|ized|ises|izes)\b/,
  /\b(?:government|govt|ministry|parliament|senate|eu|police) (?:asks|seeks|plans|orders|probe|investigat)/,
  /\bdeepfake bots?\b/,
  /\bwhat (?:is|are) (?:a )?deepfakes?\b/,
  /\bhow to (?:spot|detect|make) (?:a )?deepfakes?\b/,
  /\brise (?:of|in) deepfakes?\b/,
  /\bdeepfake (?:detection|awareness|explainer)\b/,
];

export function normalizeIdentityText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameVariants(input: TargetIdentityInput): string[] {
  const all = [input.target, ...(input.aliases ?? [])]
    .map((value) => normalizeIdentityText(value))
    .filter((value) => value.length >= 3);
  return Array.from(new Set(all));
}

function distinctiveTokens(names: string[]): string[] {
  const tokens = new Set<string>();
  for (const name of names) {
    for (const token of name.split(" ")) {
      if (token.length >= 5 && !GENERIC_TOKENS.has(token)) tokens.add(token);
    }
  }
  return Array.from(tokens);
}

function urlText(url: string | null | undefined): string {
  if (!url) return "";
  return normalizeIdentityText(
    String(url)
      .replace(/^https?:\/\//i, "")
      .replace(/[/?#&=+._-]+/g, " "),
  );
}

function isGenericPhenomenonPage(text: string): boolean {
  return GENERIC_PHENOMENON_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Gate 1 — decide whether the evidence itself identifies the scan target.
 * Discovery query provenance is intentionally not accepted as evidence.
 */
export function verifyTargetIdentity(input: TargetIdentityInput): TargetIdentityResult {
  const names = nameVariants(input);
  if (!names.length) {
    return {
      status: "NOT_VERIFIED",
      confidence: 0,
      evidence: [],
      rejectionReason: "no_target_name_configured",
    };
  }

  const fields: Array<{ key: string; text: string; weight: number }> = [
    { key: "identity:title", text: normalizeIdentityText(input.title), weight: 92 },
    { key: "identity:page-body", text: normalizeIdentityText(input.pageText), weight: 95 },
    { key: "identity:alt-text", text: normalizeIdentityText(input.altText), weight: 85 },
    { key: "identity:url", text: urlText(input.url), weight: 82 },
    { key: "identity:snippet", text: normalizeIdentityText(input.snippet), weight: 70 },
  ].filter((field) => field.text.length > 0);

  const evidence: string[] = [];
  let confidence = 0;
  let fullNameMatch = false;

  for (const field of fields) {
    if (names.some((name) => name.includes(" ") && field.text.includes(name))) {
      fullNameMatch = true;
      evidence.push(field.key);
      confidence = Math.max(confidence, field.weight);
    }
  }

  const tokens = distinctiveTokens(names);
  let weakTokenMatch = false;
  if (!fullNameMatch && tokens.length) {
    for (const field of fields) {
      if (tokens.some((token) => new RegExp(`\\b${token}\\b`).test(field.text))) {
        weakTokenMatch = true;
        evidence.push(`${field.key}:partial-name`);
        confidence = Math.max(confidence, Math.min(58, field.weight - 30));
      }
    }
  }

  const faceSimilarity = Number(input.faceSimilarity ?? 0) || 0;
  const faceConfirmed = Boolean(input.targetFaceMatch) && faceSimilarity >= 85;
  if (faceConfirmed) {
    evidence.push("identity:face-match");
    confidence = Math.max(confidence, Math.min(97, faceSimilarity));
  }

  const combined = [
    normalizeIdentityText(input.title),
    normalizeIdentityText(input.snippet),
    normalizeIdentityText(input.pageText),
  ].join(" ");
  const genericNews = isGenericPhenomenonPage(combined);

  // Generic deepfake coverage can never be carried by a weak single-name hit.
  if (genericNews && !fullNameMatch && !faceConfirmed) {
    return {
      status: "NOT_VERIFIED",
      confidence: 0,
      evidence: [...evidence, "reject:generic-deepfake-coverage"],
      rejectionReason: "generic_deepfake_coverage_without_target_identity",
    };
  }

  if (fullNameMatch) {
    const strong =
      confidence >= 90 ||
      faceConfirmed ||
      evidence.filter((item) => !item.endsWith(":partial-name")).length >= 2;
    return {
      status: strong ? "VERIFIED" : "PROBABLE",
      confidence,
      evidence,
      rejectionReason: null,
    };
  }

  if (faceConfirmed) {
    return { status: "PROBABLE", confidence, evidence, rejectionReason: null };
  }

  if (weakTokenMatch) {
    return {
      status: "PROBABLE",
      confidence,
      evidence,
      rejectionReason: null,
    };
  }

  return {
    status: "NOT_VERIFIED",
    confidence: 0,
    evidence,
    rejectionReason: "target_identity_not_evidenced_on_page",
  };
}

export interface TargetContentSignals {
  /** Explicit / intimate material evidenced on the page or media. */
  explicitConfirmed?: boolean | null;
  /** Synthetic / AI-generated / face-swap evidence. */
  syntheticConfirmed?: boolean | null;
  /** Page distributes, hosts, indexes, advertises or sells the material. */
  hostingConfirmed?: boolean | null;
  syntheticConfidence?: number | null;
}

/** Gate 2 + mandatory decision matrix. */
export function decideTargetThreat(
  identity: TargetIdentityResult,
  content: TargetContentSignals,
): TargetThreatDecision {
  const syntheticScore = Number(content.syntheticConfidence ?? 0) || 0;
  const syntheticVerified = Boolean(content.syntheticConfirmed) && syntheticScore >= 70;
  const syntheticProbable =
    Boolean(content.syntheticConfirmed) || Boolean(content.explicitConfirmed) || syntheticScore >= 50;

  if (identity.status === "NOT_VERIFIED") return "NOT_SUBJECT";
  if (!syntheticProbable) return "NOT_DEEPFAKE_THREAT";

  if (
    identity.status === "VERIFIED" &&
    syntheticVerified &&
    Boolean(content.explicitConfirmed) &&
    Boolean(content.hostingConfirmed)
  ) {
    return "VERIFIED_TARGET_THREAT";
  }

  return "PROBABLE_TARGET_THREAT";
}

/** Findings that may be shown to the client. */
export function isClientVisibleDecision(decision: TargetThreatDecision): boolean {
  return decision === "VERIFIED_TARGET_THREAT" || decision === "PROBABLE_TARGET_THREAT";
}

/** Map the decision to the persisted `finding_classification` taxonomy. */
export function decisionToFindingClassification(decision: TargetThreatDecision): string {
  switch (decision) {
    case "VERIFIED_TARGET_THREAT":
      return "VERIFIED_DEEPFAKE";
    case "PROBABLE_TARGET_THREAT":
      return "PROBABLE_DEEPFAKE";
    case "NOT_DEEPFAKE_THREAT":
      return "ADULT_NAME_MENTION";
    default:
      return "NOT_SUBJECT";
  }
}
