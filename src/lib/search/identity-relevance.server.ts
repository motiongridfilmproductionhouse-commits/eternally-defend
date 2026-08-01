/**
 * Post-provider identity relevance validation.
 * Rejects generic first-name-only matches unless strong context also matches.
 */

import { normalizeKey } from "./identity-knowledge.server";
import type { IdentityRelevance, SearchExpansionResult } from "./identity-types";

const CONFLICT_CELEBRITIES = [
  "Manju Warrier",
  "Manju Pillai",
  "Manju Pathrose",
];

function tokenCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function scoreIdentityRelevance(opts: {
  expansion: SearchExpansionResult;
  title?: string | null;
  snippet?: string | null;
  url?: string | null;
  faceSimilarity?: number | null;
}): IdentityRelevance {
  const blob = normalizeKey(
    `${opts.title ?? ""} ${opts.snippet ?? ""} ${opts.url ?? ""}`,
  );
  const matchedTerms: string[] = [];
  let score = 0;

  const strongFace =
    typeof opts.faceSimilarity === "number" && opts.faceSimilarity >= 0.85;

  // Face similarity can establish identity even when crawl text is empty.
  if (strongFace) {
    matchedTerms.push("reference_face");
    score += 0.4;
  }

  if (!blob && score < 0.35) {
    return {
      matchedIdentity: false,
      confidence: score,
      matchedTerms,
      quarantine: true,
      reason: "Empty result text and no strong face match — quarantined pending review.",
    };
  }

  const push = (term: string, weight: number, label: string) => {
    const n = normalizeKey(term);
    if (n.length >= 3 && blob.includes(n)) {
      matchedTerms.push(label);
      score += weight;
    }
  };

  if (opts.expansion.canonicalName) {
    push(opts.expansion.canonicalName, 0.45, `canonical:${opts.expansion.canonicalName}`);
  }

  // Unresolved / fail-open expansions often leave aliases empty — still score
  // the original and corrected query forms the user actually searched.
  if (tokenCount(opts.expansion.originalQuery) >= 2) {
    push(opts.expansion.originalQuery, 0.4, `query:${opts.expansion.originalQuery}`);
  }
  if (
    opts.expansion.correctedQuery &&
    normalizeKey(opts.expansion.correctedQuery) !==
      normalizeKey(opts.expansion.originalQuery) &&
    tokenCount(opts.expansion.correctedQuery) >= 2
  ) {
    push(
      opts.expansion.correctedQuery,
      0.4,
      `corrected:${opts.expansion.correctedQuery}`,
    );
  }

  for (const alias of opts.expansion.aliases.slice(0, 12)) {
    const weight = tokenCount(alias) >= 2 ? 0.4 : 0.2;
    push(alias, weight, `alias:${alias}`);
  }
  for (const local of opts.expansion.localLanguageNames.slice(0, 6)) {
    if (opts.title?.includes(local) || opts.snippet?.includes(local)) {
      matchedTerms.push(`local:${local}`);
      score += 0.35;
    }
  }
  for (const show of opts.expansion.relatedShows) {
    push(show, 0.25, `show:${show}`);
  }
  for (const film of opts.expansion.relatedFilms) {
    push(film, 0.25, `film:${film}`);
  }
  for (const ch of opts.expansion.characterNames) {
    push(ch, 0.2, `character:${ch}`);
  }
  for (const handle of opts.expansion.usernames) {
    const h = handle.replace(/^@/, "");
    push(h, 0.35, `handle:${h}`);
  }

  // Generic first-name-only trap: e.g. "Manju" without Pathrose/Aliyans/Thankam.
  // Use word boundaries so handles like "manjupathrose" are not treated as "Manju".
  const first =
    opts.expansion.canonicalName?.split(/\s+/)[0] ??
    opts.expansion.originalQuery.split(/\s+/)[0] ??
    "";
  const firstToken = normalizeKey(first);
  const firstWordRe =
    firstToken.length >= 3
      ? new RegExp(`(?:^|\\s)${firstToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`)
      : null;
  const strongIdentityHit = matchedTerms.some(
    (t) =>
      t.startsWith("canonical:") ||
      t.startsWith("alias:") ||
      t.startsWith("query:") ||
      t.startsWith("corrected:") ||
      t.startsWith("show:") ||
      t.startsWith("character:") ||
      t.startsWith("local:") ||
      t.startsWith("handle:") ||
      t === "reference_face",
  );
  const firstOnly = Boolean(firstWordRe?.test(blob) && !strongIdentityHit);

  let conflictingIdentity: string | undefined;
  for (const other of CONFLICT_CELEBRITIES) {
    if (
      opts.expansion.canonicalName &&
      normalizeKey(other) !== normalizeKey(opts.expansion.canonicalName) &&
      blob.includes(normalizeKey(other))
    ) {
      // Strong conflict when another full celebrity name appears and our
      // canonical/show context is absent.
      if (!matchedTerms.some((t) => t.startsWith("canonical:") || t.startsWith("show:"))) {
        conflictingIdentity = other;
        score -= 0.35;
      }
    }
  }

  const confidence = Math.max(0, Math.min(0.99, score));
  const ambiguous = Boolean(opts.expansion.ambiguous);
  const fallback = Boolean(opts.expansion.diagnostics?.fallback);
  // Only fail-open recovery may use strong face evidence to clear ambiguity.
  // True multi-candidate ambiguity stays quarantined until reviewer confirmation.
  const faceRecoversAmbiguity = strongFace && fallback;
  const quarantine =
    firstOnly ||
    Boolean(conflictingIdentity) ||
    confidence < 0.35 ||
    (ambiguous && !faceRecoversAmbiguity);
  const matchedIdentity = confidence >= 0.35 && !quarantine;

  return {
    matchedIdentity,
    confidence,
    matchedTerms,
    conflictingIdentity,
    quarantine,
    reason: quarantine
      ? ambiguous && !faceRecoversAmbiguity
        ? "Identity resolution is ambiguous — results remain unverified until confirmed."
        : conflictingIdentity
          ? `Possible conflicting identity (${conflictingIdentity}) — do not auto-attach.`
          : firstOnly
            ? "Only a generic first-name match — quarantined."
            : "Identity relevance below threshold — quarantined pending review."
      : "Identity signals support attaching this lead for review.",
  };
}
