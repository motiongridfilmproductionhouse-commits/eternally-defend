import type { ErrorComponentProps } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { SeoHeadContent } from "@/components/SeoHeadContent";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/lib/seo/head-defaults";
import appCss from "../styles.css?url";
import appUtilitiesCss from "../app.css?url";
import { isPublicPath } from "@/lib/seo/public-paths";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent(props: ErrorComponentProps) {
  const error = props.error as Error;
  const reset = props.reset;
  const router = useRouter();
  useEffect(() => {
    const errorName = error?.name || "Error";
    const message = error?.message || "Unknown error";
    const stack = error?.stack || "";
    const currentRoute = typeof window !== "undefined" ? window.location.pathname : "/";
    console.error(
      `[ETERNA_ROUTE_CRASH]\nroute=${currentRoute}\nrequestId=req_${Date.now()}\nerrorName=${errorName}\nsanitizedMessage=${message}\nserverStack=${stack}`,
    );
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: DEFAULT_TITLE },
      { name: "description", content: DEFAULT_DESCRIPTION },
      { name: "theme-color", content: "#f7f6f1" },
      { name: "application-name", content: "Eterna Sentinel" },
      // Open Graph / Twitter: og:title, og:description, twitter:* and the
      // default og:image are derived per route by SeoHeadContent from each
      // route's own title/description, so no stale sitewide copy leaks.
      { property: "og:site_name", content: "Eterna Sentinel" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Cache-busted favicon — version param forces browsers to reload immediately after deployment
      { rel: "icon", href: "/favicon.png?v=3", type: "image/png" },
      { rel: "icon", href: "/eterna-icon-32.png?v=3", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/eterna-icon-16.png?v=3", type: "image/png", sizes: "16x16" },
      { rel: "apple-touch-icon", href: "/eterna-icon-180.png?v=3", sizes: "180x180" },
      { rel: "manifest", href: "/site.webmanifest" },
      // Self-hosted Latin variable fonts (declared in styles.css); only the
      // body face is preloaded so first paint isn't blocked on other weights.
      {
        rel: "preload",
        href: "/fonts/inter-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <SeoHeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useLocation({ select: (l) => l.pathname });

  return (
    <QueryClientProvider client={queryClient}>
      {/* Signed-in app screens need the full utility set; public pages skip it
          so their only render-blocking stylesheet stays small. React hoists
          this into <head> after styles.css (same precedence group). */}
      {isPublicPath(pathname) ? null : (
        <link rel="stylesheet" href={appUtilitiesCss} precedence="default" />
      )}
      <Outlet />
      {/* Single global toast layer — without it every toast.success/error is silent. */}
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
