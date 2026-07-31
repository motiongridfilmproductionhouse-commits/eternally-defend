const TRACKING_PARAM =
  /^(?:utm_|fbclid$|gclid$|ref$|source$|si$|feature$|mc_cid$|mc_eid$|igshid$|yclid$|msclkid$)/i;

export function buildExecutedQueryPlan(input: {
  importedQueries: string[];
  generatedQueries: string[];
  maxQueries: number;
}): string[] {
  const maxQueries = Math.max(1, input.maxQueries);
  const seen = new Set<string>();
  const output: string[] = [];

  for (const query of [
    ...input.importedQueries,
    ...input.generatedQueries,
  ]) {
    const trimmed = query.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(trimmed);

    if (output.length >= maxQueries) {
      break;
    }
  }

  return output;
}

export function normalizeDiscoveredUrlForDedupe(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.searchParams.sort();

    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    }

    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function discoveredCandidateKey(hit: {
  url?: string;
  image_url?: string;
  thumbnail_url?: string;
}): string {
  return [
    hit.url ? normalizeDiscoveredUrlForDedupe(hit.url) : "",
    hit.image_url ? normalizeDiscoveredUrlForDedupe(hit.image_url) : "",
    hit.thumbnail_url
      ? normalizeDiscoveredUrlForDedupe(hit.thumbnail_url)
      : "",
  ].join("|");
}
