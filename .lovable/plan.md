# AWS Rekognition + S3 Integration

Server-only integration wiring Amazon Rekognition (face collections + face search) and Amazon S3 (originals + evidence vault) into Eterna. All AWS calls happen in server functions using the existing `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_REKOGNITION_BUCKET` secrets. Nothing AWS ever reaches the browser.

## 1. Dependencies

Add `@aws-sdk/client-rekognition`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

## 2. Database migration

New tables (all `public`, RLS on, GRANTs for authenticated + service_role, `has_role` used where needed):

- `rekognition_collections` — one per client
  - `user_id`, `collection_id` (unique), `status`, `face_count`
- `protected_faces` — indexed reference faces
  - `user_id`, `collection_id`, `asset_id` (nullable FK to `protected_assets`), `discovered_account_id` (nullable FK), `platform`, `source_url`, `s3_bucket`, `s3_key`, `face_id` (Rekognition), `image_id`, `confidence`, `bounding_box` jsonb
- `face_match_events` — every Rekognition SearchFacesByImage result
  - `user_id`, `collection_id`, `matched_face_id`, `matched_asset_id`, `similarity`, `face_confidence`, `source_url`, `source_type` (`youtube_thumb|profile|news|website|screenshot`), `scan_hit_id` (nullable), `image_s3_bucket`, `image_s3_key`, `bounding_box`, `review_status` (`pending|authorized|harmless|threat_created|dismissed`), `threat_category` (`impersonation|fake_endorsement|unauthorized_image|face_misuse|celebrity_detection|null`), `context_notes`
- `evidence_vault_items` — S3 evidence entries
  - `user_id`, `case_id`/`enforcement_request_id`/`scan_hit_id` (nullable), `kind` (`screenshot|takedown_package|certificate|thumbnail|archive`), `s3_bucket`, `s3_key`, `sha256`, `bytes`, `content_type`, `metadata` jsonb

Migration also creates two Storage buckets used server-side only (private): none — everything goes to the AWS S3 bucket `AWS_REKOGNITION_BUCKET`, not Supabase Storage. Key prefixes:
- `clients/{user_id}/reference/{asset_id}/{uuid}.jpg`
- `clients/{user_id}/scan-images/{yyyy}/{mm}/{uuid}.jpg`
- `clients/{user_id}/evidence/{kind}/{uuid}`

## 3. Server-only AWS client

`src/lib/aws/clients.server.ts` — lazy singleton `RekognitionClient` and `S3Client` reading `process.env`. Never imported from routes/components directly.

`src/lib/aws/s3.server.ts` — `putObject`, `getSignedGetUrl`, `getSignedPutUrl`, `headObject`, sha256 helper.

`src/lib/aws/rekognition.server.ts` — `ensureCollection(userId)`, `indexFace({ userId, bytes, externalImageId })`, `searchFacesByImage({ userId, bytes, threshold=80, maxFaces=5 })`, `deleteFace`.

## 4. Server functions (all `.server` wrappers via `*.functions.ts`, protected with `requireSupabaseAuth`)

`src/lib/face-protection.functions.ts`:
- `ensureClientCollection()` — create/reuse Rekognition collection for user.
- `importOfficialAccountFaces({ discoveredAccountId })` — called from the confirm-official-account flow. Downloads the account's profile/reference images (via `/api/media/preview` fetch helper server-side), uploads originals to S3, indexes into the user's collection, writes `protected_faces` rows.
- `importAssetFaces({ assetId, imageUrls })` — same for `protected_assets`.
- `deleteProtectedFace({ id })`.

`src/lib/face-scan.functions.ts`:
- `analyzeImagesForFaces({ scanHitId?, images: [{url,type}] })` — downloads each image server-side, calls `searchFacesByImage`, stores S3 copy under `scan-images/`, writes `face_match_events` rows in `pending` review. Returns matches.
- `listFaceMatches({ status?, category? })`, `reviewFaceMatch({ id, decision, category, notes })` — moves through review workflow. Only `decision='threat_created'` with a category creates/links an `enforcement_request` (Draft) and a `case_findings` row. Match alone never creates a threat.

`src/lib/evidence-vault.functions.ts`:
- `uploadEvidence({ kind, targetId, contentType, bytes|base64 })` — stores in S3, sha256, inserts `evidence_vault_items`.
- `listEvidence({ scope })`, `getEvidenceSignedUrl({ id })` — 5-minute presigned GET.

## 5. Scan pipeline hookup

In `src/lib/scans.functions.ts` where `scan_hits` are inserted, after write, enqueue `analyzeImagesForFaces` for hits whose `thumbnail_url`/`canonical_url` looks like an image or YouTube (uses existing `youtubeThumbFromUrl`). Best-effort; failures logged, never block the scan.

## 6. UI (frontend only reads via server fns; no AWS in the client)

- `src/routes/_app.assets.tsx` — on official-account confirm (existing `VerificationDialog`), after success call `importOfficialAccountFaces`. Show toast with indexed face count.
- New route `src/routes/_app.face-protection.tsx` — Protected Faces list, Face Matches review queue with side-by-side (reference vs matched image via presigned URL), decision buttons (Authorized / Harmless / Create Threat with category / Dismiss).
- New route `src/routes/_app.evidence-vault.tsx` — evidence list with signed download links.
- `CommandCenter.tsx` — add 5 widgets fed by a new `getFaceProtectionStats` server fn:
  - Protected Faces (count of `protected_faces`)
  - Face Matches (24h count)
  - Impersonation Alerts (category='impersonation', status='threat_created' last 7d)
  - Fake Endorsements (category='fake_endorsement' last 7d)
  - Evidence Vault (item count + total bytes)

## 7. Review workflow enforcement

`reviewFaceMatch` requires: `similarity >= 80`, explicit `context_notes`, an `authorization_check` (server checks `authorization_records` for the matched asset), and explicit user decision. Server rejects `threat_created` if any missing. Matches from official/authorized accounts auto-suggest `authorized`.

## 8. Out of scope this pass

- Auto-cropping to face bounding box before re-indexing.
- Video face search (Rekognition StartFaceSearch) — images only for now.
- Celebrity Recognition API — schema supports the category, but wiring uses the existing face collection first; celebrity API can be added later behind a flag.
- Bulk backfill of already-confirmed accounts (a "Reindex" button is provided; no automatic migration).

## Files touched

New: migration SQL, `src/lib/aws/{clients,s3,rekognition}.server.ts`, `src/lib/face-protection.functions.ts`, `src/lib/face-scan.functions.ts`, `src/lib/evidence-vault.functions.ts`, `src/routes/_app.face-protection.tsx`, `src/routes/_app.evidence-vault.tsx`, small components under `src/components/face/`.

Edited: `src/lib/scans.functions.ts` (hook), `src/lib/command-center.functions.ts` (+ `getFaceProtectionStats`), `src/components/command/CommandCenter.tsx` (5 widgets), `src/routes/_app.assets.tsx` + `src/components/discovery/VerificationDialog.tsx` (call importer on confirm), `src/components/dashboard/Sidebar.tsx` (2 nav items), `package.json` (AWS SDK deps).

Approve to proceed and I'll ship it end-to-end.
