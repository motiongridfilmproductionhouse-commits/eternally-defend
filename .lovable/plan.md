# Staff Pre-Enrollment Live Intelligence Scan (revised)

A staff-only tool that runs a real, reproducible intelligence scan on a person or organisation **before** enrollment. Prospect data lives in its own namespace, nothing can ever be enforced from it, and every number on screen is a count of stored records.

## Non-negotiable rules encoded in the design

- No simulated data. Counters start at 0 and rise only when a row is written.
- A source family shows "Scanned" only when the backend actually issued a query and stored a result row for it.
- Incomplete coverage never reads as low risk. Coverage is computed from stored rows and qualifies every headline.
- Every record carries full provenance and is append-only; a rescan is a new run.
- Automated classification can never set VERIFIED — only a staff actor can.
- Zero findings is a valid outcome, rendered with its coverage qualification.

## Reuse vs new

Reused
- Access: `user_roles`, `has_role()`, `app_role` enum, `useUserRoles`, `AdminGuard` pattern.
- Discovery: `src/lib/scan/discovery/router.server.ts` with its per-provider health states (HEALTHY / NOT_CONFIGURED / CREDITS_EXHAUSTED / RATE_LIMITED / AUTH_FAILED / TIMEOUT / UNAVAILABLE); providers google, brave, firecrawl, gemini_grounding, ddg_html, wikipedia, serpapi, hikerapi; `canonicalizeUrl`, `normalizeQuery`.
- Policy: `src/lib/policy/source-policy.ts` (the existing "never Reddit" rule — left untouched).
- YouTube: `src/lib/deepfake/youtube-discovery.server.ts` (YOUTUBE_API_KEY).
- Images/media: `brave-images.server.ts`, `firecrawl-images.server.ts`, `google-images-collector.server.ts`, crawler `image_hash_service`, `image_match_service`, `frame_extractor`.
- Crawler service (`CRAWLER_SERVICE_URL`): `GET /health`, `GET /crawl`, `GET /crawl/diagnostics`, `POST /scan`, `POST /google-images`, `POST /frames`, `verification_service`, `risk_analyzer_service`, `confidence.py`.
- Analysis: `src/lib/scan/identity-confidence.ts`, `page-extract.server.ts`, `src/lib/deepfake/relevance-scorer.server.ts`, `discovery-dedupe.ts`, `src/lib/mm/providers.server.ts` (provider-mode / `unavailable(reason)` pattern for capability status).
- Evidence: `src/lib/deepfake/evidence-capture.server.ts`, `evidence-preservation.server.ts`, `src/lib/protection/evidence.server.ts`.
- Health: `src/lib/deepfake/discovery-provider-health.server.ts` (boot-sequence status lines).
- Enrollment: `src/lib/protection/enrollment.server.ts` / `enrollment.functions.ts`, `onboarding_progress`, `client_profiles`, `protection_targets`, `digital_assets`, `authorization_records`, `evidence_vault_items`.
- UI: app shell, shadcn primitives, `DiscoveryHealthPanel`, `InvestigationTerminal`, `AssessmentSearchAnimation`, `ScoreExplainer`, `EternaLogo`.

New: the `prospect_*` schema, a source-family registry, a coverage model, a deterministic versioned risk model, the boot sequence, the live scan interface, and the enrollment handoff.

## Source-family registry (new, versioned)

`src/lib/prospect/source-registry.ts` — `SOURCE_FAMILY_SET_VERSION = "v1"`, one entry per family: key, label, `providers[]`, `directAccess` (whether we can query the platform itself), `policyEnabled`, `requiresSecrets[]`, `weightClass` (major/supporting).

| Family | Direct access today | State in v1 | Reason |
|---|---|---|---|
| google_search | yes | queryable | GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID |
| web_general | yes | queryable | Brave + Firecrawl + Gemini grounding + DDG |
| news | yes (via search + domain classification) | queryable | no dedicated news API — labelled as such |
| youtube | yes | queryable | YOUTUBE_API_KEY |
| images | yes | queryable | Brave/Google/Firecrawl images + crawler hashing |
| fact_check | yes | queryable | FACT_CHECK_API_KEY |
| encyclopaedic | yes | queryable | Wikipedia/Wikidata, keyless |
| instagram | no | UNAVAILABLE | HikerAPI key absent + HIKERAPI_ENABLED off |
| facebook | no | UNAVAILABLE | no permitted API |
| x_twitter | no | UNAVAILABLE | no permitted API |
| tiktok | no | UNAVAILABLE | no permitted API |
| reddit | n/a | DISABLED_BY_POLICY | existing never-monitor-Reddit rule, unchanged |

Enabling a family later = flipping its registry flag and adding its provider adapter; the scan workflow does not change. Reddit's flag is wired but stays off, and `source-policy.ts` is not modified.

Platform-attributed web results: when Google/Brave/Firecrawl/Gemini returns an instagram.com / facebook.com / x.com / tiktok.com URL, it is stored and shown with `platform = Instagram` (etc.) and `discovery_method = "Web Search"`. The family itself still reports UNAVAILABLE — never "scanned".

## Coverage model (drives the headline)

Per scan: `families_intended` (from the registry version), `families_queried_ok`, `families_failed`, `families_unavailable`, `families_policy_disabled`, plus a `coverage_state`:

- COMPLETE — every intended family with direct access succeeded **and** no major family is unavailable.
- PARTIAL — ≥60% of intended families succeeded; any unavailable major family (including "all direct social platforms") caps the result at PARTIAL.
- LIMITED — 30–59% succeeded.
- INSUFFICIENT — <30% succeeded, or google_search plus web_general both failed.

Because all four direct social families are unavailable in v1, real scans will legitimately report PARTIAL at best; the UI says so. Whenever coverage ≠ COMPLETE the assessment is labelled "Risk assessment based on available sources", and the summary shows "N of M intended source families successfully queried (set v1)".

Zero findings renders "No relevant findings in scanned sources · Coverage: Partial" — never "Low Risk". Zero findings with non-COMPLETE coverage yields **Insufficient data**, never LOW.

## Schema (new tables, all `prospect_`-prefixed)

- `prospect_identities` — locked identity: display name, identity type, country/region, known profile/site, approved aliases, created_by.
- `prospect_scans` — one row per run: identity_id, status, source_family_set_version, coverage counters + coverage_state, classification_version, risk_model_version, risk_band, started/finished.
- `prospect_scan_sources` — one row per family per scan: family key, state (`not_scanned` / `connecting` / `scanning` / `results_found` / `no_results` / `unavailable` / `provider_error` / `policy_disabled`), providers used, queries issued, raw result count, failure reason. This table *is* the source rail.
- `prospect_scan_capabilities` — per scan per analysis (ai_manipulation, impersonation, privacy, propagation, search_reputation): `ran` / `unavailable` + reason. Drives "analysis unavailable" copy instead of a fabricated count.
- `prospect_scan_events` — append-only job log (stage, message, level, created_at) for the live terminal via realtime.
- `prospect_discoveries` — one row per deduped content item: scan_id, prospect_id, canonical_url, original_url, content_fingerprint, platform, discovery_method, title, snippet, published_at, retrieved_at, extraction result, identity bucket + confidence + signals, classification, classification_version.
- `prospect_discovery_observations` — every provider sighting of that item: provider, provider_result_id, query used, rank, raw payload excerpt, retrieved_at. Dedup keeps all observations; primary totals count the parent item once.
- `prospect_findings` — classified findings referencing a discovery: stage (01–06), category, severity, detection reason, confidence, state, risk_model_version, classification_version.
- `prospect_finding_evidence` — excerpt, capture path (private bucket), content hash, observed_at, provenance; append-only.
- `prospect_propagation_clusters` + `prospect_cluster_members` — grouping with the evidence for each link (shared canonical host/path, media hash distance, text similarity score, timestamp order, platform cross-reference); earliest member flagged `earliest_discovered`, never "original" unless an origin evidence record exists.
- `prospect_risk_scores` — band, model version, and per-factor contributions split Verified vs Provisional.
- `prospect_staff_decisions` — audit: actor, finding, previous state, new state, reason, timestamp.
- `prospect_enrollment_transfers` — idempotency ledger for the handoff (prospect_scan_id, finding_id, target record, unique constraint).

Append-only enforcement: reuse the existing `enforcement_audit_append_only()` trigger pattern on `prospect_scan_events`, `prospect_discoveries`, `prospect_discovery_observations`, `prospect_finding_evidence`. Finding state changes are allowed but only through the audited path.

New private storage bucket `prospect-evidence` with staff-only object policies.

## Finding state machine

`DISCOVERED → CLASSIFIED → NEEDS_HUMAN_REVIEW → VERIFIED | REJECTED | ESCALATED`

- The automated pipeline may write DISCOVERED, CLASSIFIED, NEEDS_HUMAN_REVIEW only.
- A DB trigger rejects any transition into VERIFIED / REJECTED / ESCALATED unless `verified_by` is a staff user and a matching `prospect_staff_decisions` row is written in the same transaction; the service role is not exempt.
- "Eligible for response" is **not** a finding state — it is a downstream client-side concept that only exists after enrollment plus authorization.

## Identity resolution buckets (before any risk analysis)

Mapped from the existing scorer, thresholds documented in code:

| Bucket | Rule | Effect |
|---|---|---|
| MATCHED | full name/alias in page body, title or URL; confidence ≥ 80 | only bucket that contributes to risk totals |
| POSSIBLE_MATCH | name in one strong field only, or distinctive-token match in extracted body; 60–79 | shown, never counted in verified totals automatically |
| NEEDS_REVIEW | weak/partial signal, or page text not retrieved; 25–59 | "Needs Identity Verification" queue, excluded from totals |
| UNRELATED | page text retrieved and contains no target signal | retained for audit, excluded everywhere |

Same-name different people are never merged: disambiguation uses the supplied known profile/site, organisation, profession and location, and any conflict downgrades to NEEDS_REVIEW.

## Deduplication

Key = canonical URL (existing `canonicalizeUrl`) + content fingerprint (normalised title+text simhash, and perceptual hash for media). Same item from several providers → one `prospect_discoveries` row + N `prospect_discovery_observations` rows. Every displayed total counts parent rows only.

## Risk model (`src/lib/prospect/risk-model.ts`, version `pre-enroll-v1`)

Factors, each computed from stored rows, each with its own contribution recorded:

Verified track (full weight): severity of verified findings (0–30), source authority (0–10), search visibility / rank position (0–10), platform spread (0–8), propagation/reupload count (0–10), recency (0–7), AI-manipulation confidence on verified media (0–10), identity confidence MATCHED only (0–5).

Provisional track (capped): all unverified CLASSIFIED / NEEDS_HUMAN_REVIEW findings contribute at a 0.2 multiplier with a hard cap of 12 total points, and can never push the band above MODERATE on their own.

Bands: LOW 0–19, MODERATE 20–44, HIGH 45–69, CRITICAL 70+. Overridden to **Insufficient data** when coverage_state is LIMITED/INSUFFICIENT, when there are zero MATCHED findings, or when verified-track points are 0 and only provisional signals exist.

"Why this score?" reads the stored breakdown and renders two labelled groups (Verified contributions / Provisional signals) with numeric values. Unit tests include the required proof that five unverified allegations score strictly below five verified high-severity findings.

## Access and security

- Migration adds `'staff'` to `app_role` and seeds the role row for the auth user `hellosreehari@gmail.com` (looked up by email; no-op if absent). No email checks anywhere in the frontend.
- RLS on every `prospect_*` table and on `prospect-evidence` storage objects: staff / admin / super_admin via `has_role()`. No `anon` grants. Client and celebrity accounts match no policy, so prospect scans and evidence are unreadable to them.
- Server functions use `requireSupabaseAuth` plus an explicit role check through the caller's own client before any admin-client work.
- Every staff decision writes `prospect_staff_decisions`.

## Structural enforcement block

- No prospect table is referenced by any enforcement module; the enforcement entry points validate their target ids against client-side tables and reject unknown/prospect ids, with a test asserting a `prospect_finding` id cannot enter `enforcement_requests`, `enforcement_jobs` or the automation adapters.
- Standing flags stay as they are: ENFORCEMENT_LIVE_ENABLED=false, ENFORCEMENT_TEST_MODE=true, CONTROLLED_PRODUCTION_MODE=true, empty allowlist.

## Enrollment handoff

"Begin Client Enrollment" transfers the resolved identity, verified official profiles, approved aliases, staff-selected VERIFIED findings and their evidence references into the existing onboarding/enrollment path — no re-searching. Each transferred record keeps `origin_prospect_scan_id`; `prospect_enrollment_transfers` has a unique constraint per (scan, finding, target) so repeat clicks are idempotent.

## Phases

1. **Data + access** — migration: `staff` role + seed, all `prospect_*` tables with GRANTs, RLS, indexes, `updated_at` triggers, append-only triggers, verification-actor trigger, `prospect-evidence` bucket + policies, realtime on events/discoveries/findings.
2. **Scan engine** — source-family registry, session creation with identity lock, per-family source rows seeded from live health probes, discovery through the existing router + YouTube + image providers, dedupe into discoveries/observations, provenance on every row, real job events with exact messages.
3. **Analysis** — identity bucketing first; capability status per analysis; stages 01–06 classification with conservative wording enforced in code (no "deepfake" from a score, no allegation asserted as fact, no automatic "defamation"); propagation clustering with stored link evidence; coverage computation; deterministic risk score with factor breakdown.
4. **Live interface** — boot sequence driven by real health checks (session, crawler `/health`, provider health) with reduced-motion support and skip; search screen; full-screen stage view with source rail, live terminal, streaming evidence cards, counters read from stored rows, coverage-qualified empty states.
5. **Verification, summary, actions** — evidence drawer; staff approve / reject / reclassify / escalate with audit; "Digital Exposure Intelligence — [NAME]" summary with coverage disclosure; "Why this score?"; actions Create Pre-Enrollment Report, Begin Client Enrollment, Add to Prospect, Review Findings, Rescan (new run, history preserved).
6. **QA gate** — automated tests plus a written QA report proving: UI count = DB count per category; no hardcoded counts or URLs; duplicates don't inflate totals; unavailable providers never display as scanned; zero findings render with coverage qualification; partial coverage disclosed in summary and report; staff-only RLS holds and a client account cannot read prospect scans or evidence; rescan preserves historical runs; enrollment transfer is idempotent; risk model verified-vs-unverified weighting test. Plus typecheck, lint, build.

## Known limitations stated in the UI

- Instagram, Facebook, X and TikTok are not directly scanned; their URLs appear only when surfaced by web search, labelled as such.
- Reddit is disabled by policy for this release.
- News coverage comes from search providers with domain classification, not a dedicated news API.
- Manipulation signals are indicative only and require human verification.
- Search-reputation percentages are computed over analysed results only, with sample size shown.
- Nothing here triggers enforcement; records enter the client workflow only after authorization and enrollment.

## Secrets

Nothing new is required for phase 1. To enable the unavailable families later: `HIKERAPI_ACCESS_KEY` + `HIKERAPI_ENABLED=true` (Instagram), `SERPAPI_API_KEY` (extra SERP depth), and official Meta / X / TikTok platform credentials. A Reddit integration would additionally need an approved policy change.
