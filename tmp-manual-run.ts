import { createClient } from "@supabase/supabase-js";
import { runManualEvidenceIntake } from "/dev-server/src/lib/deepfake/manual-evidence-intake.server";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const res = await runManualEvidenceIntake({
  supabase, userId: "606afa01-0767-4356-8459-7e7d8521c233",
  targetName: "Shweta Menon", profileId: "44ad27fa-4d5f-4770-8e3d-9709c55fd042",
  urls: ["https://sexbaba.co/threads/shweta-menon-fake-nude-sex-photos.1007/","https://desifakes.com/threads/shweta-menon-nude-fakes.778/","https://pornkeen.net/south-actress-shweta-menon-shows-her-ass/"],
});
console.log("SCAN", res.scan_id, "review", res.review_required, "failed", res.failed);
const { data: f } = await supabase.from("deepfake_findings").select("url,risk_level,finding_classification,face_similarity").eq("scan_id", res.scan_id!);
console.log("FINDINGS", JSON.stringify(f, null, 2));
const { data: leads } = await supabase.from("deepfake_manual_leads").select("submitted_url,scan_id,processing_status").eq("scan_id", res.scan_id!);
console.log("LEADS", JSON.stringify(leads));
