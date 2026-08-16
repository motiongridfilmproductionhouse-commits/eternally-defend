import { createFileRoute } from "@tanstack/react-router";

/**
 * Publishes the protection-autopilot worker token into the backend-only
 * `internal_cron_secrets` table so the database scheduler can authenticate its
 * sweep calls. The token value never leaves the server: it is read from the
 * environment and written with the service-role client.
 */
export const Route = createFileRoute("/api/public/hooks/protection-scheduler-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = process.env["ONBOARDING_BACKFILL_TOKEN"];
        const auth = request.headers.get("authorization") ?? "";
        if (!guard || auth !== `Bearer ${guard}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const token = process.env["PROTECTION_AUTOPILOT_SECRET"];
        if (!token) {
          return Response.json(
            { ok: false, error: "PROTECTION_AUTOPILOT_SECRET is not configured" },
            { status: 500 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("internal_cron_secrets")
          .upsert(
            { name: "protection_autopilot", token, updated_at: new Date().toISOString() },
            { onConflict: "name" },
          );
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, published: "protection_autopilot" });
      },
    },
  },
});
