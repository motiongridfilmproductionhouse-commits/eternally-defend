## Onboarding & Authorization Workflow

Build a mandatory 8-step onboarding gate that blocks access to monitoring/enforcement features until the user completes profile, asset registration, consent, and digital signature. Persist everything in Lovable Cloud with audit trails, and gate enforcement actions by `authorization_level`.

### 1. Database (single migration)

New tables (all RLS-scoped to `auth.uid()`, with `GRANT` blocks + `updated_at` triggers):

- `client_profiles` — one row per user
  - `user_id` (PK, FK → auth.users)
  - `client_type` enum: `individual | celebrity | creator | business | corporate | agency`
  - `account_type` (derived: `personal | business`)
  - `onboarding_completed` bool, `onboarding_step` int, `onboarding_version` text
  - Individual fields: `full_name, email, phone, country, gov_id_ref, social_profiles jsonb`
  - Business fields: `company_name, website, contact_person, business_reg_number, company_email, official_socials jsonb`
  - `authorization_level` enum: `monitoring | monitoring_evidence | monitoring_enforcement | full_protection`
  - `authorization_status` enum: `pending | authorized | enterprise_authorized`

- `onboarding_assets` — protected assets registered during Step 3
  - `asset_kind` enum: `name | brand | company | product | social_account | youtube_channel | website | logo | image | video | copyright`
  - `label, value, url, storage_path, metadata jsonb`

- `authorization_records` — signed consent (immutable; insert-only from client)
  - `consent_version, onboarding_version`
  - `consents jsonb` (5 required checkboxes with individual bool + timestamp)
  - `authorization_level`
  - `legal_name, signature_text, signed_at, ip_address, user_agent`
  - `signature_hash` (SHA-256 of canonical payload)
  - `active` bool (latest active record per user)

- `enterprise_documents` — uploads for agencies/corporate
  - `doc_type` enum: `authorization_letter | agency_agreement | power_of_attorney | brand_protection`
  - `storage_path, filename, mime, size_bytes, uploaded_at`

- `onboarding_audit_log` — every step transition + consent event
  - `event_type, step, payload jsonb, ip_address, user_agent, created_at`

Storage bucket: `authorization-vault` (private) for gov ID scans, logos, and enterprise documents. RLS on `storage.objects` scoped by `{user_id}/...` path prefix.

### 2. Server functions (`src/lib/onboarding.functions.ts`)

All use `requireSupabaseAuth`:

- `getOnboardingState` — returns profile + latest active authorization record
- `upsertClientProfile({ step, data })` — writes step data, advances `onboarding_step`, appends audit log
- `addProtectedAsset` / `removeProtectedAsset` / `listProtectedAssets`
- `uploadEnterpriseDocument` (returns signed upload URL) / `listEnterpriseDocuments`
- `submitAuthorization({ consents, authorization_level, legal_name, signature_text })` — captures IP from request headers, computes signature hash, inserts `authorization_records` (deactivates prior), sets `onboarding_completed=true`, marks `authorization_status`
- `getAuthorizationRecord(id)` — for report/complaint export

### 3. Onboarding UI

New route `src/routes/_app.onboarding.tsx` — 8-step wizard using existing shadcn `Card`, `Button`, `Input`, `Checkbox`, `RadioGroup`, `Progress`. One component per step under `src/components/onboarding/`:

`Step1ClientType`, `Step2Info` (branches on client_type), `Step3Assets`, `Step4Consent` (5 checkboxes, all required), `Step5Authorization` (radio), `Step6Signature` (typed legal name + signature canvas fallback to typed script font, auto-fills date/IP/timestamp), `Step7VaultSummary` (read-only receipt), `Step8Enterprise` (only for `business | corporate | agency`, otherwise skipped).

Progress bar + Back/Next. Steps validated with Zod.

### 4. Gating

- **Route-level:** modify `src/routes/_app.tsx` `beforeLoad` — after auth check, fetch `onboarding_completed`; if false and pathname is not `/onboarding`, `throw redirect({ to: "/onboarding" })`. Skip redirect on `/settings` to allow logout.
- **Action-level:** new helper `useAuthorization()` hook exposes `{ canMonitor, canCollectEvidence, canRequestEnforcement, canTakedown, status }`. Update `src/routes/_app.enforcement.tsx`, `_app.removals.tsx`, and any "Send takedown" buttons to disable + show tooltip "Requires enforcement authorization" when `authorization_level` insufficient.

### 5. Status badge

New `AuthorizationBadge` component rendered in `TopBar`:
- ✓ Authorized (green) — any completed authorization
- ✓ Monitoring Only / Enforcement Authorized / Enterprise Authorized (variant per level)
- ⚠ Pending — if not completed

### 6. Reports integration

Extend `_app.reports.tsx` with a "Legal & Authorization" section that lists `authorization_records` with a "Download signed authorization" action (renders a PDF via existing PDF utilities or a simple print stylesheet including consent text, signature, IP, timestamp, and hash).

### Technical notes

- IP captured server-side from `x-forwarded-for` / request headers inside `submitAuthorization` handler (never trusted from client).
- Signature hash: `sha256(JSON.stringify({ user_id, consents, authorization_level, legal_name, signed_at }))` stored for tamper evidence.
- `authorization_records` policy: `INSERT` by owner allowed; `UPDATE`/`DELETE` denied (immutable audit).
- Consent/onboarding version constants in `src/lib/onboarding-versions.ts` — bump when copy changes to force re-consent.
- All new tables get `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO authenticated` + `GRANT ALL ... TO service_role`; no `anon`.
- Existing `AdminGuard`/`useUserRoles` untouched; onboarding is orthogonal to admin roles.

### Out of scope (call out to user)

- Real legal review of consent copy (uses provided text verbatim).
- Actual gov ID verification / KYC provider integration — stored as uploaded file only.
- Automated re-consent flow on version bump beyond redirecting to `/onboarding` when versions differ.
