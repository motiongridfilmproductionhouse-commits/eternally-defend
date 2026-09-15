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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
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

  const search = new URL(SEARCH);
  search.searchParams.set("action", "query");
  search.searchParams.set("list", "search");
  search.searchParams.set("srsearch", cleaned);
  search.searchParams.set("srlimit", "5");
  search.searchParams.set("format", "json");
  search.searchParams.set("origin", "*");

  const found = (await getJson(search.toString(), signal)) as
    | { query?: { search?: { title?: string }[] } }
    | null;
  const titles = (found?.query?.search ?? [])
    .map((r) => (typeof r.title === "string" ? r.title : ""))
    .filter((t) => t && normalize(t).includes(wanted))
    .slice(0, 3);

  for (const title of titles) {
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
