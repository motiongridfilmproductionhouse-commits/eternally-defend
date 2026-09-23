# Staff Pre-Enrollment Intelligence Scan — QA record

Branch: `feature/staff-pre-enrollment-intelligence`

## Automated checks (run in the build sandbox)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| `vite build` (production, Nitro/Cloudflare target) | success |
| `node --test` / vitest on `src/lib/prospect/**` | 57 / 57 pass |
| Full repo `node --import tsx --test` | 78 failures, **identical** to baseline commit `1bdd4be3` (all outside `src/lib/prospect`, none touched by this branch) |
| ESLint on new/changed files | clean (remaining prettier warnings are in untouched Lovable-authored prospect files) |

## QA gate — how each requirement is enforced

| Requirement | Where it's enforced |
| --- | --- |
| UI totals = DB totals | Modal and report render only `getProspectScan` → `loadScanSnapshot` → `analyseScan` over stored rows; no counts in components |
| No hardcoded counts / fake URLs | No fixture data in shipped code; the layout harness used for visual QA was deleted before commit |
| Unavailable never shown as scanned | Source pills and coverage use `prospect_scan_sources.state`; IG/FB/X/TikTok stay `UNAVAILABLE`, web-search hits keep `platform` + `discovery_method = WEB_SEARCH` |
| Reddit | Still excluded by `isHostDisabledForFeature`; shown as `POLICY_DISABLED`, and not counted as a failure |
| Deduplication | Grouped by canonical URL + unique index `(scan_id, canonical_url)`; test in `fingerprint.test.ts` |
| Ambiguous identities excluded | Totals count `identity_bucket = MATCHED` only; a name alone never gives MATCHED (`identity-resolution` tests) |
| Zero / empty states | Each stage shows a zero state that depends on coverage (`zeroFindingsLabel`) instead of an "all clear" |
| Provider failures visible | `PROVIDER_FAILED` events + `failure_reason` on the pill, the coverage "Failed" group and the report |
| Honest coverage | COMPLETE / PARTIAL / LIMITED / INSUFFICIENT from `coverage.ts`, grouped by successful, failed, unavailable and policy-disabled families |
| Staff-only access | `requireSupabaseAuth` + `assertStaff` (role table, no email checks) on every server function; RLS `is_prospect_staff` on all `prospect_*` tables; `/staff` layout re-checks on the server |
| Clients can't access | RLS denies non-staff; structural test asserts no email-based authorisation |
| Preliminary vs verified kept separate | Two score rows; the verified row stays `PENDING_VERIFICATION` until a human verifies a finding |
| No enforcement from prospect scans | Structural test: prospect modules import nothing from enforcement/takedown; the drawer says actions can only start after enrollment |
| Rescans keep history | `rescanProspect` creates a new scan row; older scans are never mutated |
| Idempotent enrollment hand-off | `planEnrollmentTransfer` + unique transfer records; `enrollment.test.ts` |
| Provenance is append-only | DB triggers block changes to provenance/identity factors and state changes without a staff decision |

## Not verifiable from the sandbox

- **Live scans against real providers.** The sandbox has no provider secrets, blocked egress, and no access to the project database. The migration `20260923100000_prospect_runner_hardening.sql` has to be applied first.
- **Screenshots of the live Deepfake, Reputation, Propagation and final summary stages with real data.** These have to be captured in the deployed environment after a staff login and a real scan. We did not seed any database findings to fill them in.
- Boot and search screens were captured locally from the real components.

## Follow-up fixes (before merge)

### 1. Enrollment hand-off is now consumed by onboarding

- **Staff: Begin Client Enrollment** creates one `prospect_enrollment_packages` row per prospect scan. It is unique on `scan_id`, so pressing the button twice returns the same package. The row stores the identity snapshot: name, type, aliases, known profile, handles, known works, linked entities, country, profession and organisation.
- **Linking the client.** A redeemed invitation links its package to the new account (`signUpWithInvite` → `linkPackageForRedeemedInvite`). For a client who already has an account, an admin can link it by email. Once linked, a package is never re-pointed; a DB trigger enforces this.
- **Applying the package** (`applyPreEnrollmentPackagesForUser`, idempotent) runs at signup, when the account type is chosen (`selectV2AccountType`) and when the onboarding page loads (`getProgress`).
  - It fills only empty profile fields.
  - It merges aliases, handles and the known profile into the same `client_profiles.social_profiles` keys the client's onboarding form edits, so the client sees and confirms them.
  - It stores `prospect_scan_id`, known works and linked entities under `social_profiles.pre_enrollment`.
  - It imports the transferred, human-verified, identity-matched findings into `client_prospect_findings`, with references to their stored evidence.
- **Duplicates are prevented in two places:** `UNIQUE (client_user_id, prospect_finding_id)` plus upsert-ignore, and a test that runs the apply step twice.
- **No enforcement.** `client_prospect_findings` is review-only. A DB constraint keeps `enforcement_eligible` false, and a structural test checks that only prospect hand-off code references the table.
- **What the client sees.** The onboarding page shows a short notice when a package was delivered.

### 2. Scans continue on the server

- **Three triggers** run the same bounded, lease-protected step:
  1. the start/rescan request (first step, under the staff member's own session) plus an `AFTER INSERT` trigger on `prospect_scans`, which kicks the worker immediately through pg_net;
  2. `POST /api/public/hooks/prospect-scan-worker`, which responds 202 and then chains itself while work remains;
  3. pg_cron every minute (`eterna-prospect-scan-worker`), as a safety net.
- **Authentication:** every caller sends the managed `prospect_scan_worker` token. The database verifies it; see "No service-role dependency" below.
- **Closing, refreshing or reconnecting** has no effect on the scan. Reopening `/staff?scan=<id>` shows the stored progress of the same `scan_id`.
- **Overlapping triggers are harmless**, because of the lease and because state is rebuilt from stored rows.
- **Stuck scans.** A scan that runs longer than 2 hours with no live worker is marked failed, with the partial results kept, instead of retrying forever.
- **The open popup** is now only a stall watchdog. It asks for one step if no new event has appeared for 45 seconds.

### No service-role dependency

The feature needs only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Nothing in `src/lib/prospect`, `src/components/staff`, the `/staff` routes or the worker hook imports `client.server` or `supabaseAdmin`, and nothing requires `SUPABASE_SERVICE_ROLE_KEY`. `no-service-role.test.ts` enforces this.

| Path | How it reaches the database |
| --- | --- |
| Staff start, rescan, advance and decisions | The staff member's own RLS session, under the existing staff policies |
| Background worker (hook, pg_cron, scan-insert trigger) | Publishable key plus header `x-prospect-worker-token: <managed token>`. The hook asks the database to check the token (`prospect_worker_token_valid`). RLS policies `TO anon USING (is_prospect_worker())` admit that header on the scan tables only. |
| Client onboarding (claim, pre-fill, import) | The client's own session. `prospect_claim_my_packages`, `prospect_mark_my_package_prefilled` and `prospect_import_my_findings` are `SECURITY DEFINER` functions scoped to `auth.uid()`. Profile pre-fill uses the client's own profile RLS. |
| Admin linking an existing client by email | `prospect_link_package_to_client_email`, which requires staff plus admin/super_admin. |

The worker token lives only in `internal_cron_secrets`. No client role has a grant on that table, and the database compares tokens itself. It travels only server to server (pg_net → hook → chained hook) and never reaches a browser. Signup (`invites.functions.ts`) is back to its original code: a client's package is claimed from the invite they redeemed the first time they load onboarding.

**Checked against a real Postgres 16 with Supabase-like roles.** All eight prospect migrations applied cleanly, and these behaviours were confirmed:
- **Worker without the token:** sees and changes nothing.
- **Worker with the token:** can claim a lease, write events, discoveries, sources and scores, and finalize a scan. It cannot fake a human verification, and cannot read the secrets, packages or staff decisions.
- **Clients:** can claim only packages from their own redeemed invite. Import is idempotent. Clients cannot read prospect scans or insert findings.
- **Staff linking:** non-admin staff cannot link by email, and a package cannot be re-pointed to another client.
- **Scan insert:** kicks the worker with the token.

### Deploy checklist

1. Apply the migrations in order: `20260923100000_prospect_runner_hardening.sql`, `20260924090000_prospect_enrollment_consumption.sql`, `20260924091000_prospect_scan_worker_schedule.sql`, `20260924120000_prospect_without_service_role.sql`.
2. Check the worker URL. The cron job and the scan-insert trigger use the same Lovable origin as the existing Eterna hooks. If the host differs, update both and optionally set `PROSPECT_SCAN_WORKER_BASE_URL`, which is used for chaining.
3. Runtime configuration: only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Do **not** add `SUPABASE_SERVICE_ROLE_KEY` for this feature.
4. Regenerate the Supabase types when convenient. The new tables and functions are accessed through the codebase's existing untyped casts.
