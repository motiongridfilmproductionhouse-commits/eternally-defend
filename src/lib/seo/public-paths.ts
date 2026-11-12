/**
 * Public marketing paths. These pages render with only the light, render-
 * blocking styles.css; every other path also gets the full app stylesheet.
 * Newsroom articles are matched by prefix. Keep in sync with the sitemap
 * (enforced by public-paths.test.ts).
 */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/how-it-works",
  "/request-protection",
  "/enterprise-protection",
  "/incident-response",
  "/monitoring",
  "/public-figure-protection",
  "/about",
  "/eterna-ai",
  "/deepfake-protection",
  "/ai-impersonation",
  "/online-reputation-protection",
  "/security",
  "/methodology",
  "/identity-response-observatory",
  "/research",
  "/newsroom",
  "/image-immunization",
  "/student-digital-safety",
  "/contact",
  "/partner-apply",
  "/privacy",
  "/terms",
  "/cookies",
  "/acceptable-use",
  "/remove-content",
  "/fake-account-removal",
  "/newsroom",
  "/track-case",
  "/impersonation-protection",
]);

export function isPublicPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PATHS.has(p) || p.startsWith("/newsroom/");
}
