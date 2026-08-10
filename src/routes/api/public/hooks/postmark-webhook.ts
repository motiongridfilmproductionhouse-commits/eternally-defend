import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/hooks/postmark-webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const secretHeader = request.headers.get("x-postmark-webhook-secret") || request.headers.get("authorization");
        const webhookSecret = process.env.POSTMARK_WEBHOOK_SECRET;

        if (webhookSecret && secretHeader !== `Bearer ${webhookSecret}` && secretHeader !== webhookSecret) {
          return new Response(JSON.stringify({ error: "Unauthorized webhook request" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        try {
          const payload = (await request.json()) as {
            RecordType?: string;
            MessageID?: string;
            ID?: number | string;
            Type?: string;
            TypeCode?: number;
            Recipient?: string;
            DeliveredAt?: string;
            BouncedAt?: string;
            Description?: string;
            Details?: string;
            Tag?: string;
          };

          const recordType = payload.RecordType || "Delivery";
          const providerMessageId = payload.MessageID ? String(payload.MessageID) : null;

          if (!providerMessageId) {
            return new Response(JSON.stringify({ error: "Missing MessageID in Postmark webhook payload" }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }

          // Query database for existing enforcement case / event matching providerMessageId
          const { data: matchedEvents } = await (supabaseAdmin as any)
            .from("enforcement_events")
            .select("case_id, user_id")
            .contains("metadata", { providerMessageId })
            .limit(1);

          const matched = matchedEvents?.[0];

          if (!matched) {
            return new Response(JSON.stringify({ error: "Unknown MessageID. Event ignored.", matched: false }), {
              status: 404,
              headers: { "content-type": "application/json" },
            });
          }

          const isHardBounce = recordType === "Bounce" && (payload.Type === "HardBounce" || payload.TypeCode === 1);
          const isSoftBounce = recordType === "Bounce" && !isHardBounce;
          const isDelivery = recordType === "Delivery";

          let eventType = "POSTMARK_WEBHOOK";
          let newStatus = "SUBMITTED";

          if (isDelivery) {
            eventType = "EMAIL_DELIVERED";
            newStatus = "DELIVERED";
          } else if (isHardBounce) {
            eventType = "EMAIL_HARD_BOUNCE";
            newStatus = "DELIVERY_FAILED";
          } else if (isSoftBounce) {
            eventType = "EMAIL_SOFT_BOUNCE";
            newStatus = "UNDER_REVIEW";
          }

          await (supabaseAdmin as any).from("enforcement_events").insert({
            case_id: matched.case_id,
            user_id: matched.user_id,
            event_type: eventType,
            actor_type: "WORKER",
            new_state: newStatus,
            metadata: {
              provider: "POSTMARK",
              recordType,
              providerMessageId,
              recipient: payload.Recipient,
              bouncedAt: payload.BouncedAt,
              deliveredAt: payload.DeliveredAt,
              description: payload.Description || payload.Details,
              webhookReceivedAt: new Date().toISOString(),
            },
          });

          if (isHardBounce) {
            await (supabaseAdmin as any)
              .from("enforcement_cases")
              .update({
                status: "DELIVERY_FAILED",
                updated_at: new Date().toISOString(),
              })
              .eq("id", matched.case_id);
          }

          return new Response(JSON.stringify({ ok: true, matched: true, eventType, newStatus }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
