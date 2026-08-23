# Transparent Scan Reports + Conservative Removal Eligibility

## 1. The flow that exists today

```text
scan-orchestrator tick
  -> scan_module_enrollments (per user x module: status, last_scan_at,
     next_scan_at, candidates_found, verified_findings, blocked_reason)
  -> per-module dispatch
       Reputation        -> scans + scan_hits
       Deepfake          -> deepfake_scans + deepfake_findings
       Copyright         -> copyright_scans + copyright_matches (+ discovery_candidates)
       YouTube Removal   -> youtube_removal_scans + youtube_removal_findings
       Channel Watch     -> channel_watches + channel_watch_videos      (self-cron, mirrored)
       Distribution      -> distribution_monitor_runs + distribution_incidents (self-cron)
       Release sweep     -> release_monitor_runs                         (self-cron)
       Narrative / Face / Evidence prep -> aggregate only
  -> only "verified" findings are handed to
     AutoEnforcementOrchestrator.evaluateEligibility
       -> AUTO_ELIGIBLE / REVIEW_REQUIRED / NOT_ELIGIBLE (+ structured reason)
       -> enforcement_cases (eligibility_status, eligibility_reason)
            AUTO_ELIGIBLE   -> enforcement_jobs
            REVIEW_REQUIRED -> enforcement_review_queue (PENDING)
  -> domain_enforcement_routes.verification_status + effectiveRouteState (canAutoSend)
  -> runFinalPreSendGate  <-- ENFORCEMENT_LIVE_ENABLED / ENFORCEMENT_TEST_MODE live here,
     writes immutable enforcement_presend_audit; nothing leaves without passing it.
```

Key point: the safety architecture is already correct and conservative. Discovery is
already separate from enforcement, and the "verified only" thresholds per module
(`confidence_band = confirmed`, `takedown_recommended`, `evidence_verified`) already
prevent merely-similar items from becoming removal requests. None of that will be touched.

## 2. Where the scan report should live

Reuse `generated_reports` as the single report row, extended with a scan pointer, and
keep the full discovery set in its payload. No new scan system, no new finding tables.

- Report row: `generated_reports` (already has `kind`, `status`, `pdf_url`, `findings_count`, `filters`, user-scoped RLS).
- Report body: rendered on demand from the module's own run row + finding rows, and
  snapshotted into a `payload` JSON so a historical report stays readable even if
  findings are later re-scored.
- Copyright keeps its existing PDF dossier; the new report row simply links to it
  instead of duplicating it.

## 3. Fields that already represent eligibility

| Concept | Existing field |
| --- | --- |
| Eligibility verdict | `enforcement_cases.eligibility_status` (AUTO_ELIGIBLE / REVIEW_REQUIRED / NOT_ELIGIBLE) |
| Why | `enforcement_cases.eligibility_reason` (structured JSON from `evaluateEligibility`) |
| Human review state | `enforcement_review_queue.review_status` |
| Route send-ability | `domain_enforcement_routes.verification_status` + `effectiveRouteState().canAutoSend` |
| Per-module "verified" thresholds | `copyright_matches.confidence_band` / `review_status`, `deepfake_findings.takedown_recommended` / `review_status`, `youtube_removal_findings.evidence_verified` / `removal_potential` |
| Send-time gate trail | `enforcement_presend_audit` |

So eligibility does not need to be invented — it needs to be **read back and displayed**.

## 4. What is genuinely missing

1. No link from a report to the scan run that produced it (`generated_reports` has no `scan_id` / `module_key`).
2. No normalized view of a discovery across modules — each module names URL, evidence, confidence and status differently.
3. Eligibility is only computed for findings that already cleared the "verified" threshold, so a report cannot currently say *why* the other discoveries were not eligible.
4. Report generators exist only for Copyright and Deepfake; the other modules produce no report.
5. `_app.reports.tsx` lets a user hand-create a "Draft" report that nothing ever generates — misleading.
6. Nowhere to open "what did the last sweep actually find" from the Continuous Protection card.

## 5. Smallest implementation plan

**Step 1 — normalization layer (no schema change).**
`src/lib/protection/report/normalize.ts`: one adapter per module mapping its finding row to a
common read-only shape `{ id, module, title, sourceUrl, discoveredAt, confidence, confidenceLabel,
evidence[], status }`. Pure functions, unit-tested per module.

**Step 2 — eligibility classifier (reuses existing rules only).**
`src/lib/protection/report/eligibility.ts`: classify every discovery, not just verified ones, into
`REMOVAL_ELIGIBLE` / `NOT_REMOVAL_ELIGIBLE` / `REQUIRES_REVIEW`, plus a plain-English reason list.
Order of precedence, all from existing data:
1. Existing `enforcement_cases.eligibility_status` for the finding, when present — authoritative.
2. Otherwise the module's own verified threshold: below it -> `NOT_REMOVAL_ELIGIBLE`
   ("confidence below the confirmed threshold", "subject not confirmed", "informational / news
   coverage", "commentary without violation").
3. At/above the threshold but no authorization scope, unverified asset ownership, or no VERIFIED
   removal route -> `REQUIRES_REVIEW` with the specific missing precondition named.
This layer only *reads* rules; it never grants eligibility that the enforcement orchestrator
would refuse, and it creates no cases, jobs or notices.

**Step 3 — one migration, additive.**
Add to `generated_reports`: `module_key text`, `scan_id uuid`, `run_started_at timestamptz`,
`run_completed_at timestamptz`, `payload jsonb`, plus counts `discovered_count`,
`eligible_count`, `review_count`, `not_eligible_count`; unique index on
`(user_id, module_key, scan_id)`. No RLS change, existing grants unchanged.

**Step 4 — report builder + server function.**
`src/lib/protection/report/build.server.ts`: given `(module_key, scan_id)`, read the run row and
all its findings, normalize, classify, upsert one `generated_reports` row with the full snapshot.
Called (a) at the end of each module dispatch in the orchestrator — the only orchestrator change,
a single best-effort call after the run finishes, wrapped so a report failure can never fail a
scan — and (b) on demand from `getScanReport` / `listScanReports` server functions.
Empty scans still produce a report saying "0 discoveries".

**Step 5 — UI.**
- `/reports` becomes the real history list (module, status, started/completed, discovered /
  eligible / review counts). Remove the fake manual "create Draft report" form.
- New `/reports/$reportId`: header (module, status, timestamps), then every discovery with source
  URL, evidence, confidence, and a colour-coded eligibility badge + reason. Filter chips for
  All / Eligible / Requires review / Not eligible, defaulting to **All** so nothing is hidden.
- Continuous Protection card gains a "View last scan report" link per target.

**Step 6 — verification.**
Unit tests for each normalizer and for the classifier (including "similar but not eligible" and
"eligible only after review" cases); a test asserting the report path creates no
`enforcement_cases` / `enforcement_jobs` / `enforcement_requests` rows; re-run the existing
protection suite; confirm `ENFORCEMENT_LIVE_ENABLED=false` and `ENFORCEMENT_TEST_MODE=true`
are untouched.

## 6. Explicitly out of scope

Scheduling, cron architecture, hook authentication, RLS, enforcement transport, the pre-send gate,
and every existing eligibility rule. Reporting is additive and read-only with respect to enforcement.
