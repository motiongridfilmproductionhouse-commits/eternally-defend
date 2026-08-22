// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function stripReactStartRouteTreeRegistration() {
  const routeTreePath = resolve("src/routeTree.gen.ts");
  const footerPattern =
    /\nimport type \{ getRouter \} from '\.\/router\.tsx'\nimport type \{ startInstance \} from '\.\/start\.ts'\ndeclare module '@tanstack\/react-start' \{\n  interface Register \{\n    ssr: true\n    router: Awaited<ReturnType<typeof getRouter>>\n    config: Awaited<ReturnType<typeof startInstance\.getOptions>>\n  \}\n\}\n?$/;

  return {
    name: "eterna:strip-react-start-route-tree-registration",
    closeBundle() {
      const current = readFileSync(routeTreePath, "utf8");
      const next = current.replace(footerPattern, "\n");

      if (next !== current) {
        writeFileSync(routeTreePath, next);
      }
    },
  };
}

/**
 * AWS Amplify Face Liveness is a browser-only widget (camera + WebRTC) and runs
 * module-scope `setTimeout` during framework detection, which Cloudflare Workers
 * forbid in global scope. Bundling it server-side crashed every SSR request, so
 * the server graph gets an inert stub; the browser still loads the real module.
 */
function stubFaceLivenessOnServer() {
  const ID = "@aws-amplify/ui-react-liveness";
  const VIRTUAL = "\0virtual:eterna-liveness-server-stub";

  const isServerEnv = (self: { environment?: { name?: string } }, ssr?: boolean) =>
    ssr === true || (self.environment?.name ?? "") !== "client";

  return {
    name: "eterna:stub-face-liveness-on-server",
    enforce: "pre" as const,
    resolveId(this: any, source: string, _importer: string | undefined, options: any) {
      if (source !== ID) return null;
      return isServerEnv(this, options?.ssr) ? VIRTUAL : null;
    },
    load(id: string) {
      if (id !== VIRTUAL) return null;
      return [
        "export const FaceLivenessDetectorCore = () => null;",
        "export const FaceLivenessDetector = () => null;",
        "export default { FaceLivenessDetectorCore, FaceLivenessDetector };",
      ].join("\n");
    },
  };
}

export default defineConfig({

  vite: {
    build: {
      sourcemap: false,
    },
  },

  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  plugins: [stripReactStartRouteTreeRegistration(), stubFaceLivenessOnServer()],
});
