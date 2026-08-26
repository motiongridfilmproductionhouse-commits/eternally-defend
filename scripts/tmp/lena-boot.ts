import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runFaceReferenceExtractionForUser } from "@/lib/protection/dispatch/face-reference-extraction.server";
const out = await runFaceReferenceExtractionForUser(supabaseAdmin, "09d24c23-9336-4ab9-babf-717c34415dce");
console.log(JSON.stringify(out, null, 2));
