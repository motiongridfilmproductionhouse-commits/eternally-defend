import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runProtectedAssetBootstrapForUser } from "@/lib/protection/dispatch/protected-asset-bootstrap.server";
const out = await runProtectedAssetBootstrapForUser(supabaseAdmin, "09d24c23-9336-4ab9-babf-717c34415dce");
console.log(JSON.stringify(out, null, 2));
