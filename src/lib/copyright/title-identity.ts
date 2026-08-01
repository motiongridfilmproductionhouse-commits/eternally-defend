/**
 * Exact-title identity helpers for Copyright Intelligence.
 *
 * Handles punctuation and compound-token variants so
 * "spiderman brand new day" matches "Spider-Man: Brand New Day"
 * without accepting generic single-token queries.
 */

function normalizeSpaced(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(s: string): string {
  return normalizeSpaced(s).replace(/\s+/g, "");
}

const STOP = new Set(["the", "a", "an", "of", "and", "or", "in", "to", "part"]);

function significantTokens(s: string): string[] {
  return normalizeSpaced(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Expand a work title into spaced, hyphenated and compacted variants.
 * Never emits bare generic single tokens as standalone search titles.
 */
export function expandTitleVariants(title: string): string[] {
  const spaced = normalizeSpaced(title);
  if (spaced.length < 3) return [];

  const out = new Set<string>([spaced]);
  out.add(compact(spaced));
  out.add(spaced.replace(/\s+/g, "-"));

  const tokens = spaced.split(" ");
  // Split only well-known compound suffixes (spiderman → spider man).
  // Do NOT brute-force-split arbitrary long tokens (that mangles "Malayalam").
  const COMPOUND_SUFFIXES = ["man", "woman", "men", "boys", "girls"];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    for (const suffix of COMPOUND_SUFFIXES) {
      if (!tok.endsWith(suffix) || tok.length <= suffix.length + 3) continue;
      const left = tok.slice(0, -suffix.length);
      if (left.length < 3) continue;
      const rebuilt = [...tokens.slice(0, i), left, suffix, ...tokens.slice(i + 1)].join(" ");
      out.add(rebuilt);
      out.add(compact(rebuilt));
      out.add(rebuilt.replace(/\s+/g, "-"));
    }
  }

  // Join only when the next token is a known compound suffix (spider + man).
  if (tokens.length >= 2) {
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i]!;
      const b = tokens[i + 1]!;
      if (a.length >= 3 && COMPOUND_SUFFIXES.includes(b)) {
        const joined = [...tokens.slice(0, i), a + b, ...tokens.slice(i + 2)].join(" ");
        out.add(joined);
        out.add(compact(joined));
      }
    }
  }

  return [...out].filter((v) => v.length >= 3).slice(0, 24);
}

/** Titles safe to quote in discovery queries (spaced / hyphenated forms only). */
export function queryTitleVariants(title: string, altTitles: string[] = []): string[] {
  const seeds = [...new Set([title, ...altTitles].map((t) => t.trim()).filter(Boolean))];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const spaced = normalizeSpaced(seed);
    const hyphen = spaced.replace(/\s+/g, "-");
    for (const v of [seed.trim(), spaced, hyphen, ...expandTitleVariants(seed)]) {
      // Prefer human-readable query forms (with spaces or hyphens), not pure compact.
      if (!/[\s-]/.test(v) && v === compact(v) && significantTokens(seed).length > 1) {
        // Recreate spaced from original seed tokens when compact-only.
        continue;
      }
      const key = normalizeSpaced(v);
      if (key.length < 3 || seen.has(key)) continue;
      // Reject single generic tokens as query titles.
      if (significantTokens(v).length < 2 && compact(v).length < 10) continue;
      seen.add(key);
      out.push(v.includes(" ") || v.includes("-") ? v : spaced);
    }
  }
  return out.slice(0, 8);
}

/** Exact / near-exact work identity on crawled page text. */
export function hasExactTitleIdentity(
  blob: string,
  titles: string[],
  releaseYear?: string | null,
): { match: boolean; evidence: string[] } {
  const evidence: string[] = [];
  const spacedBlob = normalizeSpaced(blob);
  const compactBlob = compact(blob);
  const year = releaseYear?.slice(0, 4) || null;

  for (const raw of titles) {
    const variants = expandTitleVariants(raw);
    for (const v of variants) {
      const spacedV = normalizeSpaced(v);
      const compactV = compact(v);
      // Spaced full-title match (allow short titles like "Soul" / "Nope").
      if (spacedV.length >= 3 && spacedBlob.includes(spacedV)) {
        // Guard single short tokens: require word boundary-ish presence.
        const tokenOk =
          significantTokens(spacedV).length >= 2 ||
          spacedV.length >= 4 ||
          new RegExp(`(?:^|\\s)${spacedV.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(spacedBlob);
        if (tokenOk) {
          evidence.push(`exact_title:${raw}`);
          if (year && (spacedBlob.includes(year) || blob.includes(year))) {
            evidence.push(`release_year:${year}`);
          }
          return { match: true, evidence };
        }
      }
      if (compactV.length >= 6 && compactBlob.includes(compactV)) {
        evidence.push(`exact_title_compact:${raw}`);
        if (year && (spacedBlob.includes(year) || blob.includes(year))) {
          evidence.push(`release_year:${year}`);
        }
        return { match: true, evidence };
      }
    }

    const tokens = significantTokens(raw);
    if (tokens.length >= 2) {
      // Allow compound token matches: title token "spiderman" hits blob "spider"+"man".
      const blobTokens = spacedBlob.split(" ").filter(Boolean);
      const blobCompactRuns = new Set<string>();
      for (let i = 0; i < blobTokens.length; i++) {
        let run = "";
        for (let j = i; j < Math.min(blobTokens.length, i + 3); j++) {
          run += blobTokens[j];
          blobCompactRuns.add(run);
        }
      }
      const hit = tokens.filter(
        (tok) => spacedBlob.includes(tok) || blobCompactRuns.has(tok) || compactBlob.includes(tok),
      ).length;
      if (hit >= Math.ceil(tokens.length * 0.8)) {
        evidence.push(`title_tokens:${raw}`);
        if (year && (spacedBlob.includes(year) || blob.includes(year))) {
          evidence.push(`release_year:${year}`);
        }
        return { match: true, evidence };
      }
    } else if (tokens.length === 1 && tokens[0]!.length >= 4) {
      const tok = tokens[0]!;
      if (new RegExp(`(?:^|\\s)${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(spacedBlob)) {
        evidence.push(`exact_title:${raw}`);
        if (year && (spacedBlob.includes(year) || blob.includes(year))) {
          evidence.push(`release_year:${year}`);
        }
        return { match: true, evidence };
      }
    }
  }
  return { match: false, evidence };
}

export function titleSlugCandidates(title: string): string[] {
  return expandTitleVariants(title).map((v) =>
    normalizeSpaced(v).replace(/\s+/g, "-"),
  );
}
