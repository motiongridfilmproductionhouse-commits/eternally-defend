/*
 * Direct HTML fetch fallback for evidence pages.
 *
 * The primary crawler provider can refuse a page (quota exhausted, provider
 * error, blocked host). Client-supplied evidence URLs must still be inspected
 * from the exact final page — never from search snippets — so this module
 * performs a plain HTTPS fetch and shapes the result like a provider scrape
 * payload so the existing verification pipeline stays unchanged.
 */

export type DirectPageData = {
  html?: string;
  rawHtml?: string;
  markdown?: string;
  content?: string;
  images?: string[];
  links?: string[];
  metadata?: Record<string, unknown>;
};

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPageText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    const tag = html.match(pattern)?.[0];
    if (!tag) continue;
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return undefined;
}

function collectAttributeUrls(html: string, attribute: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "gi");
  for (const match of html.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value) found.push(decodeEntities(value));
  }
  return found;
}

/**
 * Fetch a page directly and shape it like a crawler scrape payload.
 * Returns null when the page cannot be retrieved as HTML.
 */
export async function fetchPageDirect(
  url: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<DirectPageData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 20_000);
  const onOuterAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": BROWSER_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return null;

    const html = await response.text();
    if (!html.trim()) return null;

    const pageText = htmlToPageText(html);
    const title =
      metaContent(html, ["og:title", "twitter:title"]) ??
      (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ? decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]!.trim())
        : undefined);

    const images = [
      ...collectAttributeUrls(html, "src"),
      ...collectAttributeUrls(html, "data-src"),
      ...collectAttributeUrls(html, "data-original"),
    ].filter((value) => /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(value));

    return {
      html,
      rawHtml: html,
      markdown: pageText,
      content: pageText,
      images: Array.from(new Set(images)).slice(0, 40),
      links: Array.from(new Set(collectAttributeUrls(html, "href"))).slice(0, 100),
      metadata: {
        ...(title ? { title, ogTitle: title } : {}),
        ...(metaContent(html, ["og:description", "description", "twitter:description"])
          ? {
              description: metaContent(html, [
                "og:description",
                "description",
                "twitter:description",
              ]),
            }
          : {}),
        ...(metaContent(html, ["og:image", "twitter:image"])
          ? { ogImage: metaContent(html, ["og:image", "twitter:image"]) }
          : {}),
        ...(metaContent(html, ["og:video"]) ? { ogVideo: metaContent(html, ["og:video"]) } : {}),
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", onOuterAbort);
  }
}
