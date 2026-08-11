/**
 * Web Scan — identity confidence scoring (client-safe, pure).
 *
 * Replaces the previous binary "entity matched / dropped" gate. A candidate is
 * never thrown away on the strength of a search snippet alone: uncertain
 * candidates are graded AMBIGUOUS and surfaced as NEEDS_REVIEW.
 *
 * Tiers:
 *   VERIFIED    — full name (or alias) present in page body / title / URL.
 *   PROBABLE    — full name in snippet only, or distinctive-token match in body.
 *   AMBIGUOUS   — weak/partial signal, or no page text retrieved yet.
 *   NOT_SUBJECT — page text WAS retrieved and contains no target signal at all.
 */

export type IdentityTier = "VERIFIED" | "PROBABLE" | "AMBIGUOUS" | "NOT_SUBJECT";

export interface IdentityScoreInput {
  target: string;
  aliases?: Array<string | null | undefined>;
  title?: string | null;
  description?: string | null;
  snippet?: string | null;
  url?: string | null;
  author?: string | null;
  /** Full page text from Crawl4AI / scrape. Absent = extraction not done yet. */
  pageText?: string | null;
}

export interface IdentityScoreResult {
  tier: IdentityTier;
  confidence: number;
  matchedSignals: string[];
  failedSignals: string[];
  reason: string;
}

const GENERIC_TOKENS = new Set([
  "the",
  "and",
  "actor",
  "actress",
  "official",
  "movie",
  "film",
  "video",
  "news",
  "star",
  "kumar",
  "singh",
  "khan",
  "nair",
  "menon",
  "devi",
  "reddy",
  "kumari",
]);

export function normalizeScanText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-/?#&=+.]+/g, " ")
    // Malayalam range kept so native-script names still match.
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[^a-zA-Z0-9\u0D00-\u0D7F ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function nameForms(input: IdentityScoreInput): string[] {
  return Array.from(
    new Set(
      [input.target, ...(input.aliases ?? [])]
        .map((v) => normalizeScanText(v))
        .filter((v) => v.length >= 3),
    ),
  );
}

function distinctiveTokens(forms: string[]): string[] {
  const out = new Set<string>();
  for (const form of forms) {
    for (const token of form.split(" ")) {
      if (token.length >= 4 && !GENERIC_TOKENS.has(token)) out.add(token);
    }
  }
  return Array.from(out);
}

export function scoreIdentity(input: IdentityScoreInput): IdentityScoreResult {
  const forms = nameForms(input);
  if (!forms.length) {
    return {
      tier: "AMBIGUOUS",
      confidence: 0,
      matchedSignals: [],
      failedSignals: ["no_target_configured"],
      reason: "No target name configured",
    };
  }
  const tokens = distinctiveTokens(forms);

  const fields: Array<{ key: string; text: string; strong: number; weak: number }> = [
    { key: "page-body", text: normalizeScanText(input.pageText), strong: 95, weak: 62 },
    { key: "title", text: normalizeScanText(input.title), strong: 90, weak: 56 },
    { key: "url", text: normalizeScanText(input.url), strong: 84, weak: 52 },
    { key: "author", text: normalizeScanText(input.author), strong: 80, weak: 50 },
    { key: "description", text: normalizeScanText(input.description), strong: 72, weak: 46 },
    { key: "snippet", text: normalizeScanText(input.snippet), strong: 70, weak: 44 },
  ].filter((f) => f.text.length > 0);

  const matchedSignals: string[] = [];
  const failedSignals: string[] = [];
  let confidence = 0;
  let strongOn: string[] = [];
  let weakOn: string[] = [];

  for (const field of fields) {
    const fullHit = forms.some((form) => form.includes(" ") && field.text.includes(form));
    const singleHit = !fullHit && forms.some((form) => !form.includes(" ") && field.text.includes(form));
    const tokenHit =
      !fullHit && !singleHit && tokens.some((t) => new RegExp(`\\b${t}\\b`).test(field.text));

    if (fullHit) {
      strongOn.push(field.key);
      matchedSignals.push(`${field.key}:full-name`);
      confidence = Math.max(confidence, field.strong);
    } else if (singleHit || tokenHit) {
      weakOn.push(field.key);
      matchedSignals.push(`${field.key}:partial-name`);
      confidence = Math.max(confidence, field.weak);
    } else {
      failedSignals.push(field.key);
    }
  }

  const pageTextAvailable = Boolean(normalizeScanText(input.pageText).length >= 200);
  const strongInDocument = strongOn.some((k) => k === "page-body" || k === "title" || k === "url");

  if (strongInDocument || (strongOn.length >= 2)) {
    return {
      tier: "VERIFIED",
      confidence: Math.min(97, confidence + (strongOn.length > 1 ? 3 : 0)),
      matchedSignals,
      failedSignals,
      reason: `Target name found in ${strongOn.join(", ")}`,
    };
  }

  if (strongOn.length === 1) {
    return {
      tier: "PROBABLE",
      confidence: Math.max(confidence, 66),
      matchedSignals,
      failedSignals,
      reason: `Target name found in ${strongOn[0]} only`,
    };
  }

  if (weakOn.length) {
    // Partial-name match inside a fully extracted page is a reasonable probable.
    const tier: IdentityTier = pageTextAvailable && weakOn.includes("page-body") ? "PROBABLE" : "AMBIGUOUS";
    return {
      tier,
      confidence: Math.max(confidence, tier === "PROBABLE" ? 60 : 42),
      matchedSignals,
      failedSignals,
      reason: `Partial name signal in ${weakOn.join(", ")}`,
    };
  }

  if (pageTextAvailable) {
    return {
      tier: "NOT_SUBJECT",
      confidence: 0,
      matchedSignals,
      failedSignals,
      reason: "Full page extracted and contains no target name signal",
    };
  }

  return {
    tier: "AMBIGUOUS",
    confidence: 20,
    matchedSignals,
    failedSignals,
    reason: "No target signal in search metadata; full page not extracted yet",
  };
}

/** Candidates that still need a full-page crawl before any decision is safe. */
export function needsFullPageExtraction(result: IdentityScoreResult): boolean {
  return result.tier === "AMBIGUOUS" || result.tier === "PROBABLE";
}
