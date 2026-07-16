## Eterna Verified Client Onboarding — Implementation Plan

Build the full 10-step verified onboarding journey on top of existing integrations (Veriff, AWS Rekognition/S3, YouTube, Supabase). No new secrets, no frontend AWS/Veriff calls.

### Scope

Replace the current onboarding wizard with a premium multi-step flow that gates each step on real verification results, culminating in an admin-reviewed Authorization Letter, signed PDF, Verification Certificate, and public verify page.

### Database (single migration)

New tables (RLS: owner-only for clients, `has_role(_,'admin')` for admins; all with GRANTs):

- `onboarding_progress` — per-user step status map, current_step, overall status enum
- `kyc_verifications` — veriff_session_id, provider_reference, status, country, document_type, review_reason (no images)
- `biometric_consents` — consent_version, ip, ua, checkboxes, revoked_at
- `protected_face_profiles` — collection_id, rekognition_user_id, liveness_score, status
- `protected_face_references` — profile_id, s3_key, face_id, quality scores
- `digital_assets` — kind (youtube/…), channel_id, handle, name, verified, method, verified_at
- `youtube_verification_challenges` — code, asset_id, expires_at, used_at, evidence
- `asset_verification_events` — audit trail per asset
- `authorization_scopes` — auth_id, scope_key, granted
- `client_authorizations` — auth_number (AUTH-YYYY-NNNNNN), version, status enum, effective/expiry, enforcement_enabled
- `authorization_versions` — snapshot json per version
- `authorization_signatures` — signer name/role, drawn_signature_svg, typed_name, otp_verified_at, ip, ua, sha256
- `authorization_documents` — kind (draft/signed/certificate/package), s3_key, sha256
- `authorization_admin_reviews` — reviewer_id, decision, notes, decided_at
- `verification_certificates` — cert_number (ETC-…), score, issued_at, expires_at, sha256, public_slug
- `authorization_audit_logs` — actor, action, target, payload, ip, ua
- Extend `client_profiles` with: `client_id` (ET-#####), `display_name`, `role_title`, `address`, `phone_verified_at`, `email_verified_at`

Add `has_role(_,'admin')` policies alongside owner policies. Reuse existing `user_roles`/`app_role` enum.

Sequences for `client_id`, authorization number, certificate number.

### Server functions (all server-only, using existing env)

`src/lib/onboarding/`:

- `progress.functions.ts` — get/update step status, resume
- `profile.functions.ts` — save profile, mint `ET-#####`, send email OTP (via Supabase auth OTP)
- `kyc.functions.ts` — `createVeriffSession` (POST to `${VERIFF_BASE_URL}/sessions` with `X-AUTH-CLIENT`, HMAC signed), `getKycStatus`
- `src/routes/api/public/veriff-webhook.ts` — verify `x-hmac-signature` with `VERIFF_SHARED_SECRET`, update `kyc_verifications`
- `face-enrollment.functions.ts` — `recordBiometricConsent`, `createLivenessSession` (Rekognition `CreateFaceLivenessSession`), `finalizeLiveness` (calls `GetFaceLivenessSessionResults`, stores reference image + audit frames to S3 private, `IndexFaces` into per-user collection, associates to Rekognition UserId, persists face_ids); `revokeBiometrics` (DeleteFaces + S3 delete)
- `assets.functions.ts` — add asset, list, remove, `generateYouTubeChallenge` (crypto-random `ETERNA-XXXX-YYYY`), `verifyYouTubeChallenge` (YouTube Data API v3: channels.list snippet+description; search channel's latest videos & community posts for the code), Google OAuth path via existing `lovable.auth.signInWithOAuth('google', scopes: youtube.readonly)` then `youtube.channels.list?mine=true`
- `authorization.functions.ts` — `buildDraft`, `generateDraftPdf`, `sendSignatureOtp`, `verifySignatureAndSeal` (renders final PDF, SHA-256, uploads to S3, creates `authorization_documents`, `authorization_signatures`), version bump on edits
- `admin.functions.ts` — `listPendingReviews`, `decideAuthorization` (approve/reject/suspend/revoke/request-info), guarded by `has_role(admin)`
- `certificate.functions.ts` — `issueCertificate` (score calc, PDF w/ QR to public page, SHA-256, S3), `getPublicVerification(slug)`
- `package.functions.ts` — `buildAuthorizationPackage` (concat cert + summary + signed letter + audit → PDF, S3)

PDF generation: reuse `src/lib/enforcement/pdf.server.ts` pattern (pdf-lib). QR: `qrcode` package.

### Frontend routes/components

- Rewrite `src/routes/onboarding.tsx` shell with stepper (10 steps, statuses)
- `src/components/onboarding/steps/` — one component per step:
  1. `AccountProfileStep` (form + email OTP)
  2. `KycStep` (Veriff hosted URL iframe/redirect, polls status)
  3. `FaceEnrollmentStep` (consent screen → premium liveness UI using AWS Amplify `FaceLivenessDetector` React component, which talks to backend session tokens only; framer-motion overlays for mesh/scan-line/particles; guidance messages)
  4. `AssetVerificationStep` (YouTube: OAuth or code challenge UI)
  5. `AuthorizationScopeStep` (checkbox list)
  6. `AuthorizationReviewStep` (PDF preview iframe of signed URL)
  7. `SignatureStep` (typed name + `react-signature-canvas` + email OTP)
  8. `AdminReviewWaitingStep` (status card, polling)
  9. `CertificateStep` (view/download cert + package + public link)
  10. `CompleteStep` (summary + dashboard CTAs)
- `src/routes/_app.admin.onboarding-reviews.tsx` — admin review queue + detail (uses existing `AdminGuard`)
- `src/routes/verify.$authId.tsx` — public route (top-level, no auth), shows sanitized status only via `getPublicVerification`

### Packages to add

`@aws-sdk/client-rekognitionstreaming` (for FaceLiveness types), `@aws-amplify/ui-react-liveness`, `aws-amplify`, `qrcode`, `pdf-lib` (may already be present), `react-signature-canvas`.

### Security

- All AWS/Veriff/Google-secret calls inside `.server.ts` or handler bodies
- Webhook signature verification (HMAC-SHA256) with timing-safe compare
- Signed S3 URLs, 5-min expiry, never returned to public verify page
- RLS: owner-only + admin role; public verify uses server-publishable client with narrow anon SELECT on a `public_verifications` view exposing only safe columns
- Audit log on every sensitive action
- Immutable signed docs; version bump on any post-sign change

### Gating rules

Step N cannot start until N-1 status ∈ {VERIFIED, COMPLETED}. `enforcement_enabled` only when all conditions in spec are true. Certificate score computed server-side.

### Explicitly deferred (per spec)

Continuous scanning, deepfake, adult content, auto-takedowns, mass reporting, scheduler.

### Delivery order (single build)

1. Migration (tables, enums, sequences, RLS, GRANTs, admin policies)
2. Server functions + webhook route + package installs
3. Onboarding shell + steps 1–4
4. Steps 5–7 (scope, letter, signature)
5. Admin review + certificate + package + public verify
6. Wire completion screen and dashboard entry points

This is a large single delivery (~30 files). No mocks: every status comes from Veriff/Rekognition/YouTube/DB.
