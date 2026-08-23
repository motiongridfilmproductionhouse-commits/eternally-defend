import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Metadata about the caller's own signed authorization (never another user's). */
export const getSignedAuthorization = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getSignedAuthorizationSummary } = await import("./signed-authorization.server");
    return await getSignedAuthorizationSummary(context.supabase, context.userId);
  });

/** Returns the caller's completed signed contract as base64 PDF bytes. */
export const downloadSignedAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildSignedAuthorizationDownload } = await import("./signed-authorization.server");
    try {
      return await buildSignedAuthorizationDownload(context.supabase, context.userId);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (raw === "NO_SIGNED_AUTHORIZATION") {
        throw new Error("No signed authorization available.");
      }
      if (raw === "DOCUMENT_UNAVAILABLE") {
        throw new Error(
          "Your signed authorization could not be retrieved right now. Please try again shortly.",
        );
      }
      console.error("[signed-authorization] download failed:", raw);
      throw new Error("We couldn't prepare your signed authorization. Please try again.");
    }
  });
