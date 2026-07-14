## Scope

Two connected changes: reorder the scan UI around YouTube-first, and produce real evidence/authorization/platform-complaint packages from the enforcement flow.

## 1. Scan page — YouTube-first result architecture

File: `src/routes/_app.scan.tsx` (+ helpers in `src/components/scan/`).

**Default result order & platform priority.** Reorder `SOURCES` and `DEFAULT_SOURCES` to: YouTube, News, Reddit, X, Instagram, TikTok, Facebook, Blogs, Forums, Reviews, Archive. Ranking weights (used for the overall relevance sort inside each scan): YouTube 40, News 20, Reddit 15, X 10, Instagram 5, TikTok 5, others 5.

**Platform tabs.** Replace the current Web/News/YouTube/Reddit/X/Instagram tabs with: `YouTube | News | Reddit | X | Instagram | TikTok | Facebook | Blogs | Forums | Reviews | Archive`. Auto-select YouTube after every successful scan (`useEffect` on new `report.query`).

**New "LATEST YOUTUBE THREATS" section** (renders above the tabs when there are YouTube hits). Client-computed buckets over `report.hits` filtered to `source === "YouTube"`:

- Critical Videos — `severity === "Critical"`
- High-Risk Videos — `threatScore >= 70`
- Fastest Growing — top by `media.growthPerDay`
- Most Viewed — top by `media.views`
- New Since Last Scan — `published` within last 24h OR flagged by `persistSummary.newHits` intersect
- Videos With Exact Evidence — hits that have any `timestamp_findings` (fetched via a small `useQuery` keyed by `scanId`)
- Videos Eligible For Takedown — `recommendedAction` contains "takedown" OR `severity in {Critical, High}` AND has evidence

Each bucket is a horizontal row of `YouTubeThreatCard`s, collapsible, empty state per bucket.

**"OTHER SOURCES" section** below: horizontal chip strip that jumps to the corresponding tab.

**YouTubeThreatCard fields** (new `src/components/scan/YouTubeThreatCard.tsx`): thumbnail, title, channel name + link, video link, published date, views/likes/comments, subscriber count (from `video_creator_profiles` lookup), threat score, reputation impact (derived from severity+reach), exact timestamp badge (first `timestamp_findings.start_seconds` if present) with "Watch exact moment" button (opens `youtu.be/{id}?t={sec}`), "Creator Profile" link → `/intelligence?channel=…`, "Add Evidence" (opens existing ExactMomentsPanel), "Generate PDF" (calls new evidence-package server fn — see §3), "Add To Case" (existing case picker).

## 2. Enforcement submission — three real packages per finding

Route: `src/routes/_app.enforcement.tsx` + new `src/lib/enforcement-packages.functions.ts` (server fns) + `src/lib/enforcement/pdf.server.ts`.

When the user selects findings and clicks a method (DMCA / Platform Report / Legal Notice), we now build **three artifacts per finding** and attach them to the enforcement_request row:

1. **Evidence Package (PDF)** — finding metadata, canonical URL, thumbnail, transcript/timestamp findings from `timestamp_findings` + `video_timestamp_findings`, extracted claims from `extracted_claims`, fact-check matches from `fact_check_matches`, OCR/frames from `evidence_frames` and `ocr_results`. Cryptographic content hash + captured-at timestamp on cover page.
2. **Authorization Package (PDF)** — pulls the user's `authorization_records` (signed authorization + ID) from `authorization-vault` storage bucket, plus `client_profiles` identity block, output as a bundled cover PDF referencing the vault file.
3. **Platform Complaint Package (PDF + JSON)** — platform-specific template (YouTube copyright/harassment, X impersonation, Reddit content policy, Meta IP report, TikTok IP/impersonation, generic DMCA for blogs/forums). Fills fields from the evidence package. JSON sidecar contains platform-ready form field values for later automation.

**Storage.** New Supabase bucket `enforcement-packages` (private). PDFs stored under `{user_id}/{enforcement_request_id}/{kind}.pdf`. Signed URLs returned to the client.

**DB additions** (single migration):

- Add columns to `enforcement_requests`: `evidence_pdf_path text`, `authorization_pdf_path text`, `platform_complaint_pdf_path text`, `platform_complaint_json jsonb`, `package_generated_at timestamptz`, `package_hash text`.
- New table `enforcement_package_items` (request_id, kind, storage_path, hash, generated_at) for full audit trail if a request gets regenerated.

**Server fn `generateEnforcementPackages`** (auth-protected): input `{ scanHitIds: string[], method: Method }`. For each hit: fetch related evidence, render 3 PDFs (using `pdf-lib`, which works on Cloudflare Workers), upload to storage, insert one `enforcement_requests` row per hit with the three storage paths, insert `enforcement_package_items` rows.

**Enforcement UI changes.** After clicking a method:

- Progress toast "Building packages 3/12…".
- Table row for each new request shows three download buttons (Evidence / Authorization / Complaint) via signed URLs.
- If the user has no `authorization_records` on file, block submission with a link to `/onboarding` to upload authorization.

## 3. Scan-side "Generate PDF" button

The per-video "Generate PDF" action on `YouTubeThreatCard` calls the same `generateEnforcementPackages` fn with `method: "DMCA"` and one hit id, but with a `dryRun: true` flag that only produces the Evidence Package (no enforcement row created). Returns signed URL, opens in a new tab.

## Technical notes

- PDF rendering: `pdf-lib` (Worker-compatible, no native deps). Add via `bun add pdf-lib`.
- Content hashing: `crypto.subtle.digest("SHA-256", …)` in the server fn.
- All new tables/columns get GRANTs + RLS scoped to `auth.uid()`.
- No mock data; if a hit has no evidence rows, the Evidence PDF lists "No corroborating evidence yet" and the enforcement action is still allowed but flagged in the platform complaint JSON as `evidence_strength: "weak"`.
- No changes to scan API (`/api/scan`); reordering is client-side only. Ranking weights applied during executive summary + bucket sort.

## Out of scope (call out to user)

- Actually transmitting the complaint to YouTube/X/Meta/etc. (no official API for most). Packages are download-ready; automated submission would require per-platform automation later.
- Rebuilding onboarding upload UX; we reuse the existing authorization vault.

## Files to touch

- `src/routes/_app.scan.tsx` — reorder tabs, add YOUTUBE THREATS section, wire Generate PDF.
- `src/components/scan/YouTubeThreatCard.tsx` — new.
- `src/components/scan/LatestYoutubeThreats.tsx` — new (bucket layout).
- `src/routes/_app.enforcement.tsx` — package generation flow, download buttons, authorization gate.
- `src/lib/enforcement-packages.functions.ts` — new server fn.
- `src/lib/enforcement/pdf.server.ts` — new PDF builders (evidence / authorization / complaint).
- `src/lib/enforcement/platform-templates.server.ts` — new per-platform complaint templates.
- Migration: new columns, new table, new storage bucket, RLS.
