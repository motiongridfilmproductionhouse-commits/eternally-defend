import { createFileRoute } from "@tanstack/react-router";
import {
  assertSafePublicUrlForFetch,
  fetchPublicHttpUrl,
} from "@/lib/deepfake/url-safety.server";

const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const ALLOWED_CT = /^image\//i;

export const Route = createFileRoute("/api/public/image-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const raw = url.searchParams.get("url");
        if (!raw) return new Response("missing url", { status: 400 });

        let target: URL;
        try {
          target = new URL(raw);
        } catch {
          return new Response("invalid url", { status: 400 });
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          return new Response("bad protocol", { status: 400 });
        }

        try {
          await assertSafePublicUrlForFetch(target.toString());
        } catch {
          return new Response("blocked host", { status: 400 });
        }

        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetchPublicHttpUrl(target.toString(), {
            signal: ctl.signal,
            headers: {
              accept: "image/*,*/*;q=0.8",
              "user-agent":
                "Mozilla/5.0 (compatible; EternaCopyrightIntel/1.0; +https://eterna.ai)",
            },
          });
          if (!res.ok) return new Response("upstream error", { status: 502 });
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
              "content-type": ct.split(";")[0] ?? "image/jpeg",
              "cache-control": "public, max-age=3600, s-maxage=86400",
            },
          });
        } catch {
          return new Response("fetch failed", { status: 502 });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
