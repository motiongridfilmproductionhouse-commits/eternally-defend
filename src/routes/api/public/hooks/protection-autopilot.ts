import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled sweep for continuous protection. Called by the scheduler with a
 * shared bearer secret; runs every due protection target for every ACTIVE
 * protection profile. Never sends external notices itself.
 */
export const Route = createFileRoute("/api/public/hooks/protection-autopilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret =
          process.env.PROTECTION_AUTOPILOT_SECRET ??
          process.env.RELEASE_PROTECTION_MONITOR_SECRET ??
          process.env.CHANNEL_WATCH_POLL_SECRET;
        const auth = request.headers.get("authorization") ?? "";
        if (!secret || auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        let limit = 5;
        try {
          const body = (await request.json()) as { limit?: number };
          if (typeof body?.limit === "number") limit = Math.min(Math.max(body.limit, 1), 25);
        } catch {
          // empty body is fine
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runProtectionSweep } = await import("@/lib/protection/autopilot.server");
        const { enforcementSwitches } = await import("@/lib/protection/autopilot");

        const result = await runProtectionSweep(supabaseAdmin, { limit });
        return Response.json({ ok: true, switches: enforcementSwitches(), ...result });
      },
    },
  },
});
