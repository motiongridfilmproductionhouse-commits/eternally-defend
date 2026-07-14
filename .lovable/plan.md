# Protected Assets — Social Discovery & Ownership Verification

Extend the Protected Assets flow so users can enter a person / brand / domain / handle, get back candidate official accounts across major platforms, confirm which are theirs, and then progressively strengthen ownership proof before any enforcement-grade action is allowed.

## 1. Data model (one migration)

New tables (all RLS-scoped to `auth.uid()`, standard GRANTs to `authenticated` + `service_role`):

- `discovery_subjects` — one row per "who/what am I protecting"
  - `subject_kind` (person | brand | company | domain | handle | website)
  - `query` (raw text), `normalized_name`, `website_domain`, `country`, `org`, `notes`
- `discovered_accounts` — candidates found for a subject
  - `subject_id`, `platform` (youtube|instagram|facebook|tiktok|x|linkedin|reddit|website)
  - `display_name`, `handle`, `profile_url`, `profile_image_url`, `bio`, `follower_count`, `platform_verified`, `website_links jsonb`, `cross_links jsonb`
  - `confidence` (0–100), `match_signals jsonb` (per-signal breakdown), `match_reasons text[]`
  - `discovery_source` (firecrawl_search | website_links | cross_link | manual)
  - `status` — enum: `discovered | likely_official | user_confirmed | ownership_pending | verified | rejected`
  - `user_decision` (`confirmed | not_mine | unsure | null`), `decided_at`
- `account_verifications` — one row per verification attempt
  - `account_id`, `method` (`oauth | domain_dns | domain_meta | business_email | bio_code | document | admin_review`)
  - `state` (`pending | passed | failed | expired`), `code` (for bio-code), `evidence jsonb`
  - `verified_at`, `reviewer_id`, `expires_at`
- `account_audit_log` — append-only: `account_id`, `actor_id`, `action`, `from_status`, `to_status`, `meta jsonb`

Link to existing `protected_assets`: add nullable `discovered_account_id uuid` FK so a confirmed account can be promoted into the protected registry. The authorization agreement (existing `authorization_records`) is applied only to explicitly selected accounts/assets — nothing is auto-included.

## 2. Discovery engine (server function)

`discoverAccounts` — `createServerFn` + `requireSupabaseAuth`, inputs `{ subjectId }`.

- Uses **Firecrawl** (already connected) for:
  1. `search` queries per platform, e.g. `site:youtube.com "<name>"`, `site:instagram.com "<handle>"`, plus a general `"<name>" official`
  2. `scrape` on the user's official website (if provided) with `formats: ['links','html','branding']` to pull outbound social links and logo
  3. `scrape` on top candidate profile pages to extract display name, bio, follower count when publicly rendered, verified badge, external website link
- Normalizes candidates, dedupes per `(platform, handle)`, writes to `discovered_accounts` with `status='discovered'`.
- Computes `confidence` from weighted signals (each recorded in `match_signals`):
  - name similarity (Jaro-Winkler) 25
  - handle similarity 15
  - official-domain match in bio/website field 20
  - inbound link from user's official site 20
  - cross-link between two candidates 10
  - platform-verified badge 5
  - country/org/category match 5
- Promotes to `likely_official` when confidence ≥ 75.
- Returns candidates for the UI.

Runs sequentially per platform with a small concurrency cap and stops early on Firecrawl 402 (credit exhaustion), surfacing the exact provider error.

## 3. UI — Discovery & confirmation

New wizard step inside `/onboarding` (and a standalone panel on `/assets` for post-onboarding additions):

- Input: subject kind + query + optional website/country/org.
- "Search" triggers discovery, shows a live list grouped by platform:
  - profile image, display name + handle, follower count, platform verified badge
  - confidence bar + expandable "why we think this is a match" (match_signals + reasons)
  - action buttons: **Confirm official**, **Not my account**, **Unsure**, plus **Add manually**
- Confirm → `user_decision='confirmed'`, status becomes `user_confirmed` (monitoring allowed). Never auto-jumps to `verified`.
- Rejected candidates are hidden by default but recoverable.

## 4. Ownership verification (gated actions)

Confirmed accounts can be **monitored**. Before enforcement / takedown / copyright / impersonation actions the app requires `status='verified'` via one of:

- **Platform OAuth** — when the platform has a connector (YouTube via Google, LinkedIn, TikTok, X, Reddit); we compare the OAuth identity's handle/id against the candidate. If it matches, verification passes.
- **Domain verification** — DNS TXT record `eterna-verify=<token>` on the user's website domain, or `<meta name="eterna-verify" content="<token>">` in the page head. Check via Firecrawl scrape / DNS-over-HTTPS.
- **Business-email verification** — send a code to an address on the confirmed domain (uses existing email/AI-gateway infra).
- **Bio code** — generate a short token, user pastes it into the profile bio, we re-scrape the profile to confirm, then instruct removal.
- **Authorization document upload** — into the existing `authorization-vault` storage bucket.
- **Admin review** — flags to `ownership_pending`; internal admin (`has_role(_,'admin')`) approves via a review queue.

Each attempt is written to `account_verifications`; a passing attempt flips the account to `verified` and appends to `account_audit_log`.

The existing `useAuthorization()` gate is extended: enforcement UI checks that the target account is `verified`, not just that the user's authorization level is high enough. Otherwise it shows an inline "Verify ownership to enable enforcement" CTA.

## 5. Server layout

- `src/lib/discovery.functions.ts` — `createSubject`, `discoverAccounts`, `decideAccount` (confirm/reject/unsure), `addManualAccount`, `listSubjects`, `listAccounts`
- `src/lib/verification.functions.ts` — `startVerification`, `checkVerification`, `submitDocument`, `adminApprove`
- `src/lib/discovery/firecrawl.server.ts` — thin Firecrawl helpers (search per platform, scrape profile, scrape website for outbound links) — direct API mode per current `FIRECRAWL_API_KEY`
- `src/lib/discovery/scoring.ts` — pure scoring utilities (client-safe, unit-testable)
- No admin/service-role reads for anything user-scoped; all queries via `requireSupabaseAuth` → RLS.

## 6. UI files

- `src/components/discovery/DiscoveryPanel.tsx` — subject form + results list
- `src/components/discovery/AccountCard.tsx` — one candidate row with signals & actions
- `src/components/discovery/VerificationDialog.tsx` — picks a method and drives the flow
- `src/routes/_app.assets.tsx` — add a "Discover accounts" button that opens the panel; confirmed accounts appear as registered assets with a "Verify ownership" action when status < verified
- `src/routes/_app.onboarding.tsx` — inject the discovery step between "Protected Assets" and "Consent"

## 7. Audit & scope of authorization

- Every status transition writes to `account_audit_log` with actor, timestamps, method, and evidence hash.
- The existing `authorization_records` signature captures the specific `account_ids` and `asset_ids` present at signing time. Newly added accounts do NOT inherit the prior signature — the user is prompted to re-sign for the new scope before enforcement can target them.

## Out of scope

- Real KYC / government-ID verification
- Deep OAuth for every platform in a single pass — YouTube (Google) and one more platform ship first; others land behind a "coming soon" state that still allows bio-code / domain / document verification.
- Automatic take­down submission (already handled by existing enforcement flow; this change only gates *who* can trigger it).
