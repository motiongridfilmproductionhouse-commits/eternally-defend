import { defineConfig } from "vitest/config";

// Without an explicit config, Vite/Vitest search upward from this directory
// and pick up the monorepo root's vite.config.ts (the TanStack Start app),
// which fails immediately because it cannot resolve a router entry relative
// to this subproject. This file scopes Vitest to the worker service only.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // config.ts validates these at import time; runner.ts imports config.ts
    // for real Playwright timeouts even though tests never launch a browser.
    env: {
      ETERNA_HOOK_URL: "http://localhost:3000",
      AUTOMATION_WORKER_SECRET: "test-secret-at-least-32-characters-long",
    },
  },
});
