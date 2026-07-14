import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_CT = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;
const FETCH_TIMEOUT_MS = 6000;

async function fetchImage(url: string): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: ctl.signal,
      headers: {
        // Present as a normal browser so hotlink filters don't block us.
        "user-agent":
          "Mozilla/5.0 (compatible; EternaAI/1.0; +https://eterna.ai)",
        accept: "image/*,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(t);
  }
}

export const Route = createFileRoute("/api/media/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const raw = url.searchParams.get("u");
        if (!raw) return new Response("missing u", { status: 400 });

        let target: URL;
        try {
          target = new URL(raw);
        } catch {
          return new Response("invalid url", { status: 400 });
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          return new Response("bad protocol", { status: 400 });
        }
        // Block loopback / private-range hosts to prevent SSRF-ish misuse.
        const host = target.hostname.toLowerCase();
        if (
          host === "localhost" ||
          host === "0.0.0.0" ||
          host.endsWith(".local") ||
          /^127\./.test(host) ||
          /^10\./.test(host) ||
          /^192\.168\./.test(host) ||
          /^169\.254\./.test(host)
        ) {
          return new Response("blocked host", { status: 400 });
        }

        try {
          const res = await fetchImage(target.toString());
          if (!res.ok) {
            return new Response("upstream error", { status: 502 });
          }
          const ct = res.headers.get("content-type") ?? "";
          if (!ALLOWED_CT.test(ct)) {
            return new Response("not an image", { status: 415 });
          }
          const lenHeader = res.headers.get("content-length");
          if (lenHeader && Number(lenHeader) > MAX_BYTES) {
            return new Response("too large", { status: 413 });
          }
          const buf = await res.arrayBuffer();
          if (buf.byteLength > MAX_BYTES) {
            return new Response("too large", { status: 413 });
          }
          return new Response(buf, {
            status: 200,
            headers: {
              "content-type": ct,
              "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
              "x-preview-source": host,
            },
          });
        } catch {
          return new Response("fetch failed", { status: 502 });
        }
      },
    },
  },
});
