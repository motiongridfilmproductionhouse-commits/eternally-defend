# Eterna Agent Quick Assessment

Implements the latest lightweight assessment brief against repository snapshot `0a90fe0c40bc2dd5d156ebd3d9ea4313de424497`.

## Existing systems reused

- TanStack Start server functions, routing, React Query, UI buttons/inputs, typography and Eterna branding.
- Supabase authentication middleware, bearer sessions, service client, `has_role` admin/super-admin checks.
- Existing `/auth` invitation-only signup and `/onboarding`; no new account creation or authorization bypass.
- Existing DiscoveryRouter and configured Brave, Google Custom Search, SerpAPI and Firecrawl search adapters.
- Existing background lifetime and privileged scheduler-auth conventions.

## Behavior

`/auth?agent=1` signs an enabled existing account into `/agent`, which opens `/agent-assessment`. Agents enter a name and optional official HTTPS profile. Creation persists a queued job, returns immediately, and executes discovery in background. The UI polls persisted stages every three seconds and stops on terminal states or an access error.

Counts describe deduplicated, name-matched pages and observed domains in the returned search sample. They are not total search-engine counts, confirmed platform coverage, misuse detections, celebrity value, or net worth. Supplied URLs are never fetched by this feature; they are identifiers used to match search evidence. HTTPS validation rejects credentials, IP literals, local names and custom ports. Risk/AI misuse values remain unavailable: these search APIs do not establish verified misuse, so no numeric risk score is manufactured.

Identity matching requires the supplied official URL to appear among name-matched search results before a price can be produced. Missing identity, insufficient evidence or disabled pricing gives `REVIEW_REQUIRED`. Provider failure gives `FAILED` with no price. The supplied profile remains a candidate identity signal, not proof of account ownership.

Commercial estimates use a separately stored, administrator-approved policy:

`annual base + observed domains × annual domain rate + observed pages × monthly review minutes × 12 / 60 × hourly review rate`

The configured range margin is applied to the result. Each assessment retains its policy version and snapshot. Pricing starts disabled with zero commercial rates; no unsupported commercial defaults are introduced. The minimal quick scan estimates observed monitoring/review workload only, not unverified enforcement volume or full protection risk.

The interest action creates a random 256-bit reference with a 24-hour expiry, stored only as a SHA-256 hash. The QR and `/auth?assessment=...` link contain no artist, price, score or agent details. Creating a replacement link invalidates the old link. The existing signup invitation gate remains mandatory. After authentication, an atomic claim associates the assessment to one client; agent/admin accounts cannot claim it. A replay by the same client is idempotent, cross-client replays and expired references fail. Existing profile/onboarding lifecycle events update attribution without changing their completion rules.

Agent memberships do not grant client-data access. All assessment tables deny direct anonymous/authenticated access; authenticated server functions enforce current agent membership and ownership before privileged reads/writes. Creation uses an actor-scoped transaction lock, 24-hour duplicate reuse, a 10/hour and 40/day scan limit. Record/state changes and actor decisions are audited. Administrative access and pricing changes are atomic and audited. Disabled agents immediately lose assessment access.

## Enable in the existing deployment

1. Apply `supabase/migrations/20260914120000_agent_assessments.sql` through the platform's normal migration workflow before deploying the application changes. It adds tables/functions/triggers without altering existing client policies or authentication.
2. Use existing server-only Supabase credentials and at least one configured search provider. No new scanner account is required.
3. Open **Admin → Agent Assessments** (or `/agent-admin`) using an existing admin/super-admin account. Enable the intended existing user ID as an agent.
4. Enter approved Eterna commercial rates and confidence thresholds, then enable pricing. New assessments use the new version; saved quotes retain their original policy snapshot.
5. Configure the platform scheduler to POST `/api/public/hooks/agent-assessments` periodically (for example once a minute) for queued-job recovery. Authenticate through the existing managed cron-secret mechanism under `agent-assessments`, or a server-only `AGENT_ASSESSMENT_WORKER_SECRET` of at least 16 characters. This endpoint rejects requests without a configured valid credential. It drains at most five jobs per call. Immediate processing uses Nitro/Cloudflare request `waitUntil` when available, otherwise the existing Vercel helper. A persistent local server can execute directly. Interrupted scans become failed rather than fabricated successes; the UI also detects stale work.
6. Verify one real agent scan and a separate client signup/login handoff in staging, including mobile layout. New client accounts still need normal signup invitations.

An assessment requires review when no official profile was supplied. Supply it in a subsequent assessment to allow confident matching. Recent identical successful/review assessments are reused for 24 hours; failed ones can be retried within the rate limit.

## Validation

- 16 new unit/database tests pass: authorization, ownership, URL checks, deterministic policy, provider failures, insufficient data, stage persistence, duplicate/rate limits, SQL privileges, token expiry/replay, client linking, membership disabling, auditing and lifecycle attribution.
- Database migration executed in embedded PostgreSQL (PGlite, development-only test dependency). Tests use isolated schemas and accounts; they do not contact production.
- Production build passes; TypeScript check passes; changed-file lint passes.
- Selected existing invitation, security, onboarding and discovery tests: 32 pass, 4 fail. The same failures reproduce on the untouched base snapshot: missing face-eligibility module, two v2 onboarding expectation mismatches, and provider-error-message sanitization. These are not introduced by this change.
- Repository-wide lint is already failing (over 13,000 issues). Unrelated files were not reformatted or repaired.
- Browser/device interaction and real provider/staging execution were not verified: the sandbox denied starting a listening preview server, and production credentials/migrations were not exercised. No production migration, membership update, scan or pricing activation was performed.

Run `npm run test:agent`, `npx tsc --noEmit` and `npm run build` in the usual development environment. Use npm/package-lock for the new development test dependency; the pre-existing Bun lock was not regenerated.

## Direct agent credentials

Agent Access is a sign-in-only view: email username and password, without client invitation-code or signup controls. Even an invite query parameter is ignored in agent mode. Client login and signup retain the existing invitation requirement.

Administrators can create a new agent in `/agent-admin` using an email and password, with no invitation code. Provisioning uses the existing Supabase Auth admin API, then enables the new user through the audited membership RPC. Existing accounts are never reset or upgraded through the create action. If membership setup fails, the response reports the newly created user ID for recovery through the existing enable control. Passwords are not returned or included in audit records.
