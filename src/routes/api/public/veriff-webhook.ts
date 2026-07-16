import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/veriff-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.VERIFF_API_KEY;
        const secret = process.env.VERIFF_SHARED_SECRET;
        if (!apiKey || !secret) return new Response("not configured", { status: 500 });
        
        const clientHeader = request.headers.get("x-auth-client") ?? "";
        if (clientHeader !== apiKey) return new Response("bad client id", { status: 401 });

        const sig = request.headers.get("x-hmac-signature") ?? request.headers.get("x-signature") ?? "";
        const body = await request.text();
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        try {
          const a = Buffer.from(sig, "utf8"); const b = Buffer.from(expected, "utf8");
          if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("bad signature", { status: 401 });
        } catch { return new Response("bad signature", { status: 401 }); }

        const payload = JSON.parse(body);
        const veriff_session_id: string | undefined = payload?.verification?.id ?? payload?.sessionId;
        const vendorData: string | undefined = payload?.verification?.vendorData ?? payload?.vendorData;
        const codeStatus: string | undefined = payload?.verification?.status ?? payload?.status ?? payload?.action;
        
        // Map Veriff string to DB Enum
        const map: Record<string, string> = {
          approved: "APPROVED", declined: "DECLINED", resubmission_requested: "RESUBMISSION_REQUIRED",
          expired: "EXPIRED", submitted: "SUBMITTED", review: "MANUAL_REVIEW", review_required: "MANUAL_REVIEW", 
          started: "IN_PROGRESS", pending: "IN_PROGRESS", created: "SESSION_CREATED"
        };
        const status = map[codeStatus?.toLowerCase() ?? ""] ?? "IN_PROGRESS";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const patch: Record<string, unknown> = {
          verification_status: status,
          raw_webhook: payload,
          review_reason: payload?.verification?.reason ?? null,
          country: payload?.verification?.document?.country ?? null,
          document_type: payload?.verification?.document?.type ?? null,
          verification_date: status === "APPROVED" ? new Date().toISOString() : null,
        };
        if (veriff_session_id) {
          await supabaseAdmin.from("kyc_verifications").update(patch as never).eq("veriff_session_id", veriff_session_id);
        } else if (vendorData) {
          await supabaseAdmin.from("kyc_verifications").update(patch as never).eq("user_id", vendorData);
        }
        return new Response("ok");
      },
    },
  },
});
