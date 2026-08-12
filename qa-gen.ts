import { renderAuthorizationLetterPdf } from "@/lib/onboarding/authorization-letter-pdf.server";
import fs from "fs";
const scopes = ["monitor_public","monitor_verified_assets","detect_face_misuse","collect_evidence","monitoring_reports","prepare_copyright","prepare_privacy","prepare_impersonation","communicate_platforms","track_enforcement","submit_final_after_approval"].map(scope_key=>({scope_key,granted:true}));
const snap = {
  profile: { legal_name:"Sarayu Mohan", display_name:"Sarayu", client_id:"ETC-2026-0031", country:"India", client_type:"celebrity", website:"https://sarayumohan.com", social_profiles:{ handles:["https://instagram.com/sarayumohan","https://facebook.com/sarayu.official","https://x.com/sarayu"] } },
  assets: [{ kind:"youtube", name:"Sarayu Mohan Official", channel_url:"https://www.youtube.com/channel/UC123", verification_status:"VERIFIED" }],
  scopes,
  auth: { auth_number:"AUTH-2026-753952", version:1, effective_date:"2026-08-12", expiry_date:"2027-08-12", territory:"Worldwide" },
};
const bytes = await renderAuthorizationLetterPdf(snap, { signed:false });
fs.writeFileSync("/tmp/qa/letter.pdf", Buffer.from(bytes));
console.log("ok");
