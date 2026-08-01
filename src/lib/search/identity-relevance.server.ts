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
  if (!blob) {
    return {
      matchedIdentity: false,
      confidence: 0,
      matchedTerms: [],
      quarantine: true,
      reason: "Empty result text — quarantined pending review.",
    };
  }

  const matchedTerms: string[] = [];
  let score = 0;

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
  for (const alias of opts.expansion.aliases.slice(0, 12)) {
    push(alias, 0.3, `alias:${alias}`);
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

  if (typeof opts.faceSimilarity === "number" && opts.faceSimilarity >= 0.85) {
    matchedTerms.push("reference_face");
    score += 0.4;
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
  const quarantine = firstOnly || Boolean(conflictingIdentity) || confidence < 0.35;
  const matchedIdentity = confidence >= 0.35 && !quarantine;

  return {
    matchedIdentity,
    confidence,
    matchedTerms,
    conflictingIdentity,
    quarantine,
    reason: quarantine
      ? conflictingIdentity
        ? `Possible conflicting identity (${conflictingIdentity}) — do not auto-attach.`
        : firstOnly
          ? "Only a generic first-name match — quarantined."
          : "Identity relevance below threshold — quarantined pending review."
      : "Identity signals support attaching this lead for review.",
  };
}
