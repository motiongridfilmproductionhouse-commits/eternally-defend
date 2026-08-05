export function normalizeBusinessUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.protocol = "https:";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$|mc_|ref$)/i.test(key)) url.searchParams.delete(key);
    url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
    url.pathname = url.pathname.replace(/\/+$|^$/, (match) => (match ? "" : match));
    if (/^(www\.)?youtube\.com$/i.test(url.hostname) && url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      if (id) return `https://youtube.com/watch?v=${id}`;
    }
    if (url.hostname === "youtu.be") return `https://youtube.com/watch?v=${url.pathname.slice(1)}`;
    if (/^(twitter\.com|x\.com)$/i.test(url.hostname)) url.hostname = "x.com";
    return url.toString();
  } catch {
    return null;
  }
}

export function dedupeBusinessResults<T extends { url: string; title?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeBusinessUrl(item.url) || `${item.url}|${item.title || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
