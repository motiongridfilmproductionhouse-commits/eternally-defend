/**
 * Query planning for the targeted YouTube defamation / removal-candidate scan.
 *
 * Pure functions only — safe to import from the client (used to preview the
 * query plan before a scan starts).
 */

export const BASE_MODIFIERS = [
  "",
  "controversy",
  "allegations",
  "exposed",
  "scam",
  "fraud",
  "cheating",
  "complaint",
  "issue",
  "viral",
  "truth",
  "reaction",
  "roast",
  "trolling",
  "leaked",
  "private",
  "fake",
  "deepfake",
  "Malayalam",
  "interview controversy",
  "reaction Malayalam",
  "troll video",
  "gossip",
  "case",
  "police complaint",
  "vulgar",
  "insult",
  "abuse",
] as const;

/** Extra modifiers derived from narratives discovered during the first wave. */
export const NARRATIVE_MODIFIERS = [
  "latest news",
  "reply",
  "response",
  "clarification",
  "apology",
  "live",
  "audio leak",
  "screenshot",
  "morphed",
] as const;

export interface QueryPlanInput {
  targetName: string;
  aliases?: string[];
  extraTerms?: string[];
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Build a deduplicated, ordered discovery query plan. The plain name comes
 * first so the highest-signal results are fetched even if later waves are
 * truncated by quota.
 */
export function buildQueryPlan(input: QueryPlanInput): string[] {
  const names = [input.targetName, ...(input.aliases ?? [])].map(clean).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (q: string) => {
    const value = clean(q);
    const k = value.toLowerCase();
    if (!value || seen.has(k)) return;
    seen.add(k);
    out.push(value);
  };

  for (const modifier of BASE_MODIFIERS) {
    for (const name of names) {
      push(modifier ? `${name} ${modifier}` : name);
    }
  }

  for (const term of input.extraTerms ?? []) {
    push(`${names[0]} ${term}`);
  }

  return out;
}

/** Second-wave queries built from allegations/narratives seen in wave one. */
export function buildNarrativeQueries(targetName: string, narratives: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const narrative of narratives.slice(0, 8)) {
    for (const modifier of NARRATIVE_MODIFIERS.slice(0, 4)) {
      const q = clean(`${targetName} ${narrative} ${modifier}`);
      const k = q.toLowerCase();
      if (q && !seen.has(k)) {
        seen.add(k);
        out.push(q);
      }
    }
  }
  return out;
}

/** Alias/spelling variants used both for search and for identity verification. */
export function nameVariants(targetName: string, aliases: string[] = []): string[] {
  const base = [targetName, ...aliases].map(clean).filter(Boolean);
  const out = new Set<string>();
  for (const name of base) {
    out.add(name);
    out.add(name.toLowerCase());
    out.add(name.replace(/\s+/g, ""));
    const parts = name.split(/\s+/);
    if (parts.length > 1) {
      out.add(parts[0]!);
      out.add(parts[parts.length - 1]!);
      out.add(parts.join("_"));
      out.add(parts.join("-"));
    }
  }
  return Array.from(out).filter((v) => v.length >= 3);
}
