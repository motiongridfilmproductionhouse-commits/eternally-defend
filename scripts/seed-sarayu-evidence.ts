import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { seedSarayuMohanManualEvidence } from "../src/lib/deepfake/sarayu-evidence-seed.server";

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("This protected seed requires SUPABASE_SERVICE_ROLE_KEY.");
}

const result = await seedSarayuMohanManualEvidence(supabaseAdmin);
console.log(JSON.stringify(result, null, 2));
