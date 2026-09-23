# Staff Pre-Enrollment Live Intelligence Scan

A staff-only tool to run a real, reproducible intelligence scan on a person or organisation **before** they become a client. Prospect data stays in its own tables, nothing is ever enforced automatically, and every number on screen is a count of stored records.

## Ground rules baked into the design

- No simulated data anywhere. Counters start at 0 and only increment when a row is written.
- A source shows "Scanned" only if the backend actually made a query against it and stored a provider result row.
- Sources with no credential or no lawful access show "Unavailable — not scanned" with the reason.
- Zero findings is a valid outcome and renders a clean empty state, never a filler number.
- Every finding stores its source URL, the retrieved excerpt, retrieval timestamp and provider — so the scan can be replayed from stored records.
- Risk score is deterministic, versioned, and explainable from the stored findings only; "Insufficient data" when nothing relevant was found.

## What exists today and will be reused

Access control
- `user_roles` table + `has_role()` security-definer function + `app_role` enum.
- `useUserRoles` hook and `AdminGuard` component pattern.

Discovery (already built, credential-gated)
- `src/lib/scan/discovery/router.server.ts` — multi-provider router with per-provider health states (CREDITS_EXHAUSTED, RATE_LIMITED, AUTH_FAILED, TIMEOUT, UNAVAILABLE). This is exactly the honest per-source status the source rail needs.
- Providers: Google Programmable Search, Brave, Firecrawl, Gemini grounding, DuckDuckGo, Wikipedia, SerpApi, HikerAPI (Instagram).
- `src/lib/deepfake/youtube-discovery.server.ts` (YouTube Data API), `brave-images.server.ts`, `firecrawl-images.server.ts`, `google-images-collector.server.ts`.
- Crawler service (FastAPI, `CRAWLER_SERVICE_URL`): `GET /health`, `GET /crawl`, `GET /crawl/diagnostics`, `POST /scan`, `POST /google-images`, frames + image-hash + image-match services.

Analysis / scoring
- `src/lib/scan/identity-confidence.ts` (VERIFIED / PROBABLE / AMBIGUOUS / NOT_SUBJECT) — mapped to the requested Strong / Probable / Possible / Uncertain labels.
- `src/lib/scan/page-extract.server.ts`, `src/lib/deepfake/relevance-scorer.server.ts`, `src/lib/deepfake/video-face-match.server.ts`, crawler `risk_analyzer_service` / `confidence.py` / `image_hash_service`.
- `src/lib/deepfake/discovery-provider-health.server.ts` for live provider health in the boot sequence.
- Evidence capture: `src/lib/deepfake/evidence-capture.server.ts`, `evidence-preservation.server.ts`, `src/lib/protection/evidence.server.ts`.

UI / patterns
- `PublicPage`/app shell, shadcn primitives, `DiscoveryHealthPanel`, `InvestigationTerminal`, `AssessmentSearchAnimation` (reference for the boot sequence), `EternaLogo`, existing evidence drawer patterns.
- Onboarding: `src/lib/protection/enrollment.server.ts` + `enrollment.functions.ts` and the `/onboarding` flow — the "Begin Client Enrollment" hand-off target.

Existing tables reused read-only or as hand-off targets: `user_roles`, `client_profiles`, `business_profiles`, `onboarding_progress`, `protection_targets`, `evidence_vault_items`, `digital_assets`, `authorization_records`.

## What is new

New prospect namespace (all tables prefixed `prospect_`), fully separate from client monitoring tables:

- `prospect_identities` — the locked identity for a scan session (name, identity type, country/region, known profile/site, aliases, created_by).
- `prospect_scans` — one row per scan run (identity_id, status, stage progress, provider coverage snapshot, risk score, risk band, score_model_version, started/finished timestamps).
- `prospect_scan_sources` — one row per source attempted per scan: source key, state (`connecting`/`scanning`/`results_found`/`no_results`/`unavailable`/`not_scanned`), provider id, queries run, raw result count, failure reason. This table *is* the source rail; the UI renders nothing it cannot read here.
- `prospect_scan_events` — append-only job event log (message, stage, level, created_at) driving the live terminal via realtime.
- `prospect_discoveries` — every retrieved candidate: url, canonical_url, platform, title, snippet, published_at, discovered_at, provider, query, identity tier + confidence + matched/failed signals.
- `prospect_findings` — classified findings referencing a discovery: stage (01–06), category, severity, detection reason, confidence, evidence status, verification state (`discovered` / `human_verified` / `eligible_for_response`), staff classification.
- `prospect_finding_evidence` — stored excerpt, screenshot/capture path, content hash, observed_at, provenance.
- `prospect_propagation_clusters` + `prospect_cluster_members` — duplicate/reupload grouping by canonical URL, title/text similarity and image/video hashes; earliest-discovered member flagged (never labelled "original").
- `prospect_risk_scores` — factor-by-factor breakdown + model version, so "Why this score?" reads from stored rows.
- `prospect_staff_decisions` — audit log: who, finding, previous state, new state, reason, timestamp.

New server code
- `src/lib/prospect/` — orchestrator server functions: `startProspectScan`, `getProspectScan` (polling/realtime companion), `classifyProspectFindings`, `recordStaffDecision`, `buildProspectReport`, `handoffToEnrollment`.
- `src/routes/api/public/hooks/prospect-scan-worker.ts` — background worker for long-running stages (same pattern as the existing deepfake/copyright workers), authenticated by the existing internal cron-secret mechanism.
- Deterministic scorer `src/lib/prospect/risk-model.ts` with a version constant and unit tests.

New routes / components
- `/staff` (boot sequence) → `/staff/scan` (search screen) → `/staff/scan/$scanId` (single full-screen live interface with the left stage rail).
- `StaffGuard` (mirrors `AdminGuard`, role `staff` or `admin`/`super_admin`).
- `BootSequence`, `SourceRail`, `StageRail`, `LiveEventTerminal`, `IdentityGraph`, `FindingCard`, `EvidenceDrawer`, `RiskScoreExplainer`, `FinalSummary`.

## Access and roles

- Migration adds `'staff'` to the `app_role` enum (current values: admin, analyst, user, super_admin, partner).
- Seed: insert `('staff')` role row for the auth user with email `hellosreehari@gmail.com` (looked up by email inside the migration; no-op if absent).
- RLS on every `prospect_*` table: `USING (public.has_role(auth.uid(),'staff') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))`. No `anon` grants. `GRANT SELECT/INSERT/UPDATE ON ... TO authenticated`, `GRANT ALL ... TO service_role`.
- Every server function guarded by `requireSupabaseAuth` + an explicit staff-role check read through the user's own client (never the admin client).
- Client/celebrity accounts get no route, no grant and no policy match — the tool is invisible and unreadable to them.

## Source reality check (verified against configured credentials)

Queryable today
- Google Programmable Search — `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` present.
- Brave Search (web + images) — `BRAVE_API_KEY` present.
- Firecrawl (search/scrape) — `FIRECRAWL_API_KEY` present.
- Gemini grounding — `GEMINI_API_KEY` present.
- YouTube Data API — `YOUTUBE_API_KEY` present.
- Crawler service (page crawl, screenshots, frames, image hashing/matching) — `CRAWLER_SERVICE_URL` present; live `/health` probe decides availability per scan.
- Google Fact Check — `FACT_CHECK_API_KEY` present.
- Wikipedia/Wikidata and DuckDuckGo HTML — keyless.
- News — via the search providers with news-oriented queries and domain classification (no dedicated news API).

Must render "Unavailable — not scanned" unless a credential/permission is added
- Instagram — HikerAPI code exists but `HIKERAPI_ACCESS_KEY` is not set and `HIKERAPI_ENABLED` is off (opt-in by design). Indexed Instagram URLs found via web search are still shown, labelled as web-discovered, not as an Instagram API scan.
- SerpApi — no key configured (`SERPAPI_API_KEY` absent).
- Facebook, X/Twitter, TikTok — no API access and no lawful crawl path. Shown as Unavailable with reason "No permitted API access". Public URLs surfaced through web search appear under Web with the correct platform label.
- Reddit — no Reddit API credential; additionally the standing project rule is to never monitor Reddit as a source, so it renders permanently as Not scanned (policy).
- Face/image similarity on discovered media uses the crawler's perceptual hashing and the existing Rekognition path only where an enrolled reference exists; for prospects with no lawful reference image, image similarity shows "Not available for prospects".

Secrets to add later if these sources are wanted: `HIKERAPI_ACCESS_KEY` + `HIKERAPI_ENABLED=true`, `SERPAPI_API_KEY`, and any official Meta/X/TikTok platform credentials. Nothing new is required for phase 1.

## Phases

Phase 1 — Data + access (backend)
Migration: `staff` role + seed, all `prospect_*` tables with grants, RLS, indexes, `updated_at` triggers. Realtime enabled on `prospect_scan_events`, `prospect_discoveries`, `prospect_findings`.

Phase 2 — Scan engine (backend)
Session creation with identity lock; provider-coverage planning that writes one `prospect_scan_sources` row per source with its real initial state from live health probes; discovery through the existing router + YouTube + image providers; every retrieved hit persisted before any UI count changes; event rows written with the exact job messages ("Searching YouTube", "Analysing 8 candidate videos", …).

Phase 3 — Identity resolution + stage analysis (backend)
Identity scoring first (Strong/Probable/Possible/Uncertain); Uncertain routed to "Needs Identity Verification" and excluded from all risk totals. Then stages 01–06 classification using the existing analysers, with conservative wording rules enforced in code (no "deepfake" from a score, no allegation stated as fact, no "defamation" label). Propagation clustering + earliest-discovered flag. Deterministic risk score written with its factor breakdown and model version.

Phase 4 — Live interface (UI)
Boot sequence driven by real health checks (auth session, crawler `/health`, provider health report) with `prefers-reduced-motion` support and a skip control; search screen; full-screen stage interface with source rail, live terminal, evidence cards streaming in from realtime, counters derived from stored rows, empty states with the exact approved copy.

Phase 5 — Verification, summary, actions (UI + backend)
Evidence drawer on every finding; three-state verification with staff approve/reject/reclassify and audit rows; "Digital Exposure Intelligence — [NAME]" summary; "Why this score?"; actions Create Pre-Enrollment Report, Begin Client Enrollment (hands the locked identity + staff-selected findings to the existing onboarding/enrollment functions, no re-search), Add to Prospect, Review Findings, Rescan.

Phase 6 — Verification pass
Unit tests for the risk model, identity mapping and cluster grouping; an end-to-end run against a real query with assertions that displayed counts equal stored row counts and that no unconfigured source ever reports "scanned"; typecheck, lint, build.

## Known limitations to state in the UI

- Social platforms without API access are genuinely not scanned; coverage is web-indexed only for those.
- Manipulation signals are indicative, never a verdict — every such finding requires human verification before it can become "Eligible for Response".
- Search-reputation percentages are computed only over results actually analysed in that scan, and the sample size is shown alongside them.
- Nothing in this tool triggers enforcement; records enter the client workflow only after authorization and enrollment.
