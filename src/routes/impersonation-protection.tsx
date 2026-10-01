import { createFileRoute, redirect } from "@tanstack/react-router";

// Permanent alias: the canonical Impersonation Protection page lives at /ai-impersonation.
export const Route = createFileRoute("/impersonation-protection")({
  beforeLoad: () => {
    throw redirect({ to: "/ai-impersonation", statusCode: 301 });
  },
});
