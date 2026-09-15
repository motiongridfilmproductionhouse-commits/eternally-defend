/**
 * Public portrait lookup for an assessment subject.
 *
 * Read-only: uses the keyless Wikipedia REST summary API and accepts an image
 * only when it is served from a Wikimedia host over HTTPS and the article title
 * plausibly matches the requested name. The picture is presentation-only — it is
 * never used as evidence, never influences pricing, and never triggers any
 * enforcement path. Any failure returns null; a portrait is never required.
 */

const SEARCH = "https://en.wikipedia.org/w/api.php";
const SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const TIMEOUT_MS = 8_000;
const ALLOWED_IMAGE_HOSTS = /(^|\.)(wikimedia\.org|wikipedia\.org)$/i;

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function safeImage(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    if (!ALLOWED_IMAGE_HOSTS.test(u.hostname)) return null;
    if (u.href.length > 1024) return null;
    return u.href;
  } catch {
    return null;
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  const { fetchJsonWithTimeout } = await import("../scan/discovery/provider");
  try {
    const res = await fetchJsonWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          // Wikimedia requires a descriptive User-Agent; anonymous requests are rejected.
          "user-agent": "EternaSentinel/1.0 (public reference image lookup)",
        },
      },
      TIMEOUT_MS,
      signal,
    );
    if (res.status !== 200) {
      console.error("[agent:portrait] http", res.status, res.text.slice(0, 200));
      return null;
    }
    return JSON.parse(res.text) as unknown;
  } catch (e) {
    console.error("[agent:portrait] fetch failed", e instanceof Error ? e.message : e);
    return null;
  }
}


/** Best-effort public picture for a name. Returns null when nothing safe is found. */
export async function fetchArtistPortrait(
  name: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const cleaned = name.replace(/["\\]/g, " ").trim();
  if (cleaned.length < 2) return null;
  const wanted = normalize(cleaned);

  // Single keyless Action API call: search for the name and read page images.
  const search = new URL(SEARCH);
  search.searchParams.set("action", "query");
  search.searchParams.set("generator", "search");
  search.searchParams.set("gsrsearch", cleaned);
  search.searchParams.set("gsrlimit", "5");
  search.searchParams.set("prop", "pageimages");
  search.searchParams.set("piprop", "original|thumbnail");
  search.searchParams.set("pithumbsize", "1000");
  search.searchParams.set("format", "json");
  search.searchParams.set("origin", "*");

  const found = (await getJson(search.toString(), signal)) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; original?: { source?: string }; thumbnail?: { source?: string } }
      >;
    };
  } | null;

  const pages = Object.values(found?.query?.pages ?? {});
  for (const page of pages) {
    const title = typeof page.title === "string" ? page.title : "";
    if (!title || !normalize(title).includes(wanted)) continue;
    const image = safeImage(page.original?.source) ?? safeImage(page.thumbnail?.source);
    if (image) return image;
  }

  // Fallback: REST summary for the best-matching title.
  for (const page of pages) {
    const title = typeof page.title === "string" ? page.title : "";
    if (!title || !normalize(title).includes(wanted)) continue;
    const summary = (await getJson(
      SUMMARY + encodeURIComponent(title.replace(/ /g, "_")),
      signal,
    )) as { originalimage?: { source?: string }; thumbnail?: { source?: string } } | null;
    const image =
      safeImage(summary?.originalimage?.source) ?? safeImage(summary?.thumbnail?.source);
    if (image) return image;
  }
  return null;
}

