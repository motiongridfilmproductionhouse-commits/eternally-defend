import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getProviderCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildProviderCatalog, assertAdmin } = await import("./provider-catalog.server");
    await assertAdmin(context.supabase, context.userId);
    return { providers: buildProviderCatalog() };
  });
