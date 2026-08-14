import { createClient } from "@supabase/supabase-js";
import { filterCandidatesByTargetFace } from "@/lib/deepfake/face-filter.server";

const USER = "606afa01-0767-4356-8459-7e7d8521c233";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data: profile } = await supabase
  .from("deepfake_target_profiles")
  .select("id,user_id,target_name")
  .eq("target_name", "AWS Validation Subject A")
  .eq("user_id", USER)
  .single();
console.log("profile:", profile);

const candidates = [
  {
    url: "https://commons.wikimedia.org/wiki/File:Obama_Portrait_2006.jpg",
    image_url: "http://localhost:8099/obama_match_small.jpg",
    media_type: "image",
  },
  {
    url: "https://commons.wikimedia.org/wiki/File:Angela_Merkel_2019_cropped.jpg",
    image_url: "http://localhost:8099/merkel_small.jpg",
    media_type: "image",
  },
] as never[];

const res = await filterCandidatesByTargetFace({
  supabase,
  userId: USER,
  profileId: profile!.id,
  candidates,
});
const fmt = (a: any[]) =>
  a.map((c) => ({
    url: c.image_url,
    similarity: Number(c.face_similarity?.toFixed?.(2) ?? c.face_similarity),
    status: c.face_verification_status,
    band: c.confidence_label,
    matched: c.target_face_match,
  }));
console.log("targetName:", res.targetName);
console.log("MATCHED:", fmt(res.matched));
console.log("REJECTED:", fmt(res.rejected));
console.log("ERRORS:", fmt(res.errors));

// tenant isolation: another user's id must not load this profile's references
try {
  await filterCandidatesByTargetFace({
    supabase,
    userId: "e17ed334-edf0-4a25-a1e6-40e441a904d4",
    profileId: profile!.id,
    candidates: candidates.slice(0, 1),
  });
  console.log("ISOLATION: FAIL (cross-user access allowed)");
} catch (e: any) {
  console.log("ISOLATION: PASS ->", e.message);
}
