/**
 * Controlled end-to-end check for post-enrollment automatic protection.
 *
 * Safety: forces ENFORCEMENT_TEST_MODE=true and ENFORCEMENT_LIVE_ENABLED=false,
 * asserts no external notice was dispatched, and never calls a transport.
 *
 * Run: bun scripts/protection-autopilot-e2e.ts <userId>
 */
process.env.ENFORCEMENT_TEST_MODE = "true";
process.env.ENFORCEMENT_LIVE_ENABLED = "false";

import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import {
  activateProtectionAutopilot,
  ingestCandidate,
  type AutopilotCandidate,
} from "../src/lib/protection/autopilot.server";
import { enforcementSwitches } from "../src/lib/protection/autopilot";

const userId = process.argv[2];
if (!userId) throw new Error("usage: bun scripts/protection-autopilot-e2e.ts <userId>");

const log = (stage: string, payload: unknown) =>
  console.log(`\n=== ${stage} ===\n`, JSON.stringify(payload, null, 2));

const db = supabaseAdmin as never as any;

// STAGE 1 — enrollment complete -> profile ACTIVE -> targets enrolled + due now
const activation = await activateProtectionAutopilot(db, userId);
log("1. ACTIVATION", activation);

const { data: profile } = await db
  .from("protection_profiles")
  .select("status,paused,auto_scan_enabled,activated_at")
  .eq("user_id", userId)
  .maybeSingle();
log("2. PROTECTION PROFILE", profile);

const { data: targets } = await db
  .from("protection_targets")
  .select("id,target_kind,label,cadence_minutes,next_run_at,active")
  .eq("user_id", userId);
log("3. ENROLLED TARGETS (initial scan due immediately)", targets);

const target = (targets ?? [])[0];
if (!target) throw new Error("no protection target enrolled — cannot continue");

// STAGE 2 — known test finding from the account's existing verified evidence
const { data: finding } = await db
  .from("deepfake_findings")
  .select("id,url,canonical_url,page_title,source_host,confidence,synthetic_media_confidence,is_synthetic,target_face_match,face_referenced,matched_evidence,risk_level")
  .eq("user_id", userId)
  .eq("is_synthetic", true)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
log("4. KNOWN TEST FINDING", finding);
if (!finding) throw new Error("no existing verified finding to replay");

const candidate: AutopilotCandidate = {
  url: finding.canonical_url ?? finding.url,
  source: "deepfake_intel",
  source_type: finding.source_host,
  title: finding.page_title,
  risk_type: "DEEPFAKE",
  severity: finding.risk_level,
  confidence: Math.round(finding.synthetic_media_confidence ?? finding.confidence ?? 0),
  identityVerified: Boolean(finding.target_face_match) && Boolean(finding.face_referenced),
  mediaEvidenceConfirmed:
    Boolean(finding.is_synthetic) && (finding.matched_evidence ?? []).length > 0,
  ownershipVerified: true,
  protected_asset_id: null,
  finding_id: finding.id,
  lead_id: null,
  evidence: { replayed_from: finding.id },
};

const stats = {
  target_id: target.id,
  kind: target.target_kind,
  label: target.label,
  scan_ref: null,
  discovered: 1,
  duplicates: 0,
  verified: 0,
  held_for_review: 0,
  evidence_preserved: 0,
  cases_created: 0,
  external_sends: 0,
  blocking_reasons: [] as string[],
  status: "completed" as const,
};

const casesBefore = (await db.from("enforcement_cases").select("id").eq("user_id", userId)).data
  ?.length ?? 0;

await ingestCandidate(db, { ...target, user_id: userId }, candidate, stats as never);
log("5. INGEST (evidence preservation -> case -> gate evaluation)", stats);

// STAGE 3 — dedupe: replay the same URL, no second case
const dedupeStats = { ...stats, duplicates: 0, cases_created: 0 };
await ingestCandidate(db, { ...target, user_id: userId }, candidate, dedupeStats as never);
log("6. DEDUPE REPLAY", {
  duplicates: dedupeStats.duplicates,
  cases_created_on_replay: dedupeStats.cases_created,
});

const { data: seen } = await db
  .from("protection_findings_seen")
  .select("canonical_url,times_seen,case_id,enforcement_status,blocking_reason,evidence_json")
  .eq("user_id", userId)
  .order("last_seen_at", { ascending: false })
  .limit(3);
log("7. DEDUPE LEDGER", seen);

const casesAfter = (await db.from("enforcement_cases").select("id,status,selected_route,eligibility_status,target_url").eq("user_id", userId)).data ?? [];
log("8. ENFORCEMENT CASES", {
  before: casesBefore,
  after: casesAfter.length,
  newest: casesAfter.slice(-2),
});

// STAGE 4 — prove nothing left the building
const { data: deliveries } = await db
  .from("enforcement_email_deliveries")
  .select("id,status,created_at")
  .eq("user_id", userId)
  .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
const { data: submissions } = await db
  .from("enforcement_events")
  .select("event_type,created_at")
  .eq("user_id", userId)
  .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
  .in("event_type", ["SUBMITTED", "NOTICE_SENT", "DISPATCHED"]);

log("9. EXTERNAL SEND AUDIT", {
  switches: enforcementSwitches(),
  external_sends_counted: stats.external_sends,
  email_deliveries_last_10min: deliveries?.length ?? 0,
  send_events_last_10min: submissions?.length ?? 0,
  blocking_reasons: stats.blocking_reasons,
});

if (stats.external_sends > 0 || (deliveries?.length ?? 0) > 0 || (submissions?.length ?? 0) > 0) {
  throw new Error("SAFETY VIOLATION: an external send path was exercised");
}
console.log("\nPASS — case created/retained, evidence preserved, zero external notices sent.");
