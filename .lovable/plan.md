
# Enforcement Browser Automation — v1

Answers confirmed: external Node worker service, YouTube (copyright + community) first, per-client platform accounts, human-in-the-loop submission for non-API paths.

## Architecture

```text
Eterna Worker (Cloudflare)                External Node Service (Fly.io/VM)
────────────────────────────               ─────────────────────────────────
Enforcement UI ──► enqueue job ──► Supabase table `automation_jobs`
                                             │
                                             │ pg_net webhook (or long-poll)
                                             ▼
                                   Playwright worker picks up job
                                             │
                                             ├─ Fetch case bundle (evidence pkg
                                             │  + client + match) via Eterna
                                             │  server fn (service-role bearer)
                                             ├─ Decrypt per-client platform creds
                                             ├─ Restore browser context (profile
                                             │  + storageState) for that client
                                             ├─ Adapter (YouTube copyright/CGC)
                                             │  navigates → fills → uploads
                                             │  → validates → screenshots
                                             ├─ Stops at Review screen
                                             │  (uploads review bundle to
                                             │  `enforcement-packages` bucket)
                                             └─ Writes audit rows + status
                                                back to Supabase
                                             │
Eterna UI polls status ◄──────────────────────
Operator opens live browser session (CDP URL)
to click final Submit, or approves via UI for
API-backed YouTube Content ID cases.
```

The Playwright service is a separate deployable at `services/enforcement-worker/` in this repo (new folder), packaged for Node 20 + Playwright + Chromium. Not deployed by Lovable — user hosts it. Eterna talks to it only via the shared Supabase queue.

## Database

New migration adds:

- `platform_credentials` — per-client, per-platform encrypted vault.
  Columns: `user_id`, `platform` (`youtube`|…), `label`, `storage_state_ciphertext` (Playwright `storageState` JSON, AES-256-GCM), `login_email_ciphertext`, `mfa_hint`, `status` (`active`|`expired`|`login_required`), `last_verified_at`, timestamps. RLS: owner-only via `auth.uid()`; service-role full. Encryption key: reuse `APP_USER_CONNECTION_KEY_SECRET` pattern (new secret `ENFORCEMENT_VAULT_SECRET` if not present — generated via `generate_secret`).
- `automation_jobs` — queue.
  Columns: `user_id`, `enforcement_request_id`, `platform`, `adapter` (`youtube_copyright`|`youtube_community`|…), `status` (`queued`|`running`|`review_ready`|`submitted`|`failed`|`cancelled`), `worker_id`, `attempts`, `input_json`, `review_summary_json`, `review_bundle_path`, `cdp_ws_url` (short-lived for live handoff), `error_json`, `last_screenshot_path`, `started_at`, `completed_at`, timestamps. RLS owner-only + service-role.
- `automation_events` — structured audit log.
  Columns: `job_id`, `user_id`, `event` (`browser_started`|`auth_restored`|`form_opened`|`client_data_loaded`|`evidence_uploaded`|`validation_completed`|`review_generated`|`submission_started`|`submission_completed`|`error`), `platform`, `duration_ms`, `result`, `payload_json`, `screenshot_path`, `created_at`. RLS owner-only + service-role.
- Extend `enforcement_requests`: add `automation_job_id`, `automation_status`, `human_submitted_at`, `human_submitted_by`.

All new tables get GRANTs for `authenticated` (owner rows via RLS) and `service_role` (worker service). Public bucket `enforcement-packages` already exists; new `enforcement-screenshots` private bucket for step-by-step captures.

## Eterna-side code

- `src/lib/automation/vault.server.ts` — encrypt/decrypt platform storageState + creds (AES-256-GCM, same pattern as `connectionKeyCrypto`).
- `src/lib/automation/jobs.functions.ts` — server fns:
  - `enqueueAutomationJob({ enforcementRequestId, adapter })` — validates case is `Ready`, authorization active, evidence present; inserts `automation_jobs` row; returns job id; fires `pg_net` webhook to worker service.
  - `getAutomationJob(id)`, `listAutomationJobs()`, `cancelAutomationJob(id)`.
  - `markHumanSubmitted(id)` — operator confirms they clicked Submit; updates enforcement + job status; writes `submission_completed` event.
  - `saveCredentialVault({ platform, storageState, email, mfaHint })` — encrypts + upserts.
  - `getCredentialForWorker(jobId, workerToken)` — service-role-only, called by worker with shared secret header, returns decrypted storageState for one job.
- `src/routes/api/public/hooks/automation-status.ts` — worker POSTs status/events/screenshots back here (HMAC verified with `AUTOMATION_WORKER_SECRET`).
- `src/routes/api/public/hooks/automation-fetch.ts` — worker GETs job payload + decrypted creds (same HMAC).

## Adapters (worker side, `services/enforcement-worker/src/adapters/`)

- `PlatformAdapter` interface: `authenticate(ctx)`, `navigateToForm(ctx, case)`, `populate(ctx, case)`, `uploadEvidence(ctx, files)`, `validate(ctx)`, `generateReviewSummary(ctx)`, `submit(ctx)` (optional; only if official API).
- `YouTubeCopyrightAdapter` — form-based (`youtube.com/copyright_complaint_form`), fills owner/representative/original URL/infringing URL/description/good-faith + accuracy checkboxes, uploads evidence PDF and ZIP, stops at Review. No auto-submit.
- `YouTubeCommunityAdapter` — community guideline reports on the video page; opens 3-dot menu → Report → correct category → fills description → stops at Review.
- Config-driven selectors in `adapters/selectors/youtube.json` (versioned so ToS-safe updates don't need code changes).

## Worker service

`services/enforcement-worker/` contents:

- `package.json` (Node 20, `playwright`, `pino`, `zod`, `@supabase/supabase-js`)
- `src/index.ts` — HTTP server: `/run` (webhook trigger), `/health`; also long-poll fallback.
- `src/runner.ts` — job lifecycle: browser context per client (persistent profile at `/data/profiles/{user_id}/{platform}`), storageState decrypted from vault, retries with exponential backoff, screenshot on any error, timeouts configurable.
- `src/audit.ts` — every state transition POSTs to Eterna's `automation-status` hook (HMAC signed).
- `src/session.ts` — detects login-required / session-expired / MFA states; marks credential row `login_required`; a separate operator-driven "Refresh Session" UI captures a fresh storageState via a manual browser hand-off.
- `Dockerfile` + `fly.toml.example` — deploy instructions in `services/enforcement-worker/README.md`.
- Vitest suites for adapter unit tests + a Playwright integration test hitting a mock form.

## Eterna UI

Extend `src/routes/_app.enforcement.tsx` (or a new sub-route `_app.enforcement.automation.tsx`):

- Per-request row: **Run Automation** action (only when case status is Ready + authorization active).
- Job drawer with:
  - Live status timeline from `automation_events`
  - Step-by-step screenshot strip
  - Validation report
  - Review summary card (client, original, match, evidence checklist, timestamp)
  - **Open in Browser** button — opens the worker's short-lived CDP WebSocket URL in a new tab (Playwright's built-in inspector or an embedded noVNC page from the worker) so the operator visually confirms and clicks Submit
  - **Mark as Submitted** — writes `markHumanSubmitted`
- New `_app.settings.platform-credentials.tsx` — per-client vault: "Connect YouTube account", captures storageState by loading a hosted worker page that runs a login browser, then encrypts + saves.

## Secrets

- `ENFORCEMENT_VAULT_SECRET` — 32-byte base64, generated via `generate_secret`. Used both by Eterna (encrypt on save) and the worker (decrypt on run — fetched from Eterna over HMAC-authed hook, never stored on worker disk).
- `AUTOMATION_WORKER_SECRET` — HMAC shared secret between Eterna hooks and worker. Generated via `generate_secret`.
- Worker service reads only its own `SUPABASE_URL`, `ETERNA_HOOK_URL`, `AUTOMATION_WORKER_SECRET` from its host env — no service-role key on the worker; it always calls Eterna's public hooks with HMAC.

## Security

- Credentials never in code, never in logs.
- `storageState` encrypted at rest (Supabase text column, AES-256-GCM).
- Worker profile directory encrypted at the host FS level (Fly volume with LUKS or equivalent — documented in README).
- All privileged Eterna hooks HMAC-verified + IP allowlist optional.
- Audit rows written for every event listed in the spec, immutable (no UPDATE policy — insert-only for `authenticated`, service-role only for the worker).
- RBAC: only users with `has_role('operator')` or owner can run automation jobs against their own cases.

## Rollout order (single build turn is not enough — this is a 3-batch delivery)

**Batch 1 (this turn):** Migration + Eterna server fns + status/fetch hooks + minimal UI (enqueue + status drawer + Mark Submitted) + secrets. Playwright worker service scaffolded with README but not deployable yet.

**Batch 2:** YouTube adapters (copyright + community), worker runner + audit, credential vault UI (capture storageState via worker-hosted login page), unit tests.

**Batch 3:** Live CDP handoff, screenshot strip, retry/backoff, integration tests against a self-hosted mock YouTube form, hardening.

I'll deliver Batch 1 in this turn and stop for review before Batch 2. That keeps the diff reviewable and lets you deploy the worker host in parallel.

## Technical notes / caveats

- **YouTube ToS.** Automating logins to real YouTube accounts sits in a grey area; the spec's "official integrations only for submit" clause is what keeps this defensible. The copyright complaint form is publicly reachable and the flow just fills fields the operator would fill anyway, stopping at Review. Content ID API access (auto-submit) requires YouTube partner approval — feature-flagged, off by default.
- **Per-client credentials + MFA.** Realistically each client onboards their YouTube account once via a supervised browser hand-off (worker opens a Chromium window, client logs in with MFA, worker snapshots `storageState`, uploads encrypted). Automation later replays that state. When YouTube kills the session, the job fails with `login_required` and the UI prompts the client to re-onboard.
- **No auto-submit** on YouTube web forms; the "officially supported integration" clause is honored strictly.
- **Not deployed by Lovable.** The worker service is a separate deployable. Lovable ships the code + Dockerfile + Fly template; you deploy it.
