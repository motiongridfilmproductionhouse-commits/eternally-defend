import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runProtectionTarget } from "@/lib/protection/autopilot.server";
const r = await runProtectionTarget(supabaseAdmin as any, "519617cd-0ca6-44c5-9d08-54a0d326dff3");
console.log(JSON.stringify(r, null, 2));
