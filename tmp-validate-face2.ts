import { createClient } from "@supabase/supabase-js";
import { filterCandidatesByTargetFace } from "@/lib/deepfake/face-filter.server";
const USER = "606afa01-0767-4356-8459-7e7d8521c233";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const res = await filterCandidatesByTargetFace({
  supabase, userId: USER, profileId: "96129295-a600-4c4c-9d7c-c6098d1d0cc2",
  candidates: [
    { url: "p1", image_url: "http://localhost:8099/o4_s.jpg", media_type: "image" },
    { url: "p2", image_url: "http://localhost:8099/merkel.jpg", media_type: "image" },
  ] as never[],
});
const fmt = (a: any[]) => a.map((c) => ({ url: c.image_url, sim: c.face_similarity, status: c.face_verification_status, band: c.confidence_label }));
console.log("MATCHED:", fmt(res.matched), "REJECTED:", fmt(res.rejected), "ERRORS:", fmt(res.errors));
