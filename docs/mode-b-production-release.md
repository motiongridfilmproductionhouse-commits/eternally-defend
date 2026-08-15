# MODE B — Production Release Record

Status: **PRODUCTION READY — PUBLIC REFERENCE + CUSTOMER-SUPPLIED MEDIA PROTECTION**

Frozen baseline. Do not modify this pipeline unless a real production defect is found.

## Frozen funnel

```text
PUBLIC_REFERENCE -> SELF_DECLARED -> public-only retrieval
  -> Protect from Link (where publicly accessible)
  -> Upload Required (when the platform blocks retrieval)
  -> manual original-media upload
  -> fingerprint / video keyframes -> dedupe
  -> owner-scoped protected asset -> Autopilot enrollment
  -> continuous protection when rights-holder authorization permits
```

Preserved unchanged: PUBLIC_REFERENCE semantics, `connected_at = null`, no
Instagram OAuth/login requirement, public-only retrieval, manual-upload
fallback, PUBLIC_LINK and MANUAL_UPLOAD provenance, SELF_DECLARED ownership
basis, pHash/dHash/aHash, video keyframe pipeline, deduplication, owner-scoped
storage/RLS, identity and reference signals, matching thresholds, enforcement
gates, fail-closed authorization behavior.

## Customer-facing status vocabulary (only these)

Public reference · Processing · Fingerprint ready · Protection active ·
Protection waiting for authorization · Upload required · Failed

A `PUBLIC_REFERENCE` account is never described as "Verified Instagram" or
"Instagram connected".

## Post-onboarding parity

`SocialAssetProtectionPanel` is mounted in onboarding (Asset Verification),
Assets, and Settings, so adding a public profile, protecting from a link, and
uploading media are all available without repeating onboarding.

## Production configuration

- `ENFORCEMENT_LIVE_ENABLED=false`, `ENFORCEMENT_TEST_MODE=true`, emergency
  pause unchanged. This release does not enable enforcement.
- MODE B ingestion/onboarding is operationally separate from live enforcement.
- MODE A credentials (`META_APP_ID` / `META_APP_SECRET` / `META_REDIRECT_URI`)
  are read inside server-function handlers only, so their absence cannot cause
  a startup failure; the shell reports `configured: false`.

## Database safety

`social_accounts` migration is additive and idempotent (`CREATE TABLE IF NOT
EXISTS`, `IF NOT EXISTS` index, `DROP POLICY IF EXISTS` + recreate). Its
backfill of legacy onboarding social links uses
`INSERT ... ON CONFLICT DO NOTHING` and never updates or deletes existing
customer rows, social accounts, or protected assets. Legacy onboarding keeps
working; a rollback leaves the extra table unused and harmless.

## Observability

`src/lib/social/observability.ts` emits one structured `[ModeB]` line per funnel
step: profile registration, PUBLIC_REFERENCE creation, link import outcome,
public retrieval blocked, upload required, manual upload prepared, upload
ingestion, fingerprint, dedupe hit, Autopilot enrollment, authorization gate.

Outcomes distinguish `platform_limit` (Instagram 429 / login wall) from
`failure` (Eterna application defect). Original media, presigned URLs, storage
keys, secrets, and customer identity data are never logged.

## Known expected limitation

Instagram may prevent anonymous server-side media retrieval. When this occurs,
Eterna asks the customer to upload the original media: "We couldn't securely
retrieve this media from Instagram. Upload the original photo or video to
protect it." This is an expected platform limitation, not an application
failure.

## MODE A — NOT ENABLED

Dormant. Pending: Meta application configuration, required permissions,
platform capability review, authorization implementation and testing. MODE A
readiness does not block MODE B rollout.
