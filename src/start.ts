import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Permanent (301) canonical redirects: www -> apex and trailing slash -> none.
const canonicalRedirectMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (request.method === "GET" || request.method === "HEAD") {
    let changed = false;
    if (url.hostname === "www.protectbyeterna.com") {
      url.hostname = "protectbyeterna.com";
      changed = true;
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/") && !url.pathname.startsWith("/api/")) {
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      changed = true;
    }
    if (changed) {
      const sameHost = url.hostname === new URL(request.url).hostname;
      const location = sameHost ? `${url.pathname}${url.search}` : url.toString();
      throw new Response(null, { status: 301, headers: { location } });
    }
  }
  return next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [canonicalRedirectMiddleware, errorMiddleware],
}));
