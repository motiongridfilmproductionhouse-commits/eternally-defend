import { createClient } from "@supabase/supabase-js";
import { processManualEvidenceLead } from "/dev-server/src/lib/deepfake/manual-evidence.server";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const r = await processManualEvidenceLead({ supabase, leadId: "a821b08f-fe82-4409-bfd8-35cfd0c7a20a" });
console.log("OUTCOME", r);
const { data } = await supabase.from("deepfake_findings").select("url,risk_level,finding_classification").eq("scan_id","dfec805b-2853-4c52-83e0-18188dd26b9d");
console.log("FINDINGS", data);
