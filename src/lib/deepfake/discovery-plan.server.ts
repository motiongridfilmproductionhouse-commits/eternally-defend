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
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return url.trim();
    }

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

export type DiscoveryCandidateInput = {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  query?: string | null;
  source?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  is_sensitive?: boolean;
};

export type MergedDiscoveryCandidate = {
  url: string;
  title?: string;
  description?: string;
  query: string;
  source?: string;
  image_url?: string;
  thumbnail_url?: string;
  is_sensitive?: boolean;
  query_provenance: string[];
  source_provenance: string[];
  title_provenance: string[];
  description_provenance: string[];
  image_url_provenance: string[];
  thumbnail_url_provenance: string[];
};

function trimNonEmpty(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizedHttpUrl(value?: string | null): string | null {
  const trimmed = trimNonEmpty(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  return normalizeDiscoveredUrlForDedupe(trimmed);
}

function isLikelyDirectMediaUrl(parsed: URL): boolean {
  return /\.(?:avif|bmp|gif|jpe?g|m3u8|m4v|mkv|mov|mp4|png|svg|webm|webp)$/i.test(
    parsed.pathname,
  );
}

function normalizedPageUrl(value?: string | null): string | null {
  const trimmed = trimNonEmpty(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !isLikelyDirectMediaUrl(parsed)
    ) {
      return normalizeDiscoveredUrlForDedupe(trimmed);
    }
  } catch {
    return null;
  }

  return null;
}

function originalHttpUrl(
  value?: string | null,
  options?: { allowDirectMedia?: boolean },
): string | null {
  const trimmed = trimNonEmpty(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (options?.allowDirectMedia || !isLikelyDirectMediaUrl(parsed))
    ) {
      return trimmed;
    }
  } catch {
    return null;
  }

  return null;
}

function addUnique(values: string[], value?: string | null): void {
  const trimmed = trimNonEmpty(value);
  if (trimmed && !values.includes(trimmed)) {
    values.push(trimmed);
  }
}

function strongestText(
  current: string | undefined,
  next?: string | null,
): string | undefined {
  const trimmed = trimNonEmpty(next);
  if (!trimmed) return current;
  if (!current) return trimmed;
  return trimmed.length > current.length ? trimmed : current;
}

function joinProvenance(values: string[]): string | undefined {
  return values.length ? values.join(" | ") : undefined;
}

export function discoveredCandidateKey(hit: {
  url?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
}): string {
  const pageUrl = normalizedPageUrl(hit.url);
  if (pageUrl) {
    return `page:${pageUrl}`;
  }

  const mediaUrl =
    normalizedHttpUrl(hit.url) ??
    normalizedHttpUrl(hit.image_url) ??
    normalizedHttpUrl(hit.thumbnail_url);

  if (mediaUrl) {
    return `media:${mediaUrl}`;
  }

  return "";
}

export function mergeDiscoveredCandidates(
  hits: DiscoveryCandidateInput[],
  options?: { defaultQuery?: string },
): MergedDiscoveryCandidate[] {
  const defaultQuery = trimNonEmpty(options?.defaultQuery) ?? "discovery";
  const merged = new Map<string, MergedDiscoveryCandidate>();

  for (const hit of hits) {
    const key = discoveredCandidateKey(hit);
    if (!key) continue;

    const pageUrl = originalHttpUrl(hit.url);
    const fallbackMediaUrl =
      originalHttpUrl(hit.url, { allowDirectMedia: true }) ??
      originalHttpUrl(hit.image_url, { allowDirectMedia: true }) ??
      originalHttpUrl(hit.thumbnail_url, { allowDirectMedia: true });
    const crawlUrl = pageUrl ?? fallbackMediaUrl;
    if (!crawlUrl) continue;

    const existing = merged.get(key);

    if (!existing) {
      const query = trimNonEmpty(hit.query) ?? defaultQuery;
      const title = trimNonEmpty(hit.title) ?? undefined;
      const description = trimNonEmpty(hit.description) ?? undefined;
      const source = trimNonEmpty(hit.source) ?? undefined;
      const imageUrl =
        originalHttpUrl(hit.image_url, { allowDirectMedia: true }) ??
        undefined;
      const thumbnailUrl =
        originalHttpUrl(hit.thumbnail_url, { allowDirectMedia: true }) ??
        undefined;

      merged.set(key, {
        url: crawlUrl,
        title,
        description,
        query,
        source,
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        is_sensitive: hit.is_sensitive,
        query_provenance: [query],
        source_provenance: source ? [source] : [],
        title_provenance: title ? [title] : [],
        description_provenance: description ? [description] : [],
        image_url_provenance: imageUrl ? [imageUrl] : [],
        thumbnail_url_provenance: thumbnailUrl ? [thumbnailUrl] : [],
      });
      continue;
    }

    addUnique(existing.query_provenance, hit.query ?? defaultQuery);
    addUnique(existing.source_provenance, hit.source);
    addUnique(existing.title_provenance, hit.title);
    addUnique(existing.description_provenance, hit.description);
    addUnique(existing.image_url_provenance, hit.image_url);
    addUnique(existing.thumbnail_url_provenance, hit.thumbnail_url);

    existing.title = strongestText(existing.title, hit.title);
    existing.description = strongestText(
      existing.description,
      hit.description,
    );
    existing.query =
      joinProvenance(existing.query_provenance) ?? defaultQuery;
    existing.source = joinProvenance(existing.source_provenance);
    existing.image_url =
      existing.image_url ??
      originalHttpUrl(hit.image_url, { allowDirectMedia: true }) ??
      undefined;
    existing.thumbnail_url =
      existing.thumbnail_url ??
      originalHttpUrl(hit.thumbnail_url, { allowDirectMedia: true }) ??
      undefined;
    existing.is_sensitive =
      Boolean(existing.is_sensitive) || Boolean(hit.is_sensitive);
  }

  return Array.from(merged.values());
}
