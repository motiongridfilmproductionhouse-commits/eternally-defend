import { createClient } from "@supabase/supabase-js";
import { autoEnforceEligibleDiscoveries } from "../src/lib/protection/report/auto-enforce.server";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const userId = "f4c7872b-6b47-4a89-addf-1d937a2b592e";
const stamp = Date.now();
const url = `https://eterna-enforcement-test.invalid/pipeline-verify/${stamp}`;

const discovery: any = {
  id: `verify-${stamp}`,
  module: "copyright",
  moduleVerified: true,
  platform: "Web",
  riskType: "COPYRIGHT",
  title: "Verification test re-upload",
  sourceUrl: url,
  confidence: 96,
  eligibility: "REMOVAL_ELIGIBLE",
  eligibilityReasons: ["verified-test"],
  evidence: [{ label: "Match confidence", value: "96%" }],
};

const summary = await autoEnforceEligibleDiscoveries(sb, {
  userId, moduleKey: "copyright", scanId: `verify-scan-${stamp}`, discoveries: [discovery],
});
console.log("summary", summary);

const { data: cases } = await sb.from("enforcement_cases").select("*").eq("target_url", url);
console.log("cases", JSON.stringify(cases, null, 2));
for (const c of cases ?? []) {
  const { data: jobs } = await sb.from("enforcement_jobs").select("id,job_type,status,attempts,scheduled_at,payload").eq("case_id", c.id);
  const { data: evs } = await sb.from("enforcement_events").select("event_type,actor_type,new_state,metadata,created_at").eq("case_id", c.id).order("created_at");
  console.log("jobs", JSON.stringify(jobs, null, 2));
  console.log("events", JSON.stringify(evs, null, 2));
}
