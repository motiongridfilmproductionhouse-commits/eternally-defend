import { createFileRoute } from "@tanstack/react-router";
import { isPublicSignupEnabled } from "@/lib/auth-config";

export const Route = createFileRoute("/api/public/signup")({
  server: {
    handlers: {
      POST: async () => {
        if (!isPublicSignupEnabled()) {
          return new Response(
            JSON.stringify({
              error: "REGISTRATION_CLOSED",
              message: "New registrations are temporarily closed.",
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response(
          JSON.stringify({
            message: "Public signup endpoint active.",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
