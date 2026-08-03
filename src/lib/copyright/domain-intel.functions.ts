import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enrichDomainIntel } from "@/lib/copyright/domain-intel.server";

export const getDomainIntel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        url: z.string().url(),
        classification: z.string().optional(),
        force: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) =>
    enrichDomainIntel(data.url, {
      classification: data.classification ?? null,
      force: data.force ?? false,
    }),
  );
