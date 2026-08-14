/**
 * ONE-OFF controlled end-to-end enforcement test.
 * Drives a real enforcement case through the real queue + worker + Resend transport.
 * Requires ENFORCEMENT_TEST_MODE=true and ENFORCEMENT_LIVE_ENABLED unset/false.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { EnforcementWorkerRunner } from "@/lib/enforcement/worker";

const db = supabaseAdmin as any;

const DEMO_EMAIL = "hellosreehari@gmail.com";
const TEST_DOMAIN = "eterna-enforcement-test.invalid";
const TEST_URL = `https://${TEST_DOMAIN}/controlled-e2e/${Date.now()}`;

function assertSafe() {
  if (process.env.ENFORCEMENT_TEST_MODE !== "true") throw new Error("ABORT: ENFORCEMENT_TEST_MODE is not true");
  if (process.env.ENFORCEMENT_LIVE_ENABLED === "true") throw new Error("ABORT: live sending is enabled");
  if (process.env.ENFORCEMENT_EMERGENCY_PAUSE === "true") throw new Error("ABORT: emergency pause active");
}

async function main() {
  assertSafe();

  // 1. Resolve the demo operator account.
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = users?.users?.find((u: any) => (u.email || "").toLowerCase() === DEMO_EMAIL);
  if (!user) throw new Error(`Demo user ${DEMO_EMAIL} not found`);
  const userId = user.id as string;
  console.log("user:", DEMO_EMAIL, userId);

  // 2. Profile (complainant identity for notice completeness guard).
  const { data: profile } = await db
    .from("client_profiles")
    .select("legal_name, full_name, company_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  console.log("profile:", profile);

  // 3. Active authorization (send-time recheck).
  let { data: auth } = await db
    .from("client_authorizations")
    .select("id, status")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  console.log("authorization:", auth);

  // 4. Verified email route for the sacrificial test domain.
  const { data: route, error: routeErr } = await db
    .from("domain_enforcement_routes")
    .upsert(
      {
        domain: TEST_DOMAIN,
        contact: `dmca@${TEST_DOMAIN}`,
        copyright_email: `dmca@${TEST_DOMAIN}`,
        contact_type: "COPYRIGHT",
        preferred_method: "EMAIL",
        verification_status: "VERIFIED",
        verification_method: "CONTROLLED_TEST_FIXTURE",
        confidence: 1,
        verified_at: new Date().toISOString(),
        notes: "Controlled internal enforcement E2E test route (non-routable .invalid TLD).",
      },
      { onConflict: "domain" },
    )
    .select("id, domain, verification_status, contact")
    .maybeSingle();
  console.log("route:", route, routeErr?.message ?? "");

  // 5. Queue one case.
  const { data: kase, error: caseErr } = await db
    .from("enforcement_cases")
    .insert({
      user_id: userId,
      target_url: TEST_URL,
      domain: TEST_DOMAIN,
      platform: "Web",
      enforcement_basis: "COPYRIGHT",
      eligibility_status: "ELIGIBLE",
      authorization_status: "ACTIVE",
      selected_route: `dmca@${TEST_DOMAIN}`,
      connector_id: "email_dmca_connector",
      status: "QUEUED",
    })
    .select("*")
    .maybeSingle();
  if (caseErr) throw new Error(`case insert failed: ${caseErr.message}`);
  console.log("case queued:", kase.id, kase.status);

  const { data: job, error: jobErr } = await db
    .from("enforcement_jobs")
    .insert({
      case_id: kase.id,
      user_id: userId,
      job_type: "AUTO_ENFORCEMENT_SUBMIT",
      status: "queued",
      scheduled_at: new Date().toISOString(),
      payload: { targetUrl: TEST_URL, controlledTest: true },
    })
    .select("*")
    .maybeSingle();
  if (jobErr) throw new Error(`job insert failed: ${jobErr.message}`);
  console.log("job queued:", job.id);

  // 6. Run the real worker.
  const ran1 = await EnforcementWorkerRunner.processNextJob(db, "controlled-e2e-worker");
  console.log("worker pass 1 processed a job:", ran1);

  // 7. Idempotency: re-run; the same job must not send again.
  const ran2 = await EnforcementWorkerRunner.processNextJob(db, "controlled-e2e-worker");
  console.log("worker pass 2 processed a job:", ran2);

  // 8. Report.
  const [{ data: finalCase }, { data: finalJob }, { data: events }, { data: deliveries }] = await Promise.all([
    db.from("enforcement_cases").select("id, status, updated_at, next_verification_at").eq("id", kase.id).maybeSingle(),
    db.from("enforcement_jobs").select("id, status, attempts, error, locked_by").eq("id", job.id).maybeSingle(),
    db.from("enforcement_events").select("event_type, actor_type, connector_id, previous_state, new_state, metadata, created_at").eq("case_id", kase.id).order("created_at", { ascending: true }),
    db.from("enforcement_email_deliveries").select("*").eq("case_id", kase.id),
  ]);

  console.log("\n=== FINAL CASE ===\n", JSON.stringify(finalCase, null, 2));
  console.log("\n=== FINAL JOB ===\n", JSON.stringify(finalJob, null, 2));
  console.log("\n=== EVENTS ===\n", JSON.stringify(events, null, 2));
  console.log("\n=== EMAIL DELIVERIES ===\n", JSON.stringify(deliveries, null, 2));

  const { data: jobsForCase } = await db.from("enforcement_jobs").select("id, job_type, status, scheduled_at").eq("case_id", kase.id);
  console.log("\n=== JOBS FOR CASE ===\n", JSON.stringify(jobsForCase, null, 2));
  console.log("\nCASE_ID=", kase.id, "JOB_ID=", job.id);
}

main().catch((e) => {
  console.error("E2E TEST ERROR:", e);
  process.exit(1);
});
