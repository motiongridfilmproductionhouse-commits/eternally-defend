import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runProtectionTarget } from "@/lib/protection/autopilot.server";
const { data: t } = await (supabaseAdmin as any)
  .from("protection_targets").select("*").eq("id", "519617cd-0ca6-44c5-9d08-54a0d326dff3").single();
console.log(JSON.stringify(await runProtectionTarget(supabaseAdmin as any, t, "manual"), null, 2));
