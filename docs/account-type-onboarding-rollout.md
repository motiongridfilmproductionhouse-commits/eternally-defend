# Account-Type Onboarding Rollout

## Activation rule

Set both server-side variables together:

```text
ACCOUNT_TYPE_ONBOARDING_ENABLED=true
ACCOUNT_TYPE_ONBOARDING_ACTIVATION_AT=2026-08-06T00:00:00.000Z
```

The first trusted onboarding-progress creation reads the authenticated Supabase user `created_at` once. A user created before the activation timestamp receives `v1`; a user created at or after it receives `v2`. Existing profile/progress records always win and are never reclassified when the flag changes.

Keep the flag false until all rollout checks are complete. Disabling it stops new `v2` assignments but does not downgrade existing `v2` users.

## Backup gate

Before applying `20260806100000_account_type_onboarding_v2.sql`, confirm a recoverable production Supabase backup or create one through the Supabase project backup/PITR controls. This repository does not contain a service-role credential and no production backup was created from this workspace.

## Safety checks

- The migration adds only a nullable `onboarding_progress.onboarding_version` column, enum values, validation checks, and client-update guards.
- It contains no `UPDATE` or `DELETE` statements.
- It has no `v2` database default.
- Existing `client_profiles.onboarding_version` values are not changed.
- `null` and `v1` resolve to the unchanged legacy nine-step flow.
- Client-submitted `onboarding_version` and `account_type` fields are ignored by the legacy profile save endpoint.
- Legacy completion APIs reject `v2`; the v2 completion API enforces account-type and Individual Veriff requirements.
