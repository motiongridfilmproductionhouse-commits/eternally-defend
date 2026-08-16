import { createFileRoute } from "@tanstack/react-router";

/**
 * Repairs continuous-protection activation for accounts that finished onboarding
 * before autopilot activation was wired into every flow. Guarded by the existing
 * backfill token. Never sends any external notice — it only creates/refreshes
 * protection profiles and targets.
 */
export const Route = createFileRoute("/api/public/hooks/protection-activation-repair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["ONBOARDING_BACKFILL_TOKEN"];
        const auth = request.headers.get("authorization") ?? "";
        if (!secret || auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        let limit = 100;
        let userId: string | undefined;
        try {
          const body = (await request.json()) as { limit?: number; userId?: string };
          if (typeof body?.limit === "number") limit = Math.min(Math.max(body.limit, 1), 500);
          if (typeof body?.userId === "string") userId = body.userId;
        } catch {
          // empty body is fine
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { repairProtectionActivation } = await import("@/lib/protection/autopilot.server");
        const result = await repairProtectionActivation(supabaseAdmin, { limit, userId });
        return Response.json({ ok: true, ...result });
      },
    },
  },
});
