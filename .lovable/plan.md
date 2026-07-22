## Persistent Channel Watch — Implementation Plan

Build `/channel-watch` as a single-user (the signed-in verified Eterna user) command surface for monitoring external YouTube channels for content concerning them. Reuse existing YouTube, multimedia, evidence, and auth infrastructure. Nothing is auto-classified as defamation — everything flagged goes to human review.

### 1. Data model (one migration)

New tables, all `user_id` scoped with RLS `auth.uid() = user_id`:

- `channel_watches` — one row per creator channel the user monitors
  - `channel_id` (permanent YT ID), `channel_title`, `handle`, `avatar_url`, `subscriber_count`, `video_count`, `channel_url`
  - `reason`, `priority` (`critical|high|standard|low`), `notes`
  - `status` (`active|paused|error`), `last_error`
  - `uploads_playlist_id`, `last_checked_at`, `next_check_at`, `last_video_published_at`
  - `firecrawl_monitor_id` (nullable)
  - unique `(user_id, channel_id)` — dedupe
- `channel_watch_videos` — one row per fetched video
  - `watch_id`, `video_id`, `title`, `thumbnail_url`, `url`, `published_at`, `detected_at`
  - `is_baseline` (bool — historical vs new upload)
  - `view_count`, `like_count`, `comment_count`, `duration_seconds`
  - `mention_match` (jsonb: names/aliases hit, malayalam/manglish/english)
  - `protected_asset_similarity` (jsonb)
  - `analysis_status` (`pending|running|completed|failed|skipped`), `analysis_error`
  - `classification` (enum below), `risk_score` (0-100), `virality_score`
  - `review_status` (`not_required|pending|approved|dismissed|escalated`)
  - `reupload_of_video_id` (nullable), `deepfake_indicators` (jsonb)
  - unique `(watch_id, video_id)`
- `channel_watch_events` — activity feed
  - `watch_id` (nullable), `video_id` (nullable), `event_type`, `payload jsonb`
- `channel_watch_evidence` — links to `evidence_vault_items` for captured screenshots/transcripts
- Enum `channel_watch_classification`:
  `not_relevant | informational | commentary_no_violation | potential_harm | potential_copyright | potential_impersonation | potential_privacy | potential_manipulated | potential_harassment | potential_false_allegation`

All tables: `GRANT` for authenticated + service_role, RLS enabled, `auth.uid() = user_id` policies, `updated_at` triggers.

### 2. Server functions — `src/lib/channel-watch/*.functions.ts`

- `resolveChannelCandidates({ query })` — accepts `@handle`, URL, channel ID, or free text. Uses `channels.list` (by id / forHandle) plus a bounded `search.list` fallback only for freeform names. Returns 1–5 candidates with avatar/title/handle/desc/subs/videoCount + 4 recent thumbnails. Requires user confirmation.
- `addChannelWatch({ channelId, reason, priority, notes, analyzeExisting, existingCount })` — verifies unique per user, fetches channel + `uploads` playlist, seeds `channel_watches`, enqueues baseline fetch, optionally creates Firecrawl monitor.
- `listChannelWatches()` / `getChannelWatch({ id })` / `listWatchVideos({ watchId, cursor })`
- `scanChannelNow({ watchId })` — manual poll; ignores schedule
- `pauseWatch` / `resumeWatch` / `removeWatch` / `updateWatch`
- `getVerifiedUserSummary()` — top-card stats (monitored channels, videos analyzed, new matches, exposure)
- `submitReviewDecision({ videoId, decision, note })` — routes to human-review workflow

### 3. Poll worker + scheduling

- `src/lib/channel-watch/poll.server.ts` — for one watch:
  1. Load `uploads_playlist_id`; `playlistItems.list` newest-first, page while `snippet.publishedAt > last_video_published_at`
  2. Batch `videos.list` for metadata + stats
  3. Insert new rows (`is_baseline=false` for uploads discovered after seeding); dedupe on `(watch_id, video_id)`
  4. Enqueue analysis; update `last_checked_at`, `next_check_at` from priority, advance `last_video_published_at`
  5. Handle `403 quotaExceeded`, `404`, private/deleted — mark row `skipped` with reason; never silently succeed
  6. Advisory lock per `watch_id` (idempotency); exponential backoff on transient errors
- Baseline fetch: same pipeline, `is_baseline=true`, capped at `existingCount`.
- Public server route `src/routes/api/public/hooks/channel-watch-poll.ts` — auth via bearer secret, iterates due watches. Scheduled by `pg_cron` calling the endpoint every 5 min; each watch runs on its own priority cadence (15m/30m/2h/6h).

### 4. Analysis pipeline

Reuse existing multimedia infrastructure (`src/lib/mm/*`): captions/translation, claim extraction, face-scan (`analyzeHitForFaces`), video-classify, risk scoring. Add a thin orchestrator `analyzeWatchVideo({ videoRowId })` that:
- Loads user aliases (Malayalam/Manglish/English) from `client_profiles`; runs name/alias regex on title + description + captions
- Runs thumbnail face-match against user's Rekognition collection
- Runs caption transcription/translation if captions absent
- Runs claim extraction + deepfake/manipulation heuristics
- Computes `risk_score`, chooses `classification` from the enum; anything `potential_*` sets `review_status='pending'` and inserts `channel_watch_events` + evidence link
- Never labels as defamation; `potential_false_allegation` explicitly routes to legal review

### 5. Firecrawl secondary monitor

- `src/lib/channel-watch/firecrawl.server.ts` — installs `firecrawl` (`bun add firecrawl`), creates the monitor on channel confirmation, stores `monitor.id`, deletes on remove.
- `src/routes/api/public/hooks/firecrawl-monitor.ts` — verifies `Authorization: Bearer FIRECRAWL_WEBHOOK_SECRET`, timing-safe compare, inserts `channel_watch_events` and triggers a `scanChannelNow` for that watch (YouTube API remains authoritative).
- New secrets: `FIRECRAWL_WEBHOOK_SECRET`, `CHANNEL_WATCH_POLL_SECRET`. `PUBLIC_APP_URL` derived from request origin at monitor-create time.

### 6. UI — `/channel-watch` under `_app`

Route file `src/routes/_app.channel-watch.tsx`. Follows the SOC/command-center visual language already introduced (smoky blue-grey, frosted panels, muted cyan/coral).

Layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Verified User card  │  [+ ADD RISK CHANNEL]  │  Global stats │
├──────────────────────────────────────────────────────────────┤
│  Node graph: user → channels → videos → analysis → review    │
│  (SVG, thin curved lines, loop back to channels)             │
├──────────────────────────────────────────────────────────────┤
│  Monitored Creator Channels (grid of compact cards)          │
├──────────────────────────────────────────────────────────────┤
│  Fetched Videos (table w/ Baseline / New tab, filters)       │
├──────────────────────────────────────────────────────────────┤
│  Creator Upload Activity (waveform graph, recent events)     │
└──────────────────────────────────────────────────────────────┘
```

Components in `src/components/channel-watch/`:
- `VerifiedUserCard.tsx`
- `AddRiskChannelDialog.tsx` (search → candidate list → confirm)
- `ChannelWatchGraph.tsx` (SVG, no react-flow)
- `MonitoredChannelCard.tsx` (Scan Now / Pause / Edit / Remove)
- `WatchVideosTable.tsx` with `VideoDetailDrawer.tsx`
- `CreatorActivityGraph.tsx` (sparkline + event feed)
- `ReviewDecisionDialog.tsx`

Data loading uses TanStack Query (loader `ensureQueryData` + `useSuspenseQuery`); protected server fns via `useServerFn`.

### 7. Sidebar + head metadata

- Add "Channel Watch" entry in `Sidebar.tsx`
- Route `head()` sets a unique title/description/og

### 8. Security & correctness

- All server fns use `requireSupabaseAuth`; queries filter by `context.userId`; RLS enforces
- Webhook routes under `/api/public/*` verify bearer secrets with `timingSafeEqual`
- Poll worker uses Postgres advisory locks per watch_id for idempotency
- API keys read inside handlers (`process.env`), never module-scope
- Provider failures set `analysis_status='failed'` with reason — never silently converted to "no findings"
- No automatic takedowns; enforcement remains manual through existing flow

### 9. Verification

- `tsgo` typecheck + build after wiring
- Manual flow with Playwright once running: add by handle → confirm → baseline fetches → simulate new upload via `scanChannelNow` → analysis → review dialog
- Quota-exceeded and private-video paths exercised via injected errors in poll worker unit test

### 10. Out of scope for this pass

- Real re-upload perceptual-hash matching against user's protected library (schema field reserved; heuristic-only detection first)
- Malayalam speech-to-text tuning beyond existing provider defaults
- Multi-tenant client selector (explicitly a single verified user)

### Open questions before I build

1. Priority defaults for `next_check_at`: should "critical" really poll every 15 min for every user, or should we start conservative (30/60/240/720) to protect YouTube quota, then let the user opt into aggressive polling per watch?
2. Baseline analysis: for `analyzeExisting=yes` with e.g. 50 recent videos, do you want full multimedia analysis (captions + face-match) on all of them upfront, or metadata + thumbnail match now and defer heavy analysis until a match hint fires?
3. Firecrawl: enable by default on every added watch, or only when the user opts in per channel? (It costs credits and is secondary to YouTube API.)
