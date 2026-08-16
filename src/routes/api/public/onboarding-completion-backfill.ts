/**
 * One-off / maintenance endpoint: emails the onboarding completion report for
 * clients who finished onboarding before automatic reporting existed.
 *
 * Security:
 *  - Requires the shared secret ONBOARDING_BACKFILL_TOKEN in the
 *    `x-eterna-backfill-token` header (constant-time compare). No session, no
 *    user data is ever returned in the response beyond aggregate counts.
 *  - Reporting itself is idempotent: each client is emailed at most once
 *    (ledger-enforced), so repeated calls are safe.
 */

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/onboarding-completion-backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["ONBOARDING_BACKFILL_TOKEN"];
        if (!expected) {
          return new Response("Not configured", { status: 503 });
        }
        if (!tokenMatches(request.headers.get("x-eterna-backfill-token"), expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { notifyOnboardingCompletion } = await import(
          "@/lib/onboarding/completion-notification.server"
        );

        const [{ data: profiles }, { data: progress }] = await Promise.all([
          supabaseAdmin
            .from("client_profiles")
            .select("user_id")
            .eq("onboarding_completed", true),
          supabaseAdmin
            .from("onboarding_progress")
            .select("user_id")
            .eq("overall_status", "COMPLETED"),
        ]);

        const userIds = Array.from(
          new Set([
            ...(profiles ?? []).map((r) => r.user_id),
            ...(progress ?? []).map((r) => r.user_id),
          ]),
        ).filter(Boolean) as string[];

        let sent = 0;
        let skipped = 0;
        let failed = 0;
        for (const userId of userIds) {
          const result = await notifyOnboardingCompletion(supabaseAdmin, userId);
          if (result.sent) sent += 1;
          else if (result.skipped) skipped += 1;
          else failed += 1;
        }

        return Response.json({ candidates: userIds.length, sent, skipped, failed });
      },
    },
  },
});
