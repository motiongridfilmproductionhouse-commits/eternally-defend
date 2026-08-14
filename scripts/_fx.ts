import { supabaseAdmin } from "@/integrations/supabase/client.server";
const db = supabaseAdmin as any;
const userId = "606afa01-0767-4356-8459-7e7d8521c233";
console.log("settings", JSON.stringify(await db.from("client_enforcement_settings").select("*").eq("user_id", userId).maybeSingle()));
console.log("auths", JSON.stringify(await db.from("client_authorizations").select("id,status,version,auth_number,enforcement_enabled,expiry_date").eq("user_id", userId)));
