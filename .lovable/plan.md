
# Impersonation Intelligence & Identity Protection Engine

Build a continuous digital identity protection layer on top of Eterna's existing scanning, AWS Rekognition, YouTube, evidence, and enforcement infrastructure. No Reddit. No mocks.

## Scope decisions

- Reuse: Supabase auth + RLS, onboarding/KYC, AWS Face Liveness enrollment, `rekognition_collections` / `protected_face_profiles`, YouTube Data API, existing scan orchestration (`scans`, `scan_hits`), `evidence_vault_items`, `enforcement_requests` / `_targets`, alerts/notifications, S3 evidence bucket.
- New only where Eterna has no equivalent (identity fingerprint, candidate lifecycle, explainable score, allowlist decisions, side-by-side compare).
- Skip: Reddit adapter, any CAPTCHA bypass, any biometric exposure to frontend.

## Data model (new tables, all `public`, RLS scoped to `auth.uid()` via `client_profiles`; standard grants + service_role)

- `protected_identities` — one per client. Legal name, stage name, aliases[], bio keywords[], org names[], face_ref_id (FK to `protected_face_profiles`, nullable), biometric_consent bool, created/updated.
- `protected_identity_aliases` — normalized name/username variants + mutation type (typo, unicode, handle_variant, added_word).
- `official_accounts` — platform, handle, canonical_url, account_id, status enum(`OFFICIAL|AUTHORIZED|FAN|PARODY|SAFE|IMPERSONATOR|UNKNOWN`), verified_by_client bool, verified_at.
- `protected_identity_assets` — asset kind (photo, logo, domain), sha256, phash, s3_key, embedding_ref (nullable), source.
- `impersonation_scan_jobs` — identity_id, status, started/finished, provider health snapshot, dedupe cursor.
- `impersonation_candidates` — stable_key (platform + external_id), platform, url, handle, display_name, avatar_ref, bio_text, discovered_via, first_seen, last_checked, raw_payload jsonb.
- `impersonation_findings` — candidate_id, identity_id, score (0-100), classification enum, signal_breakdown jsonb (per-signal score + evidence pointer), decision enum(`PENDING|SAFE|FAN|PARODY|IMPERSONATOR|MONITOR`), decided_by, decided_at.
- `impersonation_evidence` — finding_id, kind, s3_key, hash, captured_at (thin wrapper linking into `evidence_vault_items`).
- `suspicious_domains` — domain, identity_id, homograph_of, whois jsonb, ssl jsonb, risk_score, evidence_ref.
- `fake_endorsement_analyses` — candidate_id, product_category, transcript_ref, ocr_ref, manipulation_signals jsonb, score.

Migration also adds triggers for `updated_at` and unique `(identity_id, stable_key)` on candidates for dedupe.

## Server functions (all `createServerFn` + `requireSupabaseAuth`; admin client only inside handlers)

Location: `src/lib/impersonation/*.functions.ts` + `.server.ts` helpers.

- `identity.functions.ts`: `createFingerprint`, `updateFingerprint`, `listOfficialAccounts`, `upsertOfficialAccount`, `markCandidateDecision`.
- `discovery.server.ts`: `generateIdentityQueries` (name/handle mutations, unicode confusables via `unicode/confusables` map, typo substitution), `discoverCandidates` (YouTube channel/video search, Firecrawl web search, Google web search where configured — provider registry with health tracking, per-provider timeout + retry).
- `similarity.server.ts`: Levenshtein, Jaro-Winkler, token, unicode-normalized, handle mutation scoring. Pure TS, unit-testable.
- `image-analysis.server.ts`: sha256 exact, pHash (blockhash pure-JS), Rekognition `SearchFacesByImage` against client collection when consent present, OCR via existing multimedia pipeline.
- `bio-behavior.server.ts`: deterministic rule pack for identity-claim / fraud / fan / parody / external-contact signals; returns structured booleans + supporting spans. Optional LLM assist via Lovable AI (Gemini) with strict JSON schema for edge cases.
- `domain-analysis.server.ts`: homograph + typosquat + added-word detection, whois/DNS/SSL via existing web providers where available.
- `endorsement-analysis.server.ts`: keyframes + OCR + transcript reuse from existing multimedia jobs; product/financial category classifier; manipulation flag pass-through.
- `scoring.server.ts`: weighted score with modifiers, returns `{ score, level, reasons: [{signal, weight, contribution, evidence}] }`. CRITICAL requires ≥2 independent identity signals + ≥1 deception signal.
- `scan.functions.ts`: `impersonationScan` orchestrator running the required pipeline; writes findings, calls existing evidence + alert systems for HIGH/CRITICAL only.
- `evidence.functions.ts`: `captureFindingEvidence` — screenshot via existing capture path, upload to S3 evidence bucket, hash, insert into `evidence_vault_items` + `impersonation_evidence`.
- `enforce.functions.ts`: `startEnforcement` — creates `enforcement_requests` + `enforcement_targets` reusing existing takedown workflow; requires explicit user confirm + authorization check.

Provider failures are recorded in `provider_health_checks` and surfaced; never silently succeed.

## Server routes (public API surface)

All under `src/routes/api/identity/` and `src/routes/api/impersonation/` as file routes calling the server functions above; auth enforced via bearer + `requireSupabaseAuth` inside handlers. No `/api/public/*` — this is tenant data.

## Frontend

New route group under `src/routes/_authenticated/identity/`:

- `index.tsx` — Overview: identity status, counts by level, new-since-last-scan, last/next scan, scan-now button.
- `impersonation.tsx` — candidate list with filters + `CandidateCard` component (score, matches breakdown, actions).
- `fake-accounts.tsx`, `fake-endorsements.tsx`, `suspicious-domains.tsx` — filtered views over findings.
- `evidence.tsx` — links into existing Evidence Vault filtered to identity findings.
- `enforcement.tsx` — filtered enforcement queue.
- `$candidateId.tsx` — side-by-side identity comparison (Official vs Suspected), full signal breakdown, action bar.

Components: `CandidateCard`, `SignalBreakdown`, `IdentityCompare`, `ScoreBadge`, `DecisionMenu`, `ScanStatusBar`. Reuse existing DetailDrawer / ActionDrawer patterns from scan results.

Sidebar: add "Identity Protection" section with the sub-nav above.

## Pipeline (matches spec §19)

`impersonationScan(identityId)`:
1. loadProtectedIdentity
2. generateIdentityQueries
3. discoverCandidates (parallel providers, health-tracked)
4. deduplicateCandidates (stable_key upsert)
5. checkOfficialAllowlist (skip / auto-classify)
6. analyzeNameAndUsername
7. analyzeImages (hash + phash + Vision Web if configured)
8. analyzeFaceIfAuthorized (Rekognition only when consent)
9. analyzeBioAndBehavior
10. analyzeDomains (candidate-linked)
11. analyzeFakeEndorsementSignals (video/ad candidates)
12. calculateExplainableRisk
13. saveFinding (upsert per candidate)
14. captureHighRiskEvidence (HIGH/CRITICAL only)
15. triggerAlerts (existing notifications)
16. monitorStatus (schedule next check)

Scheduling via `pg_cron` → `/api/public/hooks/impersonation-rescan` route which iterates due identities and calls `impersonationScan`. Route verifies apikey header.

## Guardrails (spec §20)

- No Reddit provider registered.
- Provider errors classified and surfaced; distinct from zero results.
- Face/image similarity alone caps score at SUSPICIOUS unless deception signal present.
- Fan/parody disclosure downgrades classification and blocks auto-enforcement.
- Enforcement requires human confirm + existing authorization check.
- No new secrets required — reuses AWS, YouTube, Google, Firecrawl secrets already configured. Lovable AI used for bio classification via existing `LOVABLE_API_KEY`.

## Test coverage

Deterministic unit tests for similarity, unicode confusables, mutation generator, scoring (each spec case: official exclusion, look-alike handle, unicode, stolen photo, face match, fan, parody, fake WhatsApp, fake investment, fake endorsement, suspicious domain, provider failure, zero results, duplicate, removed content, rescan). Integration test for pipeline with mocked providers.

## Delivery order

1. Migration (tables + grants + RLS + triggers).
2. Similarity + scoring pure modules + unit tests.
3. Provider adapters + discovery + dedupe.
4. Analysis modules (name, image, face, bio, domain, endorsement).
5. Orchestrator + evidence + alerts + enforcement wiring.
6. Server functions + routes.
7. UI: overview → candidate list → compare view → sub-tabs.
8. Cron rescan route + schedule.
9. Typecheck + build + test pass.

Given the size, this ships in the above order across the turn; UI sub-tabs beyond Overview/Impersonation/Compare land as thin filtered views over the same finding store.
