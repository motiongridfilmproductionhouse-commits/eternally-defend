import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/release-protection-monitor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret =
          process.env.RELEASE_PROTECTION_MONITOR_SECRET ??
          process.env.DISTRIBUTION_MONITOR_SECRET ??
          process.env.CHANNEL_WATCH_POLL_SECRET;
        const auth = request.headers.get("authorization") ?? "";
        if (!secret || auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runReleaseProtectionSweep } =
          await import("@/lib/copyright/release-protection.server");

        const result = await runReleaseProtectionSweep(supabaseAdmin, { limit: 15 });
        return Response.json({
          ok: true,
          ...result,
        });
      },
    },
  },
});
