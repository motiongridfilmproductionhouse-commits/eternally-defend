## Goal

Purge every mock / demo / seeded value from Eterna AI. Every page must read from the live database (`scan_hits`, `scans`, `timestamp_findings`, `video_timestamp_findings`, `video_creator_profiles`, `enforcement_requests`, `cases`, `generated_reports`, etc.) or show a professional empty state. No more "Deepfake Video Spreading", "Impersonation Account", hardcoded takedown counts, or seeded reputation scores.

Scope is large but mechanical — most of the mock data comes from a single `src/lib/data-store.tsx` provider that fans out into 4 routes, plus a handful of dashboard widgets that hardcode numbers. Threat Radar was already migrated in the last turn and is the pattern for the rest.

## What changes

### 1. Kill the mock store
- Delete `src/lib/data-store.tsx` (or reduce it to shared type exports only — `Severity`, `Status`, `RiskType`, `Virality`, `severityColor`).
- Remove `<DataProvider>` from `src/routes/__root.tsx`.

### 2. New / extended DB tables (single migration)
- `enforcement_requests` — user_id, scan_hit_id, platform, method (DMCA / Platform Report / Legal Notice), status (Queued / Sent / Approved / Rejected), submitted_at, responded_at, response_notes, evidence_refs.
- `cases` — user_id, subject, type (DMCA / Legal / Platform / Investigation), status (Open / In Progress / Escalated / Closed), priority, assignee, opened_at.
- `case_findings` — join table (case_id, scan_hit_id).
- `generated_reports` — user_id, name, kind, status, pdf_url, findings_count, created_at.
- Full RLS: `auth.uid() = user_id`, `GRANT ... TO authenticated`, `GRANT ALL TO service_role`.

(Other tables the prompt lists — `deepfake_findings`, `platform_submissions`, `creator_profiles`, `video_timestamp_findings` — already exist as `timestamp_findings`, `video_timestamp_findings`, `video_creator_profiles`, `multimedia_analysis_jobs`. I'll reuse those instead of duplicating them.)

### 3. Route rewrites (all fed by `useQuery` + supabase browser client, RLS-scoped)

| Route | New data source | Empty state |
|---|---|---|
| `/enforcement` | `enforcement_requests` + agg counts | "No enforcement actions available." |
| `/cases` | `cases` + `case_findings` | "No active cases." |
| `/removals` | `enforcement_requests` where method ≠ Legal | "No removal requests yet." |
| `/threat-monitoring` | `scan_hits` grouped by status | "No findings — run a scan." |
| `/reports` | `generated_reports` | "No reports generated yet." |
| `/scan` | already real; strip `addThreat` mock write | — |
| `/intelligence` | `video_timestamp_findings` + `video_creator_profiles` (already partially real — audit and remove any seeded fallbacks) | "No evidence analysed yet." |
| `/narrative-intelligence` | `narrative_clusters` | "No narratives clustered." |

### 4. Dashboard widgets — verify each is DB-backed
`StatsRow`, `ThreatMap`, `AIThreatTimeline`, `ReputationPulse`, `PlatformIntelligence`, `AIExposureIndex`, `UnauthorizedUsage`, `DeepfakeIntelligence`, `TopActiveThreats` all currently call `getDashboardStats` (real) — audit each to confirm no hardcoded fallback arrays leak through, and add "No data yet" states where they render bar rows.

`DeepfakeIntelligence` in particular must render "Deepfake detection unavailable" when `deepfake.sampleCount === 0` instead of drawing 0-value bars.

### 5. Enforcement actions
Wire the "Takedown" buttons across `/threat-radar`, `/threat-monitoring`, and `/enforcement` to insert into `enforcement_requests` (status = "Queued") — this makes the enforcement metrics actually move.

### 6. Cross-check
- `rg -n "useData\("` returns 0.
- `rg -n "seed|mock|demo"` in `src/` returns only comments and test-only references.
- Every page renders correctly with zero rows.

## Technical notes

- All reads via `supabase` browser client under RLS (matches existing `_app.assets.tsx` and the new `_app.threat-radar.tsx` pattern).
- Enforcement metrics: `count(*)`, `count(*) filter (status='Approved') / count(*)`, `avg(responded_at - submitted_at)`. Computed client-side over the fetched rows (bounded query with `.limit(500)`).
- Reports UI keeps a "Generate PDF" button but only lists rows from `generated_reports`; actual PDF generation is a follow-up (out of scope for a data-purge pass).
- Types file (`src/integrations/supabase/types.ts`) regenerates after migration approval; route code that references new tables lands *after* the migration runs.

## Order of operations

1. Ship migration (creates `enforcement_requests`, `cases`, `case_findings`, `generated_reports`).
2. Delete data-store, remove `<DataProvider>`, purge type imports.
3. Rewrite `/cases`, `/enforcement`, `/removals`, `/threat-monitoring`, `/reports` in parallel.
4. Audit dashboard widgets — patch empty states.
5. Wire Takedown buttons to `enforcement_requests`.
6. Verify with grep + build.