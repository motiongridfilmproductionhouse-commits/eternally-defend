# Hybrid Social Asset Protection (Instagram-first) — Audit + Architecture

Audit only so far; nothing built, nothing committed. Enforcement stays `ENFORCEMENT_TEST_MODE=true`, `ENFORCEMENT_LIVE_ENABLED=false`. No threshold or gate changes anywhere in this plan.

## 1. Audit of what exists today

### Already exists (reusable as-is)
- **Protected asset pipeline**: `src/lib/asset-registration.functions.ts` — signed S3 PUT into `clients/{userId}/assets/...`, SHA-256, real pHash/dHash/aHash (`src/lib/media/perceptual-hash.server.ts`), insert into `protected_assets` with `phash/dhash/ahash/hash_algorithm/hashed_at`, plus reverse-image verification (`src/lib/assets/reverse-verify.server.ts`).
- **Video fingerprinting**: `src/lib/media/video-frames.server.ts` + copyright fingerprint path (`src/lib/copyright/fingerprint.server.ts`) already produce keyframe hashes.
- **Protection Autopilot**: `src/lib/protection/autopilot.server.ts` — `activateProtectionAutopilot` enrolls the identity target plus **every active fingerprinted asset** as `protection_targets` with `next_run_at = now`, then the recurring sweep (`/api/public/hooks/protection-autopilot`) scans them.
- **Public-web discovery**: Firecrawl / Bright Data SERP / Brave / SerpApi / Google + Gemini classification, reverse-image seeding, candidate retrieval, evidence capture, review gates.
- **Handle-based scoring**: `src/lib/discovery/scoring.ts` already scores candidate handles and has `handleFromUrl`.
- **Self-declared social links**: `src/lib/onboarding/social-profiles.functions.ts` and `company.functions.ts` store links inside the `client_profiles.social_profiles` jsonb blob, already explicitly labelled self-declared / never verified.
- **Assets UI**: `src/routes/_app.assets.tsx` (upload + list) — the host for the new actions.

### Needs wiring (exists, not connected)
- Social handles are stored but never fed into discovery query building as an explicit signal.
- `activateProtectionAutopilot` runs only at onboarding completion — assets added later are not enrolled until the next activation. Needs an enrollment call at asset-insert time (and a one-shot backfill).
- Video keyframe hashing is not reachable from the asset-registration path (images only, 10 MB, JPG/PNG/WebP).
- `protected_assets.metadata` has no provenance shape.

### Needs building (small, new)
- Provenance schema + `import_method` / `account_authorization_state` on asset metadata.
- Social-account records with mode `PUBLIC_REFERENCE` vs `AUTHORIZED_CONNECTED`, and migration of existing self-declared links to `PUBLIC_REFERENCE`.
- "Protect from Link" flow (validate Instagram URL → associate with declared profile → permitted public retrieval → provenance → asset → fingerprint → autopilot; graceful fallback to manual upload when retrieval is not legitimately possible).
- Onboarding Instagram step with "Connect Instagram" / "Continue without connecting" + the exact non-connected notice; never a completion requirement.
- Video/reel support in the manual upload path (keyframe hashes).

### Requires external platform authorization/API (blocked today)
- **No Meta/Instagram credentials exist** in this project — secrets contain no `INSTAGRAM_*`/`META_*`/`FACEBOOK_*` app ID, secret, or token. So MODE A cannot be functionally completed now: it needs a Meta app with Instagram Graph API (Business/Creator account linked to a Facebook Page), App Review for the media-read scopes, and a redirect URI.
- Therefore MODE A ships as a **server-side OAuth shell**: real DB state, real token vault (reuse AES-256-GCM `src/lib/automation/vault.server.ts`), real importer interface — activated the moment credentials are added. UI shows "Connect Instagram (setup pending)" rather than pretending it works. No password fields, ever.

## 2. Smallest architecture

```text
Onboarding IG step ──┬── Connect Instagram ──► /api/public/... OAuth callback ──► social_accounts(AUTHORIZED_CONNECTED)
                     │                                     │ (token in server-side vault)
                     │                                     ▼
                     │                          media importer (incremental sync)
                     └── Continue without ──► social_accounts(PUBLIC_REFERENCE)  [handle = discovery signal only]

Protect from Link ──► validate IG URL ──► permitted public retrieval ──┬─ ok ─► provenance
                                                                       └─ blocked ─► "Upload instead"
Upload media ────────────────────────────────────────────────────────────────────► provenance

                       provenance ──► protected_assets (+pHash/dHash/aHash or keyframes)
                                          └──► enrollProtectedAsset() ──► protection_targets(next_run_at=now)
                                                                            └──► existing Autopilot sweep + discovery
```

### Data
- New table `social_accounts`: `user_id`, `platform`, `profile_url`, `handle`, `mode` (`PUBLIC_REFERENCE` | `AUTHORIZED_CONNECTED`), `connected_at`, `last_sync_at`, `sync_cursor`, `token_ref` (vault ref only), timestamps. RLS: owner-scoped select/insert/update/delete for `authenticated`; `GRANT` block + `service_role` for the sync worker. Migration backfills existing `client_profiles.social_profiles` links as `PUBLIC_REFERENCE`.
- `protected_assets.metadata.provenance`: `source_platform`, `source_profile_url`, `source_post_url`, `platform_media_id`, `published_at`, `media_type`, `carousel_index`, `import_method`, `account_authorization_state`, `captured_at`. `import_method` ∈ `AUTHORIZED_API | PUBLIC_REFERENCE | CUSTOMER_SUPPLIED_URL | CUSTOMER_UPLOAD`. Ownership is never inferred from provenance; authorization state stays separate.

### Code (new files, all thin)
- `src/lib/social/provenance.ts` — pure provenance builder + zod schema + IG URL validator/parser (post/reel/short-code).
- `src/lib/social/accounts.functions.ts` — list / add public reference / disconnect.
- `src/lib/social/instagram-oauth.server.ts` + `src/routes/api/public/instagram-callback.ts` — server-side only; fail-closed with a clear "integration not configured" when credentials are absent.
- `src/lib/social/import-from-link.functions.ts` — Protect-from-Link; on any access-control obstacle returns `RETRIEVAL_NOT_PERMITTED` and tells the user to upload. No CAPTCHA/login/rate-limit circumvention, no private-account access.
- `src/lib/social/media-ingest.server.ts` — shared "bytes + provenance → fingerprint → protected_asset → enroll" path used by all three entry points.
- `src/lib/protection/enroll-asset.server.ts` — single-asset enrollment reusing existing cadence/target logic; called after every insert; plus a backfill for already-fingerprinted assets.

### UI
- `src/components/onboarding/InstagramConnectStep.tsx` — two buttons, exact skip notice, never blocking; replaces/wraps the existing social step for Instagram.
- `src/routes/_app.assets.tsx` — three actions: **Connect Instagram**, **Protect from Instagram Link**, **Upload Media**; badges read "Public reference (self-declared)" vs "Connected"; never "Instagram verified" for public reference.

### Discovery
- Add handle / profile URL / known post URLs from `social_accounts` as extra query signals into the existing discovery query builder — candidates only; existing retrieval, matching, evidence and review gates unchanged.

## 3. Explicitly unchanged
Rekognition thresholds, copyright matching thresholds, enforcement gates, pre-send gate, allowlist, live/test flags, route verification rules.

## 4. Open decision for you
MODE A cannot function without Meta app credentials. Options: (a) build the shell now and activate later when you supply credentials, or (b) ship MODE B + Protect-from-Link + upload first and defer the OAuth shell entirely.
