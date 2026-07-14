# Eterna Command Center — Home Dashboard Redesign

Rebuild `src/routes/_app.index.tsx` as a dense, SOC-style Reputation Intelligence Command Center. Reference image is used only for aesthetic/layout language (glass cards, deep navy, electric-blue accents, radial gauges, dense grid). No feature or copy is lifted from it.

All widgets are backed by **real project data** via existing server functions (`getDashboardStats`, `listPersistedResults`, `scan_hits`, `enforcement_requests`, `timestamp_findings`, `multimedia_analysis_jobs`, `client_profiles`). No mock data, no fabricated scores. Empty states render explicitly when data is absent.

## Layout (12-col grid, high density)

```text
┌───────────────────────────────────────────────────────────────┐
│ TopIntelBar: Reputation | Threat Lvl | Protection | Scans |   │
│              Assets | Critical | Pending | Enforcement        │
├───────────────────┬──────────────────────┬────────────────────┤
│ ReputationRadar   │  DangerMeter         │ ExecutiveSummary   │
│ (SVG polar, 4     │  (large gauge:       │ (AI status +       │
│  zones, threat    │   SAFE/WATCH/DANGER  │  key risks +       │
│  nodes)           │   /CRITICAL)         │  recommended       │
│                   ├──────────────────────┤  actions)          │
│                   │ ThreatIntelOverview  │                    │
│                   │ (6 KPIs + trends)    │                    │
├───────────────────┴──────────────────────┴────────────────────┤
│ LiveScannerPanel (6 scanners) │ ThreatHeatmap (platform grid) │
├───────────────────────────────┴────────────────────────────────┤
│ ReputationSpoilerDetector (9 categories, counts + reach)      │
├────────────────────────────────────────────────────────────────┤
│ TrendingThreats (top 10) │ AssetExposurePanel (most targeted) │
├──────────────────────────┴─────────────────────────────────────┤
│ ScanTimeline (event stream)  │  ActionCenter (6 quick actions)│
└────────────────────────────────────────────────────────────────┘
```

## Data wiring (all real, no mocks)

- **TopIntelBar** — new server fn `getCommandCenterStats` aggregates:
  - Reputation score (avg `reputation_score` from `multimedia_analysis_jobs`)
  - Threat level (derived from severity distribution in `scan_hits` + `timestamp_findings`)
  - Protection status (from `client_profiles.authorization_level`)
  - Active scans (`scans` where `status='running'`)
  - Protected assets (count from `assets`)
  - Critical cases, pending actions, open enforcement (`enforcement_requests` grouped by status)
- **ReputationRadar** — plots up to 40 nodes from `scan_hits` on polar coords: angle = platform bucket, radius = `100 - threat_score` (critical → center). Colored by severity. Hover → tooltip; click → opens `DetailDrawer` (reuse existing).
- **DangerMeter** — composite score: weighted blend of avg threat_score, total reach, velocity (new findings last 24h vs prior 24h), sentiment. Renders zone label.
- **ThreatIntelOverview** — 6 KPI tiles with 7-day sparkline + trend arrow computed from `scan_hits.first_seen_at` buckets.
- **LiveScannerPanel** — reads from `scans` table filtered by kind; shows current query, progress, per-source status. Reuses existing scan progress fields.
- **ThreatHeatmap** — matrix of platforms × severity from `scan_hits` grouped by `source`.
- **ReputationSpoilerDetector** — categorises `scan_hits` by `risk_type`/tags into the 9 categories (defamation, false claims, fake news, leaks, exposed, scandals, harassment, hate, manipulation). Uncategorised → "Other" (hidden if 0).
- **TrendingThreats** — top 10 `scan_hits` by `threat_score * log(reach+1)` in last 14d, with View / Evidence / Take Action buttons wired to existing `DetailDrawer` + `ActionDrawer`.
- **AssetExposurePanel** — joins `assets` with `scan_hits` where hit mentions asset (existing linkage).
- **ScanTimeline** — merged event stream from `scan_hits.first_seen_at`, `enforcement_evidence.created_at`, `enforcement_requests.created_at`/`.submitted_at`.
- **ActionCenter** — 6 buttons routing to existing pages (`/scan`, `/reports`, `/enforcement`, `/cases`, evidence flow, etc.). No new backend.
- **ExecutiveSummary** — deterministic template built from the aggregated numbers above (no LLM call this pass). Clearly labeled as auto-generated.

## Visual system

- Deep navy backdrop layer added via CSS token `--surface-command` on the dashboard root only (does not affect other pages).
- Glass cards: `bg-background/60 backdrop-blur-md border-white/5` with subtle inner glow via existing `--shadow-elegant`.
- Electric blue + cyan accents from existing brand tokens; severity uses existing severity colors (green/amber/orange/red) so it stays consistent with the rest of the app.
- Framer-motion fade/slide on card mount, radar node pulse for critical severity only.
- Fully responsive: collapses to single column below `lg`.

## Notifications (from screenshot)

Wire the Notifications page inbox to real data:
- Source: `enforcement_requests` state changes, new `scan_hits` at severity ≥ high, new `assets`, weekly digest row from `reports`.
- Add `getNotifications` server fn + hook it into existing `_app.notifications.tsx` page and the topbar bell badge count.
- Real timestamps ("2m ago" via `date-fns`), severity chips (Critical/Success/Info/Digest) driven by event type.
- Empty state when no notifications.

## Files

New:
- `src/lib/command-center.functions.ts` — `getCommandCenterStats`, `getNotifications`
- `src/components/command/TopIntelBar.tsx`
- `src/components/command/ReputationRadar.tsx`
- `src/components/command/DangerMeter.tsx`
- `src/components/command/ThreatIntelOverview.tsx`
- `src/components/command/LiveScannerPanel.tsx`
- `src/components/command/ThreatHeatmap.tsx`
- `src/components/command/ReputationSpoilerDetector.tsx`
- `src/components/command/TrendingThreats.tsx`
- `src/components/command/AssetExposurePanel.tsx`
- `src/components/command/ScanTimeline.tsx`
- `src/components/command/ActionCenter.tsx`
- `src/components/command/ExecutiveSummary.tsx`

Edited:
- `src/routes/_app.index.tsx` — replace current composition with command-center layout
- `src/routes/_app.notifications.tsx` — wire to real `getNotifications`
- `src/components/dashboard/TopBar.tsx` — bell badge from notifications count
- `src/styles.css` — add `--surface-command`, radar/heatmap tokens
- Fix hydration warning on `/auth` (root cause of current runtime error) as a small side-fix

## Out of scope (call out for follow-up)

- LLM-generated executive summary (deterministic template used first)
- Radar drag/pan interactivity beyond hover + click
- Push notifications / realtime subscriptions (polling only, 30s)
- Full write-back for "Take Action" from radar nodes (reuses existing ActionDrawer flow)

## Confirm before build

Confirm and I'll build it in one pass. If you want the LLM-written Executive Summary in this same turn, say so and I'll add a `generateExecutiveSummary` server fn using the Lovable AI Gateway.
