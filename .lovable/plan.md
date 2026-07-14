
# Eterna Multimedia Intelligence Engine — Build Plan

Scope is large. Delivered in one implementation pass across 4 sequential milestones so nothing blocks the rest. Existing YouTube Scanner, Threat Radar, Evidence Centre, Copyright and Reputation modules stay in place — this plugs into them.

## Milestone 0 — Foundations (required before any code runs)

1. **Enable Lovable Cloud** — provisions Postgres, RLS, auth, and Storage bucket.
2. **Request secrets** via secure form:
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON` (service account JSON, single-line)
   - `GOOGLE_CLOUD_PROJECT_ID`
   - `GOOGLE_CLOUD_STORAGE_BUCKET` (GCS bucket the service account can write to)
   - `FACT_CHECK_API_KEY`
3. Reuse existing `GOOGLE_API_KEY` for YouTube v3 + Translation v2 fallback.
4. Add helper `src/lib/gcp/auth.server.ts` to mint Google OAuth access tokens from the service account JSON (JWT self-signed → token endpoint, cached in memory per worker).

## Milestone 1 — Database schema (single migration)

Tables (all with `org_id`, `user_id`, `case_id?`, `scan_job_id?`, `source_result_id?`, timestamps, RLS by `has_role` or `auth.uid()`):

- `multimedia_analysis_jobs` — parent job, status, stage flags, error map, cost, source kind (youtube_meta | upload_video | upload_audio | upload_image | screenshot)
- `evidence_frames` — per-frame url, hash, timestamp, source job
- `video_annotations` — Video Intelligence detections (label/logo/object/shot/text/explicit) w/ start/end/confidence/bbox
- `transcription_jobs` — Speech-to-Text long-running op state
- `transcript_segments` — 15–30s window, speaker, language, text, confidence, entities, sentiment
- `speaker_segments` — raw diarisation
- `visual_detections` — Vision results per image/frame (logos/objects/labels/OCR/safesearch/face-presence)
- `ocr_results` — normalized text extractions
- `protected_asset_matches` — client-registered asset ↔ detection similarity
- `translations` — original+translated text pairs w/ language + confidence + provider
- `extracted_claims` — Gemini-extracted searchable claims + source pointer
- `fact_check_matches` — Fact Check Tools API results linked to claims
- `timestamp_findings` — canonical timeline row (fed by transcript + video + vision) — this is what the UI reads
- `multimedia_errors` — per-stage error log
- `protected_assets` — client uploads (photos/logos/artwork) for matching

`storage.buckets`: `eterna-media` (private) via `supabase--storage_create_bucket`. Signed URLs only. RLS policies on `storage.objects` restrict to `org_id` prefix.

GRANTs on every public table to `authenticated` + `service_role`.

## Milestone 2 — Backend orchestration (server functions + one server route)

All under `src/lib/mm/` as `*.functions.ts` (thin) + `*.server.ts` (helpers):

- `mm-orchestrator.functions.ts` → `runMultimediaIntelligenceAnalysis({ jobKind, sourceRef })`
  - creates job, kicks off parallel stages via `waitUntil`-style fire-and-forget (edge-compatible: run sequentially inside a background invocation triggered by a server route poller)
- Video Intelligence: `startVideoAnalysis`, `getVideoAnalysisStatus`, `processVideoAnnotations`, `retryVideoAnalysis`, `cancelVideoAnalysis`
- Speech: `extractAudioForTranscription` (ffmpeg via ffmpeg.wasm on server — heavy; fallback: send video directly if <60s or require pre-extracted audio), `startTranscriptionJob`, `getTranscriptionStatus`, `processTranscriptResults`, `createTranscriptSegments`, `saveSpeakerSegments`
- Vision: `analyzeImage`, `extractImageText`, `detectLogos`, `detectObjects`, `detectFacePresence`, `analyzeEvidenceFrame`, `compareProtectedAssets` (perceptual hash — pHash via JS), `saveImageFindings`
- Translation: `detectLanguage`, `translateText` (v3 REST), `translate*` wrappers
- Fact Check: `extractSearchableClaim` (uses Lovable AI Gateway `google/gemini-2.5-flash`), `searchFactChecks`, `normalizeFactCheckResults`, `calculateFactCheckMatch`, `saveFactCheckResult`, `refreshFactCheckStatus`
- Risk: `computeRiskScores` merges signals into the 9 scores listed in spec
- Job runner: `src/routes/api/mm/tick.ts` — public route, HMAC-verified via `MM_TICK_SECRET`, advances any `pending`/`polling` jobs one step. Client-side hook polls `getJobStatus` every 2s while a scan is active AND fires `/api/mm/tick` to progress work (Cloudflare workers have no cron — this cooperative advance keeps things moving during a session).

Each stage writes partial results; a stage failure logs to `multimedia_errors` and marks `stage_status[stage] = 'failed'` without aborting siblings.

## Milestone 3 — UI integration

- **Upload widget** on `/scan` — accepts video/audio/image/pdf, signs upload URL, kicks `runMultimediaIntelligenceAnalysis`.
- **Job progress panel** — shows the 14 stages with per-stage state (pending/running/done/failed).
- **Video Threat Timeline** — new section inside every YouTube result card and every uploaded video result. Reads `timestamp_findings`, renders time-ordered list with severity chip, transcript excerpt, original+translation, evidence frame thumb, "Watch exact moment" (deep-links `?t={seconds}s`), "Save evidence", "Mark false positive".
- **Evidence panel tabs** (expands current expandable panel): Overview / Transcript / Threat Timeline / Visual Detections / Translations / Fact Checks / Copyright Matches / Technical Evidence.
- **Metadata-only badge** when only YouTube metadata was analyzed (no authorized full-content processing).
- **Protected Assets manager** — new `/assets` sub-tab to upload logos/photos for matching.
- **Threat Radar promotion** already exists — extend to accept `timestamp_finding_id`.

## Milestone 4 — Hardening

- Retries with exponential backoff on all Google REST calls (`p-retry` inline)
- Duplicate prevention: unique `(source_kind, source_ref, org_id)` on `multimedia_analysis_jobs`
- Quota + cost tracking table (`api_usage`)
- Signed URL expiry: 10 min for evidence frames
- Retention: uploaded media deleted after job completes + 7 days (soft policy row on job)

## Technical Notes

- Speech-to-Text and Video Intelligence use long-running operations — we store `operation_name` and poll via `/api/mm/tick`.
- All Google REST endpoints called with `Authorization: Bearer <sa-token>`; no SDK (avoids Node-only deps on Cloudflare Workers).
- Fact Check Tools uses simple API key (no service account).
- ffmpeg audio extraction is **not** available on Workers — for uploaded video, we send the video URL directly to Speech-to-Text via `uri` in a GCS bucket (Speech supports video containers with `enableSeparateRecognitionPerChannel`).
- Gemini claim extraction via existing `LOVABLE_API_KEY` → `google/gemini-2.5-flash` (no extra secret).
- Perceptual hashing via `sharp` is Node-only; use pure-JS `pngjs` + custom 8x8 DCT-lite pHash inside a server fn.

## Deliverables

- 1 migration (all tables + RLS + grants + bucket policies)
- ~20 backend files under `src/lib/mm/`
- 1 job runner route `src/routes/api/mm/tick.ts`
- Extended `src/routes/api/scan.ts` to also fan out to `runMultimediaIntelligenceAnalysis` after YouTube fetch
- Extended `_app.scan.tsx` with upload widget, progress panel, timeline UI, evidence tabs
- New `_app.assets.tsx` protected assets manager (or extend existing)
- No breaking changes to current cards / Threat Radar / dashboard styling

## What I will do first if you approve

1. Call `supabase--enable`
2. Call `secrets--add_secret` for the 4 GCP secrets
3. Ship Milestone 1 migration
4. Then Milestone 2 backend, then 3, then 4.

This will be several long turns. Confirm to proceed.
