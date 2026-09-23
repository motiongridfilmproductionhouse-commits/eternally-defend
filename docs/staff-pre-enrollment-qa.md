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
