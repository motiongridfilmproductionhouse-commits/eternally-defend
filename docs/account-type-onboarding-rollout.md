# Account-Type Onboarding Rollout

## Activation rule

Set both server-side variables together:

```text
ACCOUNT_TYPE_ONBOARDING_ENABLED=true
ACCOUNT_TYPE_ONBOARDING_ACTIVATION_AT=2026-08-10T00:00:00.000Z
```

The first trusted onboarding-progress creation reads the authenticated Supabase user `created_at` once. A user created before the activation timestamp receives `v1`; a user created at or after it receives `v2`. Existing profile/progress records always win and are never reclassified when the flag changes.

Keep the flag false until rollout checks are complete. Disabling it stops new `v2` assignments but does not downgrade existing `v2` users.

## Route flows

- Celebrity: Account Type → Celebrity Profile → Official Contact / Evidence → Face Protection → Digital Assets → Authorization Scope → Authorization Review → Electronic Signature → Certificate → Complete
- Individual: Account Type → Personal Profile → Veriff → Face Protection → Digital Assets → Authorization Scope → Authorization Review → Electronic Signature → Certificate → Complete
- Enterprise: Account Type → Company Profile → Representative Details → Company Evidence → Digital Assets → Authorization Scope → Authorization Review → Electronic Signature → Certificate → Complete
- Production House: Account Type → Production House Profile → Representative Details → Rights Evidence → Film / Media Assets → Authorization Scope → Authorization Review → Electronic Signature → Certificate → Complete

## Completion rules

- Only Individual accounts require Veriff / Government ID Verified claims.
- Legacy `completeOnboarding` rejects v2 users.
- `completeV2Onboarding` rejects v1 users and enforces route-specific server requirements.
- Normal `setStepStatus` advancement never sets `overall_status` to `COMPLETED`.
- `onboarding_version` is preserved on all progress writes.

## Badges

- Individual → Verified Individual
- Celebrity → Verified Celebrity (or Verified Public Figure)
- Enterprise → Verified Enterprise (or Verified Organization)
- Production House → Verified Production House (or Verified Rights Holder)
