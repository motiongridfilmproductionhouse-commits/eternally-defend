import { createClient } from "@supabase/supabase-js";
import { runManualEvidenceIntake } from "@/lib/deepfake/manual-evidence-intake.server";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const res = await runManualEvidenceIntake({
  supabase,
  userId: "606afa01-0767-4356-8459-7e7d8521c233",
  targetName: "Shweta Menon",
  profileId: "44ad27fa-4d5f-4770-8e3d-9709c55fd042",
  urls: [
    "https://sexbaba.co/threads/shweta-menon-fake-nude-sex-photos.1007/",
    "https://imgfy.net/image/5HjO",
    "https://imgfy.net/image/5Hqs",
    "https://desifakes.com/threads/shweta-menon-nude-fakes.778/",
    "https://pornkeen.net/south-actress-shweta-menon-shows-her-ass/",
  ],
});
console.log(JSON.stringify(res, null, 2));
